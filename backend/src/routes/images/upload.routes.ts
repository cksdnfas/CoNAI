import { Router, Request, Response } from 'express';
import path from 'path';
import { uploadSingle, uploadMultiple } from '../../middleware/upload';
import { asyncHandler } from '../../middleware/errorHandler';
import { ImageProcessor } from '../../services/imageProcessor';
import { VideoProcessor } from '../../services/videoProcessor';
import { UploadResponse } from '../../types/image';
import { runtimePaths, toUploadsUrl } from '../../config/runtimePaths';

const router = Router();
const UPLOAD_BASE_PATH = runtimePaths.uploadsDir;

/**
 * 파일이 동영상인지 확인
 */
function isVideoFile(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

/**
 * 파일이 이미지인지 확인
 */
function isImageFile(mimeType: string): boolean {
  return mimeType.startsWith('image/');
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
    let processedData: {
      filename: string;
      originalPath: string;
      width: number;
      height: number;
      fileSize: number;
    };

    // 파일 타입에 따라 분기 처리
    if (isVideoFile(file.mimetype)) {
      console.log('🎬 Uploading video (file save only)...');
      const processedVideo = await VideoProcessor.processVideo(file, UPLOAD_BASE_PATH);
      console.log('✅ Video saved successfully');

      processedData = {
        filename: processedVideo.filename,
        originalPath: processedVideo.originalPath,
        width: processedVideo.width,
        height: processedVideo.height,
        fileSize: processedVideo.fileSize
      };
    } else if (isImageFile(file.mimetype)) {
      console.log('🖼️  Uploading image (file save only)...');
      const processedImage = await ImageProcessor.processImage(file, UPLOAD_BASE_PATH);
      console.log('✅ Image saved successfully');

      processedData = {
        filename: processedImage.filename,
        originalPath: processedImage.originalPath,
        width: processedImage.width,
        height: processedImage.height,
        fileSize: processedImage.fileSize
      };
    } else {
      throw new Error(`Unsupported file type: ${file.mimetype}`);
    }

    // 간단한 응답 (DB 저장 없음, 파일 경로만 반환)
    const response: UploadResponse = {
      success: true,
      data: {
        id: 0, // DB 저장 안 함, 스캔 시 생성
        filename: processedData.filename,
        original_name: file.originalname,
        thumbnail_url: '', // 스캔 시 생성
        optimized_url: '', // 스캔 시 생성
        file_size: processedData.fileSize,
        mime_type: file.mimetype,
        width: processedData.width,
        height: processedData.height,
        upload_date: new Date().toISOString()
      }
    };

    console.log('📨 Upload complete, file saved to:', processedData.originalPath);
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
    const results = [];
    const errors = [];

    for (const file of files) {
      try {
        let processedData: {
          filename: string;
          originalPath: string;
          width: number;
          height: number;
          fileSize: number;
        };

        // 파일 타입에 따라 분기 처리
        if (isVideoFile(file.mimetype)) {
          const processedVideo = await VideoProcessor.processVideo(file, UPLOAD_BASE_PATH);
          processedData = {
            filename: processedVideo.filename,
            originalPath: processedVideo.originalPath,
            width: processedVideo.width,
            height: processedVideo.height,
            fileSize: processedVideo.fileSize
          };
        } else if (isImageFile(file.mimetype)) {
          const processedImage = await ImageProcessor.processImage(file, UPLOAD_BASE_PATH);
          processedData = {
            filename: processedImage.filename,
            originalPath: processedImage.originalPath,
            width: processedImage.width,
            height: processedImage.height,
            fileSize: processedImage.fileSize
          };
        } else {
          throw new Error(`Unsupported file type: ${file.mimetype}`);
        }

        results.push({
          id: 0, // DB 저장 안 함
          filename: processedData.filename,
          original_name: file.originalname,
          thumbnail_url: '', // 스캔 시 생성
          optimized_url: '', // 스캔 시 생성
          file_size: processedData.fileSize,
          mime_type: file.mimetype,
          width: processedData.width,
          height: processedData.height,
          upload_date: new Date().toISOString()
        });

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
      };

      if (isVideoFile(file.mimetype)) {
        const processedVideo = await VideoProcessor.processVideo(file, UPLOAD_BASE_PATH);
        processedData = {
          filename: processedVideo.filename,
          originalPath: processedVideo.originalPath
        };
      } else if (isImageFile(file.mimetype)) {
        const processedImage = await ImageProcessor.processImage(file, UPLOAD_BASE_PATH);
        processedData = {
          filename: processedImage.filename,
          originalPath: processedImage.originalPath
        };
      } else {
        throw new Error(`Unsupported file type: ${file.mimetype}`);
      }

      // 완료 이벤트
      sendProgress({
        type: 'complete',
        currentFile,
        totalFiles: files.length,
        filename: file.originalname,
        message: '파일 저장 완료',
        path: processedData.originalPath,
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
