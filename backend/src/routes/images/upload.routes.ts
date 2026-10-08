import path from 'path';
import { Router, Request, Response } from 'express';
import { uploadSingle, uploadMultiple } from '../../middleware/upload';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requirePermission } from '../../middleware/authMiddleware';
import { ImageProcessor } from '../../services/imageProcessor';
import { VideoProcessor } from '../../services/videoProcessor';
import { BackgroundProcessorService } from '../../services/backgroundProcessorService';
import { UploadResponse } from '../../types/image';
import { runtimePaths } from '../../config/runtimePaths';
import {
  isImageFile,
  isVideoFile,
  parseUploadImageSaveOptions,
  processImageUploadWithSettings,
} from './uploadRouteHelpers';
import { buildUploadResponseData } from './uploadResponseHelpers';
import { registerUploadMetadataUtilityRoutes } from './uploadMetadataUtilityRoutes';
import {
  UploadValidationError,
  auditUploadRequest,
  cleanupStoredUpload,
  cleanupTemporaryUploads,
  enforceMultipleUploadLimits,
  listRequestUploadFiles,
  rejectOversizedMultipleUploadRequest,
  setUploadAuditMetrics,
  setUploadAuditReason,
  validateUploadedMediaFile,
} from './uploadSecurity';

const router = Router();
const UPLOAD_BASE_PATH = runtimePaths.uploadsDir;

registerUploadMetadataUtilityRoutes(router);

type ProcessedUploadData = {
  filename: string;
  originalPath: string;
  width: number | null;
  height: number | null;
  fileSize: number;
  mimeType?: string;
};

async function processSavedUploadMedia(relativePath: string, mimeType: string) {
  return BackgroundProcessorService.processSavedMediaFile(
    path.join(UPLOAD_BASE_PATH, relativePath),
    {
      mimeType,
      quiet: true,
    },
  );
}

async function processUploadFile(file: Express.Multer.File, imageSaveOptions: ReturnType<typeof parseUploadImageSaveOptions>): Promise<ProcessedUploadData> {
  if (isVideoFile(file.mimetype)) {
    const processedVideo = await VideoProcessor.processVideo(file, UPLOAD_BASE_PATH);
    return {
      filename: processedVideo.filename,
      originalPath: processedVideo.originalPath,
      width: processedVideo.width,
      height: processedVideo.height,
      fileSize: processedVideo.fileSize,
    };
  }

  if (isImageFile(file.mimetype)) {
    const processedImage = await processImageUploadWithSettings(file, UPLOAD_BASE_PATH, imageSaveOptions);
    return {
      filename: processedImage.filename,
      originalPath: processedImage.originalPath,
      width: processedImage.width,
      height: processedImage.height,
      fileSize: processedImage.fileSize,
      mimeType: 'mimeType' in processedImage ? processedImage.mimeType : undefined,
    };
  }

  throw new Error(`Unsupported file type: ${file.mimetype}`);
}

async function buildUploadResult(file: Express.Multer.File, imageSaveOptions: ReturnType<typeof parseUploadImageSaveOptions>) {
  let processedData: ProcessedUploadData | null = null;

  try {
    await validateUploadedMediaFile(file);
    processedData = await processUploadFile(file, imageSaveOptions);
    const mimeType = processedData.mimeType || file.mimetype;
    const mediaProcessing = await processSavedUploadMedia(processedData.originalPath, mimeType);

    return {
      data: buildUploadResponseData({
        file,
        processedData,
        mediaProcessing,
        mimeType,
      }),
      originalPath: processedData.originalPath,
      compositeHash: mediaProcessing.compositeHash,
    };
  } catch (error) {
    if (processedData) {
      await cleanupStoredUpload(UPLOAD_BASE_PATH, processedData.originalPath);
    }
    throw error;
  } finally {
    await cleanupTemporaryUploads([file]);
  }
}

/**
 * 단일 파일 업로드 (단순화: 파일 저장만)
 */
router.post('/upload', auditUploadRequest('library.single'), requirePermission('images.upload'), uploadSingle, asyncHandler(async (req: Request, res: Response) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] };
  const file = files?.['image']?.[0] || files?.['file']?.[0];
  setUploadAuditMetrics(res, file ? [file] : []);

  console.log('📤 Upload request received:', {
    file: file ? {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    } : 'No file'
  });

  if (!file) {
    setUploadAuditReason(res, 'missing_file');
    console.log('❌ No file in request');
    return res.status(400).json({
      success: false,
      error: 'No file uploaded'
    } as UploadResponse);
  }

  try {
    const imageSaveOptions = parseUploadImageSaveOptions(req.body);
    const uploadResult = await buildUploadResult(file, imageSaveOptions);

    const response: UploadResponse = {
      success: true,
      data: uploadResult.data
    };

    console.log('📨 Upload complete, file saved to:', uploadResult.data.filename);
    return res.status(201).json(response);
  } catch (error) {
    console.error('❌ Upload error:', error);
    const statusCode = error instanceof UploadValidationError ? error.statusCode : 500;
    setUploadAuditReason(res, error instanceof UploadValidationError ? 'content_type_mismatch' : 'processing_failed');
    return res.status(statusCode).json({
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed'
    } as UploadResponse);
  }
}));

/**
 * 다중 파일 업로드 (단순화: 파일 저장만)
 */
router.post('/upload-multiple', auditUploadRequest('library.multiple'), requirePermission('images.upload'), rejectOversizedMultipleUploadRequest, uploadMultiple, enforceMultipleUploadLimits, asyncHandler(async (req: Request, res: Response) => {
  const files = listRequestUploadFiles(req);

  if (!files || files.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'No files uploaded'
    });
  }

  console.log(`📤 Multiple upload request: ${files.length} files`);

  try {
    const imageSaveOptions = parseUploadImageSaveOptions(req.body);
    const results = [];
    const errors = [];

    for (const file of files) {
      try {
        const uploadResult = await buildUploadResult(file, imageSaveOptions);
        results.push(uploadResult.data);

        console.log(`✅ ${file.originalname} saved`);
      } catch (error) {
        errors.push({
          filename: file.originalname,
          error: error instanceof Error ? error.message : 'Processing failed'
        });
        console.error(`❌ ${file.originalname} failed:`, error);
      }
    }

    console.log(`📨 Multiple upload complete: ${results.length}/${files.length} successful`);
    if (errors.length > 0) {
      setUploadAuditReason(res, results.length > 0 ? 'partial_failure' : 'all_files_failed');
    }

    return res.status(201).json({
      success: true,
      data: {
        uploaded: results,
        failed: errors,
        total: files.length,
        successful: results.length,
        failed_count: errors.length
      }
    });
  } catch (error) {
    console.error('❌ Multiple upload error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Multiple upload failed'
    });
  }
}));

/**
 * 다중 파일 업로드 (스트리밍)
 * 파일마다 서버 처리 결과를 SSE로 보낸다. `complete` 이벤트는 /upload-multiple 의 uploaded 항목과
 * 같은 `data` 를 싣고, 마지막에 `done` 요약을 보낸다. `index` 는 요청 안의 0-based 파일 순서.
 */
router.post('/upload-multiple-stream', auditUploadRequest('library.multiple-stream'), requirePermission('images.upload'), rejectOversizedMultipleUploadRequest, uploadMultiple, enforceMultipleUploadLimits, async (req: Request, res: Response) => {
  const files = listRequestUploadFiles(req);

  if (!files || files.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'No files uploaded'
    });
  }

  const imageSaveOptions = parseUploadImageSaveOptions(req.body);

  // SSE 헤더 설정. compression 은 event-stream 을 건너뛴다(configureAppMiddleware filter).
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const canWrite = () => !res.writableEnded && !res.destroyed;
  const sendProgress = (event: Record<string, unknown>) => {
    if (canWrite()) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  // index.ts 의 server.setTimeout(60000) 은 유휴 소켓을 끊는다. 동영상처럼 한 파일 처리가 길어도
  // 연결이 유지되도록 주석 프레임을 주기적으로 보낸다.
  const heartbeat = setInterval(() => {
    if (canWrite()) {
      res.write(': keep-alive\n\n');
    }
  }, 15000);

  console.log(`📤 Stream upload request: ${files.length} files`);
  let successful = 0;

  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const currentFile = i + 1;

      try {
        sendProgress({
          type: 'start',
          index: i,
          currentFile,
          totalFiles: files.length,
          filename: file.originalname,
          timestamp: new Date().toISOString()
        });

        const uploadResult = await buildUploadResult(file, imageSaveOptions);
        successful += 1;

        sendProgress({
          type: 'complete',
          index: i,
          currentFile,
          totalFiles: files.length,
          filename: file.originalname,
          path: uploadResult.originalPath,
          compositeHash: uploadResult.compositeHash,
          data: uploadResult.data,
          timestamp: new Date().toISOString()
        });

        console.log(`✅ Stream: ${file.originalname} saved`);
      } catch (error) {
        sendProgress({
          type: 'error',
          index: i,
          currentFile,
          totalFiles: files.length,
          filename: file.originalname,
          error: error instanceof Error ? error.message : 'Processing failed',
          timestamp: new Date().toISOString()
        });
        console.error(`❌ Stream: ${file.originalname} failed:`, error);
      }
    }
  } finally {
    clearInterval(heartbeat);
  }

  const failedCount = files.length - successful;
  if (failedCount > 0) {
    setUploadAuditReason(res, successful > 0 ? 'partial_failure' : 'all_files_failed');
  }

  sendProgress({
    type: 'done',
    total: files.length,
    successful,
    failed_count: failedCount,
    timestamp: new Date().toISOString()
  });

  console.log(`📨 Stream upload complete: ${successful}/${files.length} successful`);
  res.end();
  return;
});

export { router as uploadRoutes };
