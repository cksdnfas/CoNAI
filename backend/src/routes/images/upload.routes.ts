import path from 'path';
import { Router, Request, Response } from 'express';
import { uploadSingle, uploadMultiple } from '../../middleware/upload';
import { asyncHandler } from '../../middleware/errorHandler';
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
import { registerUploadMetadataUtilityRoutes } from './uploadMetadataUtilityRoutes';

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

async function buildUploadResult(file: Express.Multer.File, imageSaveOptions: ReturnType<typeof parseUploadImageSaveOptions>): Promise<NonNullable<UploadResponse['data']>> {
  const processedData = await processUploadFile(file, imageSaveOptions);
  const mimeType = processedData.mimeType || file.mimetype;
  const mediaProcessing = await processSavedUploadMedia(processedData.originalPath, mimeType);

  return {
    id: mediaProcessing.fileId,
    filename: processedData.filename,
    original_name: file.originalname,
    thumbnail_url: '',
    file_size: processedData.fileSize,
    mime_type: mimeType,
    width: processedData.width,
    height: processedData.height,
    upload_date: new Date().toISOString(),
  };
}

/**
 * 단일 파일 업로드 (단순화: 파일 저장만)
 */
router.post('/upload', uploadSingle, asyncHandler(async (req: Request, res: Response) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] };
  const file = files?.['image']?.[0] || files?.['file']?.[0];

  console.log('📤 Upload request received:', {
    file: file ? {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    } : 'No file'
  });

  if (!file) {
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
      data: uploadResult
    };

    console.log('📨 Upload complete, file saved to:', uploadResult.filename);
    return res.status(201).json(response);
  } catch (error) {
    console.error('❌ Upload error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed'
    } as UploadResponse);
  }
}));

/**
 * 다중 파일 업로드 (단순화: 파일 저장만)
 */
router.post('/upload-multiple', uploadMultiple, asyncHandler(async (req: Request, res: Response) => {
  const filesObj = req.files as { [fieldname: string]: Express.Multer.File[] };
  const files = filesObj?.['images'] || filesObj?.['files'] || [];

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
        results.push(await buildUploadResult(file, imageSaveOptions));

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
 * 다중 파일 업로드 (스트리밍) - 단순화 버전
 * SSE로 진행 상황만 전송
 */
router.post('/upload-multiple-stream', uploadMultiple, async (req: Request, res: Response) => {
  const filesObj = req.files as { [fieldname: string]: Express.Multer.File[] };
  const files = filesObj?.['images'] || filesObj?.['files'] || [];

  if (!files || files.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'No files uploaded'
    });
  }

  // SSE 헤더 설정
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendProgress = (event: any) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  console.log(`📤 Stream upload request: ${files.length} files`);

  // 파일 처리 루프
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const currentFile = i + 1;

    try {
      sendProgress({
        type: 'start',
        currentFile,
        totalFiles: files.length,
        filename: file.originalname,
        message: `업로드 시작: ${file.originalname}`,
        timestamp: new Date().toISOString()
      });

      let processedData: {
        filename: string;
        originalPath: string;
        mimeType?: string;
      };

      if (isVideoFile(file.mimetype)) {
        const processedVideo = await VideoProcessor.processVideo(file, UPLOAD_BASE_PATH);
        processedData = {
          filename: processedVideo.filename,
          originalPath: processedVideo.originalPath,
          mimeType: file.mimetype
        };
      } else if (isImageFile(file.mimetype)) {
        const processedImage = await ImageProcessor.processImage(file, UPLOAD_BASE_PATH);
        processedData = {
          filename: processedImage.filename,
          originalPath: processedImage.originalPath,
          mimeType: file.mimetype
        };
      } else {
        throw new Error(`Unsupported file type: ${file.mimetype}`);
      }

      const mediaProcessing = await processSavedUploadMedia(
        processedData.originalPath,
        processedData.mimeType || file.mimetype,
      );

      // 완료 이벤트
      sendProgress({
        type: 'complete',
        currentFile,
        totalFiles: files.length,
        filename: file.originalname,
        message: '파일 저장 및 즉시 처리 완료',
        path: processedData.originalPath,
        compositeHash: mediaProcessing.compositeHash,
        timestamp: new Date().toISOString()
      });

      console.log(`✅ Stream: ${file.originalname} saved`);
    } catch (error) {
      sendProgress({
        type: 'error',
        currentFile,
        totalFiles: files.length,
        filename: file.originalname,
        error: error instanceof Error ? error.message : 'Processing failed',
        timestamp: new Date().toISOString()
      });
      console.error(`❌ Stream: ${file.originalname} failed:`, error);
    }
  }

  console.log('📨 Stream upload complete');
  res.end();
  return;
});

export { router as uploadRoutes };
