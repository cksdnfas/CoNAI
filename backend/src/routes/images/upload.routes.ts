import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import { successResponse, errorResponse } from '@conai/shared';
import { uploadSingle, uploadMultiple } from '../../middleware/upload';
import { asyncHandler } from '../../middleware/errorHandler';
import { ImageProcessor } from '../../services/imageProcessor';
import { VideoProcessor } from '../../services/videoProcessor';
import { imageTaggerService } from '../../services/imageTaggerService';
import { kaloscopeTaggerService } from '../../services/kaloscopeTaggerService';
import { UploadResponse } from '../../types/image';
import { runtimePaths } from '../../config/runtimePaths';
import { AIMetadata } from '../../services/metadata';
import { ImageMetadataWriteService, ImageOutputFormat } from '../../services/imageMetadataWriteService';
import { WebPConversionService } from '../../services/webpConversionService';

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

function parseMaybeJson(value: unknown) {
  if (typeof value !== 'string') {
    return value ?? null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildDownloadFileName(originalName: string, format: ImageOutputFormat = 'webp'): string {
  const baseName = path.basename(originalName, path.extname(originalName)) || 'converted-image';
  const safeBaseName = baseName.replace(/[\\/:*?"<>|]/g, '_');
  const extension = format === 'jpeg' ? 'jpg' : format;
  return `${safeBaseName}.${extension}`;
}

/** Parse a requested output format into a supported image format. */
function resolveOutputFormat(requestedFormat: unknown, file: Express.Multer.File): ImageOutputFormat {
  if (typeof requestedFormat === 'string') {
    const normalized = requestedFormat.trim().toLowerCase();
    if (normalized === 'png' || normalized === 'webp') {
      return normalized;
    }

    if (normalized === 'jpg' || normalized === 'jpeg') {
      return 'jpeg';
    }
  }

  const extension = path.extname(file.originalname).toLowerCase();
  if (extension === '.png') {
    return 'png';
  }

  if (extension === '.jpg' || extension === '.jpeg') {
    return 'jpeg';
  }

  if (extension === '.webp') {
    return 'webp';
  }

  return 'webp';
}

/** Build a response content-type for a requested output format. */
function buildOutputMimeType(format: ImageOutputFormat): string {
  if (format === 'png') {
    return 'image/png';
  }

  if (format === 'jpeg') {
    return 'image/jpeg';
  }

  return 'image/webp';
}

/** Parse a JSON metadata patch payload from multipart form data. */
function parseMetadataPatch(value: unknown): Partial<AIMetadata> | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = typeof value === 'string'
    ? parseMaybeJson(value)
    : value;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('metadataPatch must be a JSON object');
  }

  return parsed as Partial<AIMetadata>;
}

function buildExtractedImagePreview(
  file: Express.Multer.File,
  metadata: Awaited<ReturnType<typeof ImageProcessor.extractMetadata>>,
  imageInfo: Awaited<ReturnType<typeof ImageProcessor.getImageInfo>>,
) {
  const aiInfo = (metadata.ai_info || {}) as Record<string, any>;

  const preview = {
    id: `extract:${file.filename || file.originalname}`,
    width: imageInfo.width || aiInfo.width || null,
    height: imageInfo.height || aiInfo.height || null,
    file_size: file.size,
    mime_type: file.mimetype,
    ai_metadata: {
      ai_tool: aiInfo.ai_tool || null,
      model_name: aiInfo.model || null,
      lora_models: Array.isArray(aiInfo.lora_models) ? aiInfo.lora_models : null,
      prompts: {
        prompt: aiInfo.prompt || aiInfo.positive_prompt || null,
        negative_prompt: aiInfo.negative_prompt || null,
        character_prompt_text: aiInfo.character_prompt_text || null,
      },
      raw_nai_parameters: parseMaybeJson(aiInfo.raw_nai_parameters),
    },
  };

  return preview;
}

function getSingleUploadedFile(req: Request) {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] };
  return files?.['image']?.[0] || files?.['file']?.[0] || null;
}

async function cleanupTemporaryUpload(file: Express.Multer.File | null) {
  if (!file?.path || !fs.existsSync(file.path)) {
    return;
  }

  try {
    await fs.promises.unlink(file.path);
  } catch (cleanupError) {
    console.warn('Failed to cleanup temp extraction file:', file.path, cleanupError);
  }
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
 * 이미지 저장 없이 WebP로 변환하고 메타데이터를 XMP로 보존
 */
router.post('/convert-webp', uploadSingle, asyncHandler(async (req: Request, res: Response) => {
  const file = getSingleUploadedFile(req);

  if (!file) {
    return res.status(400).json(errorResponse('No file uploaded'));
  }

  if (!isImageFile(file.mimetype)) {
    return res.status(400).json(errorResponse('Only image files can be converted to WebP'));
  }

  if (!file.path) {
    return res.status(500).json(errorResponse('Temporary upload path is missing'));
  }

  const rawQuality = typeof req.body?.quality === 'string' ? Number(req.body.quality) : Number(req.body?.quality ?? 90);

  try {
    const conversion = await WebPConversionService.convertFileToWebPBuffer(file.path, {
      quality: Number.isFinite(rawQuality) ? rawQuality : 90,
      sourcePathForMetadata: file.path,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
    });

    const downloadName = buildDownloadFileName(file.originalname, 'webp');
    const encodedName = encodeURIComponent(downloadName);

    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"; filename*=UTF-8''${encodedName}`);
    res.setHeader('X-CoNAI-WebP-Metadata', conversion.embeddedPayload ? 'preserved' : 'empty');

    return res.send(conversion.buffer);
  } catch (error) {
    console.error('❌ Convert WebP error:', error);
    return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'WebP conversion failed'));
  } finally {
    await cleanupTemporaryUpload(file);
  }
}));

/**
 * Rewrite image metadata without saving the upload to the library.
 */
router.post('/rewrite-metadata', uploadSingle, asyncHandler(async (req: Request, res: Response) => {
  const file = getSingleUploadedFile(req);

  if (!file) {
    return res.status(400).json(errorResponse('No file uploaded'));
  }

  if (!isImageFile(file.mimetype)) {
    return res.status(400).json(errorResponse('Only image files can be rewritten without upload'));
  }

  if (!file.path) {
    return res.status(500).json(errorResponse('Temporary upload path is missing'));
  }

  const outputFormat = resolveOutputFormat(req.body?.format, file);
  const rawQuality = typeof req.body?.quality === 'string' ? Number(req.body.quality) : Number(req.body?.quality ?? 90);

  try {
    const metadataPatch = parseMetadataPatch(req.body?.metadataPatch);
    const rewritten = await ImageMetadataWriteService.writeFileAsFormatBuffer(file.path, {
      format: outputFormat,
      quality: Number.isFinite(rawQuality) ? rawQuality : 90,
      sourcePathForMetadata: file.path,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      metadataPatch,
    });

    const downloadName = buildDownloadFileName(file.originalname, outputFormat);
    const encodedName = encodeURIComponent(downloadName);

    res.setHeader('Content-Type', buildOutputMimeType(outputFormat));
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"; filename*=UTF-8''${encodedName}`);
    res.setHeader('X-CoNAI-Metadata-Rewrite', metadataPatch ? 'patched' : 'preserved');
    res.setHeader('X-CoNAI-Metadata-XMP', rewritten.xmpApplied ? 'applied' : 'empty');
    res.setHeader('X-CoNAI-Metadata-EXIF', rewritten.exifApplied ? 'applied' : 'empty');

    return res.send(rewritten.buffer);
  } catch (error) {
    console.error('❌ Rewrite metadata error:', error);
    if (error instanceof Error && error.message === 'metadataPatch must be a JSON object') {
      return res.status(400).json(errorResponse(error.message));
    }
    return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Metadata rewrite failed'));
  } finally {
    await cleanupTemporaryUpload(file);
  }
}));

/**
 * 이미지 저장 없이 메타데이터/프롬프트만 추출
 */
router.post('/extract-metadata', uploadSingle, asyncHandler(async (req: Request, res: Response) => {
  const file = getSingleUploadedFile(req);

  if (!file) {
    return res.status(400).json(errorResponse('No file uploaded'));
  }

  if (!isImageFile(file.mimetype)) {
    return res.status(400).json(errorResponse('Only image files can be extracted without upload'));
  }

  if (!file.path) {
    return res.status(500).json(errorResponse('Temporary upload path is missing'));
  }

  try {
    const [metadata, imageInfo] = await Promise.all([
      ImageProcessor.extractMetadata(file.path),
      ImageProcessor.getImageInfo(file.path),
    ]);

    return res.json(successResponse(buildExtractedImagePreview(file, metadata, imageInfo)));
  } catch (error) {
    console.error('❌ Extract metadata error:', error);
    return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Metadata extraction failed'));
  } finally {
    await cleanupTemporaryUpload(file);
  }
}));

/**
 * 이미지 저장 없이 자동 태그 추출
 */
router.post('/extract-tagger', uploadSingle, asyncHandler(async (req: Request, res: Response) => {
  const file = getSingleUploadedFile(req);

  if (!file) {
    return res.status(400).json(errorResponse('No file uploaded'));
  }

  if (!isImageFile(file.mimetype)) {
    return res.status(400).json(errorResponse('Only image files can be tag-extracted without upload'));
  }

  if (!file.path) {
    return res.status(500).json(errorResponse('Temporary upload path is missing'));
  }

  try {
    const result = await imageTaggerService.tagImage(file.path);

    if (!result.success) {
      return res.status(500).json(errorResponse(result.error || 'Tagger extraction failed'));
    }

    return res.json(successResponse(result));
  } catch (error) {
    console.error('❌ Extract tagger error:', error);
    return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Tagger extraction failed'));
  } finally {
    await cleanupTemporaryUpload(file);
  }
}));

/**
 * 이미지 저장 없이 작가 추출
 */
router.post('/extract-kaloscope', uploadSingle, asyncHandler(async (req: Request, res: Response) => {
  const file = getSingleUploadedFile(req);

  if (!file) {
    return res.status(400).json(errorResponse('No file uploaded'));
  }

  if (!isImageFile(file.mimetype)) {
    return res.status(400).json(errorResponse('Only image files can be artist-extracted without upload'));
  }

  if (!file.path) {
    return res.status(500).json(errorResponse('Temporary upload path is missing'));
  }

  try {
    const result = await kaloscopeTaggerService.tagImage(file.path);

    if (!result.success) {
      return res.status(500).json(errorResponse(result.error || 'Kaloscope extraction failed'));
    }

    return res.json(successResponse(result));
  } catch (error) {
    console.error('❌ Extract kaloscope error:', error);
    return res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Kaloscope extraction failed'));
  } finally {
    await cleanupTemporaryUpload(file);
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
