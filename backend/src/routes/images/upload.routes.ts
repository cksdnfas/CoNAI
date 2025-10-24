import { Router, Request, Response } from 'express';
import path from 'path';
import { uploadSingle, uploadMultiple } from '../../middleware/upload';
import { asyncHandler } from '../../middleware/errorHandler';
import { ImageProcessor } from '../../services/imageProcessor';
import { VideoProcessor } from '../../services/videoProcessor';
import { ImageModel } from '../../models/Image';
import { PromptCollectionService } from '../../services/promptCollectionService';
import { AutoCollectionService } from '../../services/autoCollectionService';
import { imageTaggerService, ImageTaggerService } from '../../services/imageTaggerService';
import { UploadResponse, UploadProgressEvent } from '../../types/image';
import { runtimePaths, toUploadsUrl } from '../../config/runtimePaths';
import { refinePrimaryPrompt } from '@comfyui-image-manager/shared';

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
 * 단일 이미지 업로드
 */
router.post('/upload', uploadSingle, asyncHandler(async (req: Request, res: Response) => {
  // fields() 사용 시 req.files 객체로 전달됨
  const files = req.files as { [fieldname: string]: Express.Multer.File[] };

  const file = files?.['image']?.[0] || files?.['file']?.[0];

  console.log('📤 Upload request received:', {
    file: file ? {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    } : 'No file'
  });

  // 응답 타임아웃 설정 (30초)
  req.setTimeout(30000, () => {
    console.error('❌ Upload request timeout');
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        error: 'Upload timeout'
      });
    }
  });

  if (!file) {
    console.log('❌ No file in request');
    return res.status(400).json({
      success: false,
      error: 'No file uploaded'
    } as UploadResponse);
  }

  try {
    let imageId: number;
    let processedData: {
      filename: string;
      originalPath: string;
      thumbnailPath: string;
      optimizedPath: string | null;
      width: number;
      height: number;
      fileSize: number;
      metadata?: any;
    };

    // 파일 타입에 따라 분기 처리
    if (isVideoFile(file.mimetype)) {
      console.log('🎬 Processing video...');
      const processedVideo = await VideoProcessor.processVideo(file, UPLOAD_BASE_PATH);
      console.log('✅ Video processed successfully');

      console.log('💾 Saving to database...');
      // 동영상 메타데이터 저장
      imageId = await ImageModel.create({
        filename: processedVideo.filename,
        original_name: file.originalname,
        file_path: processedVideo.originalPath,
        thumbnail_path: processedVideo.thumbnailPath,
        optimized_path: processedVideo.optimizedPath,
        file_size: processedVideo.fileSize,
        mime_type: file.mimetype,
        width: processedVideo.width,
        height: processedVideo.height,
        metadata: JSON.stringify(processedVideo.metadata),

        // 동영상 메타데이터 필드들
        duration: processedVideo.metadata.duration,
        fps: processedVideo.metadata.fps,
        video_codec: processedVideo.metadata.video_codec,
        audio_codec: processedVideo.metadata.audio_codec,
        bitrate: processedVideo.metadata.bitrate,

        // AI 메타데이터 필드들 (동영상은 null)
        ai_tool: null,
        model_name: null,
        lora_models: null,
        steps: null,
        cfg_scale: null,
        sampler: null,
        seed: null,
        scheduler: null,
        prompt: null,
        negative_prompt: null,
        denoise_strength: null,
        generation_time: null,
        batch_size: null,
        batch_index: null,
        auto_tags: null,

        // 유사도 검색 필드들 (동영상은 null)
        perceptual_hash: null,
        color_histogram: null
      });

      processedData = processedVideo;
      console.log('✅ Video database save successful, ID:', imageId);
    } else if (isImageFile(file.mimetype)) {
      console.log('🔄 Processing image...');
      const processedImage = await ImageProcessor.processImage(file, UPLOAD_BASE_PATH);
      console.log('✅ Image processed successfully');

      // 메타데이터에서 구조화된 필드 추출
      const aiInfo = processedImage.metadata.ai_info || {};

      // STEP 1: 프롬프트 정제 (DB 저장 전)
      let refinedPrompt = aiInfo.prompt || null;
      let refinedNegativePrompt = aiInfo.negative_prompt || null;

      if (refinedPrompt) {
        refinedPrompt = refinePrimaryPrompt(refinedPrompt);
      }

      if (refinedNegativePrompt) {
        refinedNegativePrompt = refinePrimaryPrompt(refinedNegativePrompt);
      }

      console.log('💾 Saving to database...');
      // 데이터베이스에 저장 (정제된 프롬프트 사용)
      imageId = await ImageModel.create({
        filename: processedImage.filename,
        original_name: file.originalname,
        file_path: processedImage.originalPath,
        thumbnail_path: processedImage.thumbnailPath,
        optimized_path: processedImage.optimizedPath,
        file_size: processedImage.fileSize,
        mime_type: file.mimetype,
        width: processedImage.width,
        height: processedImage.height,
        metadata: JSON.stringify(processedImage.metadata),

        // AI 메타데이터 필드들 (정제된 프롬프트 사용)
        ai_tool: aiInfo.ai_tool || null,
        model_name: aiInfo.model || null,
        lora_models: aiInfo.lora_models ? JSON.stringify(aiInfo.lora_models) : null,
        steps: aiInfo.steps || null,
        cfg_scale: aiInfo.cfg_scale || null,
        sampler: aiInfo.sampler || null,
        seed: aiInfo.seed || null,
        scheduler: aiInfo.scheduler || null,
        prompt: refinedPrompt,
        negative_prompt: refinedNegativePrompt,
        denoise_strength: aiInfo.denoise_strength || null,
        generation_time: aiInfo.generation_time || null,
        batch_size: aiInfo.batch_size || null,
        batch_index: aiInfo.batch_index || null,
        auto_tags: null,  // 업로드 시에는 null, 별도 태깅 요청으로 추가

        // 동영상 메타데이터 필드들 (이미지는 null)
        duration: null,
        fps: null,
        video_codec: null,
        audio_codec: null,
        bitrate: null,

        // 유사도 검색 필드들
        perceptual_hash: processedImage.perceptualHash || null,
        color_histogram: processedImage.colorHistogram || null
      });

      processedData = processedImage;
      console.log('✅ Image database save successful, ID:', imageId);
      console.log('💾 [Upload] Database save with hash data:', {
        imageId: imageId,
        has_perceptual_hash: !!processedImage.perceptualHash,
        has_color_histogram: !!processedImage.colorHistogram,
        perceptual_hash: processedImage.perceptualHash ? `${processedImage.perceptualHash.substring(0, 16)}... (${processedImage.perceptualHash.length} chars)` : 'NULL',
        color_histogram: processedImage.colorHistogram ? `${processedImage.colorHistogram.length} bytes` : 'NULL'
      });

      // 검증: 데이터베이스에 실제로 저장되었는지 확인
      if (!processedImage.perceptualHash || !processedImage.colorHistogram) {
        console.error('⚠️ [Upload] WARNING: Hash data is NULL - will be saved as NULL in database!', {
          perceptualHash: processedImage.perceptualHash || 'NULL',
          colorHistogram: processedImage.colorHistogram ? `${processedImage.colorHistogram.length} bytes` : 'NULL'
        });
      }

      // STEP 3: 프롬프트 수집 (정제된 프롬프트 사용)
      // 비동기로 처리, 오류가 있어도 업로드는 계속 진행
      try {
        console.log('🔍 Collecting prompts...');
        await PromptCollectionService.collectFromImage(
          refinedPrompt,
          refinedNegativePrompt
        );
        console.log('✅ Prompts collected successfully');
      } catch (promptError) {
        console.warn('⚠️ Failed to collect prompts (non-critical):', promptError);
      }

      // 이미지인 경우에만 프롬프트 수집 실행
      // (프롬프트 수집은 이미지 전용)
      processedData = processedImage;
    } else {
      throw new Error(`Unsupported file type: ${file.mimetype}`);
    }

    // 자동 태깅 (설정에서 활성화된 경우) - 이미지/동영상 모두 적용, 자동수집보다 먼저 실행
    try {
      const { settingsService } = await import('../../services/settingsService');
      const settings = settingsService.loadSettings();

      if (settings.tagger.enabled && settings.tagger.autoTagOnUpload) {
        console.log('🏷️ Auto-tagging on upload...');
        const filePath = path.join(UPLOAD_BASE_PATH, processedData.originalPath);

        let taggerResult;
        if (isVideoFile(file.mimetype)) {
          console.log('🎬 Tagging video (extracting frames)...');
          taggerResult = await imageTaggerService.tagVideo(filePath);
        } else {
          console.log('🖼️ Tagging image...');
          taggerResult = await imageTaggerService.tagImage(filePath);
        }

        if (taggerResult.success) {
          const autoTagsJson = ImageTaggerService.formatForDatabase(taggerResult);
          await ImageModel.updateAutoTags(imageId, autoTagsJson);
          console.log('✅ Auto-tagging completed successfully');
        } else {
          console.warn('⚠️ Auto-tagging failed (non-critical):', taggerResult.error);
        }
      }
    } catch (autoTagError) {
      console.warn('⚠️ Failed to auto-tag file (non-critical):', autoTagError);
    }

    // 자동수집 그룹 처리 (이미지/동영상 모두 적용, 자동 태깅 이후 실행하여 auto_tags 조건도 체크 가능)
    try {
      console.log('🔍 Running auto collection for new file...');
      const autoCollectResults = await AutoCollectionService.runAutoCollectionForNewImage(imageId);
      if (autoCollectResults.length > 0) {
        console.log(`✅ File automatically added to ${autoCollectResults.length} groups`);
      }
    } catch (autoCollectError) {
      console.warn('⚠️ Failed to run auto collection (non-critical):', autoCollectError);
    }

    const response: UploadResponse = {
      success: true,
      data: {
        id: imageId,
        filename: processedData.filename,
        original_name: file.originalname,
        thumbnail_url: toUploadsUrl(processedData.thumbnailPath)!,
        optimized_url: toUploadsUrl(processedData.optimizedPath)!,
        file_size: processedData.fileSize,
        mime_type: file.mimetype,
        width: processedData.width,
        height: processedData.height,
        upload_date: new Date().toISOString()
      }
    };

    console.log('📨 Sending response...');
    if (!res.headersSent) {
      return res.status(201).json(response);
    }
    return;
  } catch (error) {
    console.error('❌ Upload error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed'
      } as UploadResponse);
    }
    return;
  }
}));

/**
 * 다중 이미지 업로드
 */
router.post('/upload-multiple', uploadMultiple, asyncHandler(async (req: Request, res: Response) => {
  // fields() 사용 시 req.files 객체로 전달됨
  const filesObj = req.files as { [fieldname: string]: Express.Multer.File[] };
  const files = filesObj?.['images'] || filesObj?.['files'] || [];

  if (!files || files.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'No files uploaded'
    });
  }

  try {
    const results = [];
    const errors = [];

    for (const file of files) {
      try {
        let imageId: number;
        let processedData: {
          filename: string;
          originalPath: string;
          thumbnailPath: string;
          optimizedPath: string | null;
          width: number;
          height: number;
          fileSize: number;
          metadata?: any;
        };

        // 파일 타입에 따라 분기 처리
        if (isVideoFile(file.mimetype)) {
          // 동영상 처리
          const processedVideo = await VideoProcessor.processVideo(file, UPLOAD_BASE_PATH);

          // 동영상 메타데이터 저장
          imageId = await ImageModel.create({
            filename: processedVideo.filename,
            original_name: file.originalname,
            file_path: processedVideo.originalPath,
            thumbnail_path: processedVideo.thumbnailPath,
            optimized_path: processedVideo.optimizedPath,
            file_size: processedVideo.fileSize,
            mime_type: file.mimetype,
            width: processedVideo.width,
            height: processedVideo.height,
            metadata: JSON.stringify(processedVideo.metadata),

            // 동영상 메타데이터 필드들
            duration: processedVideo.metadata.duration,
            fps: processedVideo.metadata.fps,
            video_codec: processedVideo.metadata.video_codec,
            audio_codec: processedVideo.metadata.audio_codec,
            bitrate: processedVideo.metadata.bitrate,

            // AI 메타데이터 필드들 (동영상은 null)
            ai_tool: null,
            model_name: null,
            lora_models: null,
            steps: null,
            cfg_scale: null,
            sampler: null,
            seed: null,
            scheduler: null,
            prompt: null,
            negative_prompt: null,
            denoise_strength: null,
            generation_time: null,
            batch_size: null,
            batch_index: null,
            auto_tags: null,

            // 유사도 검색 필드들 (동영상은 null)
            perceptual_hash: null,
            color_histogram: null
          });

          processedData = processedVideo;
        } else if (isImageFile(file.mimetype)) {
          // 이미지 처리
          const processedImage = await ImageProcessor.processImage(file, UPLOAD_BASE_PATH);

          // 메타데이터에서 구조화된 필드 추출
          const aiInfo = processedImage.metadata.ai_info || {};

          // STEP 1: 프롬프트 정제 (DB 저장 전)
          let refinedPrompt = aiInfo.prompt || null;
          let refinedNegativePrompt = aiInfo.negative_prompt || null;

          if (refinedPrompt) {
            refinedPrompt = refinePrimaryPrompt(refinedPrompt);
          }

          if (refinedNegativePrompt) {
            refinedNegativePrompt = refinePrimaryPrompt(refinedNegativePrompt);
          }

          // 데이터베이스에 저장 (정제된 프롬프트 사용)
          imageId = await ImageModel.create({
            filename: processedImage.filename,
            original_name: file.originalname,
            file_path: processedImage.originalPath,
            thumbnail_path: processedImage.thumbnailPath,
            optimized_path: processedImage.optimizedPath,
            file_size: processedImage.fileSize,
            mime_type: file.mimetype,
            width: processedImage.width,
            height: processedImage.height,
            metadata: JSON.stringify(processedImage.metadata),

            // AI 메타데이터 필드들 (정제된 프롬프트 사용)
            ai_tool: aiInfo.ai_tool || null,
            model_name: aiInfo.model || null,
            lora_models: aiInfo.lora_models ? JSON.stringify(aiInfo.lora_models) : null,
            steps: aiInfo.steps || null,
            cfg_scale: aiInfo.cfg_scale || null,
            sampler: aiInfo.sampler || null,
            seed: aiInfo.seed || null,
            scheduler: aiInfo.scheduler || null,
            prompt: refinedPrompt,
            negative_prompt: refinedNegativePrompt,
            denoise_strength: aiInfo.denoise_strength || null,
            generation_time: aiInfo.generation_time || null,
            batch_size: aiInfo.batch_size || null,
            batch_index: aiInfo.batch_index || null,
            auto_tags: null,  // 업로드 시에는 null, 별도 태깅 요청으로 추가

            // 동영상 메타데이터 필드들 (이미지는 null)
            duration: null,
            fps: null,
            video_codec: null,
            audio_codec: null,
            bitrate: null,

            // 유사도 검색 필드들
            perceptual_hash: processedImage.perceptualHash || null,
            color_histogram: processedImage.colorHistogram || null
          });

          console.log('🔍 [Upload Multiple] Hash data for', file.originalname, ':', {
            has_perceptual_hash: !!processedImage.perceptualHash,
            has_color_histogram: !!processedImage.colorHistogram
          });

          // STEP 3: 프롬프트 수집 (정제된 프롬프트 사용)
          try {
            await PromptCollectionService.collectFromImage(
              refinedPrompt,
              refinedNegativePrompt
            );
          } catch (promptError) {
            console.warn('⚠️ Failed to collect prompts for', file.originalname, '(non-critical):', promptError);
          }

          // 이미지인 경우에만 프롬프트 수집 실행
          processedData = processedImage;
        } else {
          throw new Error(`Unsupported file type: ${file.mimetype}`);
        }

        // 자동 태깅 (설정에서 활성화된 경우) - 이미지/동영상 모두 적용, 자동수집보다 먼저 실행
        try {
          const { settingsService } = await import('../../services/settingsService');
          const settings = settingsService.loadSettings();

          if (settings.tagger.enabled && settings.tagger.autoTagOnUpload) {
            const filePath = path.join(UPLOAD_BASE_PATH, processedData.originalPath);

            let taggerResult;
            if (isVideoFile(file.mimetype)) {
              taggerResult = await imageTaggerService.tagVideo(filePath);
            } else {
              taggerResult = await imageTaggerService.tagImage(filePath);
            }

            if (taggerResult.success) {
              const autoTagsJson = ImageTaggerService.formatForDatabase(taggerResult);
              await ImageModel.updateAutoTags(imageId, autoTagsJson);
            }
          }
        } catch (autoTagError) {
          console.warn('⚠️ Failed to auto-tag', file.originalname, '(non-critical):', autoTagError);
        }

        // 자동수집 그룹 처리 (이미지/동영상 모두 적용, 자동 태깅 이후 실행)
        try {
          const autoCollectResults = await AutoCollectionService.runAutoCollectionForNewImage(imageId);
          if (autoCollectResults.length > 0) {
            console.log(`✅ ${file.originalname} automatically added to ${autoCollectResults.length} groups`);
          }
        } catch (autoCollectError) {
          console.warn('⚠️ Failed to run auto collection for', file.originalname, '(non-critical):', autoCollectError);
        }

        results.push({
          id: imageId,
          filename: processedData.filename,
          original_name: file.originalname,
          thumbnail_url: toUploadsUrl(processedData.thumbnailPath)!,
          optimized_url: toUploadsUrl(processedData.optimizedPath)!,
          file_size: processedData.fileSize,
          mime_type: file.mimetype,
          width: processedData.width,
          height: processedData.height,
          upload_date: new Date().toISOString()
        });
      } catch (error) {
        errors.push({
          filename: file.originalname,
          error: error instanceof Error ? error.message : 'Processing failed'
        });
      }
    }

    res.status(201).json({
      success: true,
      data: {
        uploaded: results,
        failed: errors,
        total: files.length,
        successful: results.length,
        failed_count: errors.length
      }
    });
    return;
  } catch (error) {
    console.error('Multiple upload error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Multiple upload failed'
    });
    return;
  }
}));

/**
 * 다중 이미지 업로드 (Server-Sent Events 스트리밍)
 * 실시간 진행도를 클라이언트에 전송
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
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx 버퍼링 비활성화

  // 진행도 이벤트 전송 헬퍼 함수
  const sendProgress = (event: UploadProgressEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // 설정 미리 로드 (자동 태깅 여부 확인)
  let autoTagEnabled = false;
  try {
    const { settingsService } = await import('../../services/settingsService');
    const settings = settingsService.loadSettings();
    autoTagEnabled = settings.tagger.enabled && settings.tagger.autoTagOnUpload;
  } catch (error) {
    console.warn('Failed to load settings:', error);
  }

  // 파일 처리 루프
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const currentFile = i + 1;

    try {
      // 1. 시작 이벤트
      sendProgress({
        type: 'start',
        currentFile,
        totalFiles: files.length,
        filename: file.originalname,
        message: `업로드 시작: ${file.originalname}`,
        timestamp: new Date().toISOString()
      });

      let imageId: number;
      let processedData: {
        originalPath: string;
        [key: string]: any;
      } | undefined;

      // 파일 타입에 따라 분기 처리
      if (isVideoFile(file.mimetype)) {
        // 동영상 처리
        sendProgress({
          type: 'stage',
          currentFile,
          totalFiles: files.length,
          filename: file.originalname,
          stage: 'metadata',
          message: '동영상 메타데이터 추출 중...',
          timestamp: new Date().toISOString()
        });

        const processedVideo = await VideoProcessor.processVideo(file, UPLOAD_BASE_PATH);
        processedData = processedVideo;

        sendProgress({
          type: 'stage',
          currentFile,
          totalFiles: files.length,
          filename: file.originalname,
          stage: 'thumbnail',
          message: '애니메이션 썸네일 생성 완료',
          timestamp: new Date().toISOString()
        });

        // 동영상 메타데이터 저장
        imageId = await ImageModel.create({
          filename: processedVideo.filename,
          original_name: file.originalname,
          file_path: processedVideo.originalPath,
          thumbnail_path: processedVideo.thumbnailPath,
          optimized_path: processedVideo.optimizedPath,
          file_size: processedVideo.fileSize,
          mime_type: file.mimetype,
          width: processedVideo.width,
          height: processedVideo.height,
          metadata: JSON.stringify(processedVideo.metadata),

          // 동영상 메타데이터 필드들
          duration: processedVideo.metadata.duration,
          fps: processedVideo.metadata.fps,
          video_codec: processedVideo.metadata.video_codec,
          audio_codec: processedVideo.metadata.audio_codec,
          bitrate: processedVideo.metadata.bitrate,

          // AI 메타데이터 필드들 (동영상은 null)
          ai_tool: null,
          model_name: null,
          lora_models: null,
          steps: null,
          cfg_scale: null,
          sampler: null,
          seed: null,
          scheduler: null,
          prompt: null,
          negative_prompt: null,
          denoise_strength: null,
          generation_time: null,
          batch_size: null,
          batch_index: null,
          auto_tags: null,

          // 유사도 검색 필드들 (동영상은 null)
          perceptual_hash: null,
          color_histogram: null
        });
      } else if (isImageFile(file.mimetype)) {
        // 이미지 처리
        sendProgress({
          type: 'stage',
          currentFile,
          totalFiles: files.length,
          filename: file.originalname,
          stage: 'metadata',
          message: '메타데이터 추출 중...',
          timestamp: new Date().toISOString()
        });

        const processedImage = await ImageProcessor.processImage(file, UPLOAD_BASE_PATH);

        sendProgress({
          type: 'stage',
          currentFile,
          totalFiles: files.length,
          filename: file.originalname,
          stage: 'thumbnail',
          message: '썸네일 및 최적화 이미지 생성 완료',
          timestamp: new Date().toISOString()
        });

        // 메타데이터에서 구조화된 필드 추출
        const aiInfo = processedImage.metadata.ai_info || {};

        // STEP 1: 프롬프트 정제 (DB 저장 전)
        let refinedPrompt = aiInfo.prompt || null;
        let refinedNegativePrompt = aiInfo.negative_prompt || null;

        if (refinedPrompt) {
          refinedPrompt = refinePrimaryPrompt(refinedPrompt);
        }

        if (refinedNegativePrompt) {
          refinedNegativePrompt = refinePrimaryPrompt(refinedNegativePrompt);
        }

        // 데이터베이스에 저장 (정제된 프롬프트 사용)
        imageId = await ImageModel.create({
          filename: processedImage.filename,
          original_name: file.originalname,
          file_path: processedImage.originalPath,
          thumbnail_path: processedImage.thumbnailPath,
          optimized_path: processedImage.optimizedPath,
          file_size: processedImage.fileSize,
          mime_type: file.mimetype,
          width: processedImage.width,
          height: processedImage.height,
          metadata: JSON.stringify(processedImage.metadata),
          ai_tool: aiInfo.ai_tool || null,
          model_name: aiInfo.model || null,
          lora_models: aiInfo.lora_models ? JSON.stringify(aiInfo.lora_models) : null,
          steps: aiInfo.steps || null,
          cfg_scale: aiInfo.cfg_scale || null,
          sampler: aiInfo.sampler || null,
          seed: aiInfo.seed || null,
          scheduler: aiInfo.scheduler || null,
          prompt: refinedPrompt,
          negative_prompt: refinedNegativePrompt,
          denoise_strength: aiInfo.denoise_strength || null,
          generation_time: aiInfo.generation_time || null,
          batch_size: aiInfo.batch_size || null,
          batch_index: aiInfo.batch_index || null,
          auto_tags: null,

          // 동영상 메타데이터 필드들 (이미지는 null)
          duration: null,
          fps: null,
          video_codec: null,
          audio_codec: null,
          bitrate: null,

          // 유사도 검색 필드들
          perceptual_hash: processedImage.perceptualHash || null,
          color_histogram: processedImage.colorHistogram || null
        });

        console.log('🔍 [Upload Stream] Hash data for', file.originalname, ':', {
          has_perceptual_hash: !!processedImage.perceptualHash,
          has_color_histogram: !!processedImage.colorHistogram
        });

        // STEP 3: 프롬프트 수집 (정제된 프롬프트 사용)
        try {
          await PromptCollectionService.collectFromImage(
            refinedPrompt,
            refinedNegativePrompt
          );
        } catch (promptError) {
          console.warn('⚠️ Failed to collect prompts for', file.originalname, promptError);
        }

        processedData = processedImage;
      } else {
        throw new Error(`Unsupported file type: ${file.mimetype}`);
      }

      // 자동 태깅 (설정에서 활성화된 경우) - 이미지/동영상 모두 적용, 자동수집보다 먼저 실행
      if (autoTagEnabled) {
        sendProgress({
          type: 'stage',
          currentFile,
          totalFiles: files.length,
          filename: file.originalname,
          stage: 'auto-tag',
          message: isVideoFile(file.mimetype) ? '동영상 자동 태깅 실행 중 (프레임 추출)...' : '자동 태깅 실행 중...',
          timestamp: new Date().toISOString()
        });

        try {
          if (!processedData) {
            throw new Error('Processed data is not available');
          }

          const filePath = path.join(UPLOAD_BASE_PATH, processedData.originalPath);

          let taggerResult;
          if (isVideoFile(file.mimetype)) {
            taggerResult = await imageTaggerService.tagVideo(filePath);
          } else {
            taggerResult = await imageTaggerService.tagImage(filePath);
          }

          if (taggerResult.success) {
            const autoTagsJson = ImageTaggerService.formatForDatabase(taggerResult);
            await ImageModel.updateAutoTags(imageId, autoTagsJson);
            sendProgress({
              type: 'stage',
              currentFile,
              totalFiles: files.length,
              filename: file.originalname,
              stage: 'auto-tag',
              message: '자동 태깅 완료',
              timestamp: new Date().toISOString()
            });
          } else {
            sendProgress({
              type: 'stage',
              currentFile,
              totalFiles: files.length,
              filename: file.originalname,
              stage: 'auto-tag',
              message: '자동 태깅 실패 (계속 진행)',
              timestamp: new Date().toISOString()
            });
          }
        } catch (autoTagError) {
          console.warn('⚠️ Failed to auto-tag', file.originalname, autoTagError);
        }
      }

      // 6. 자동수집 그룹 처리 (자동 태깅 이후 실행하여 auto_tags 조건도 체크 가능)
      sendProgress({
        type: 'stage',
        currentFile,
        totalFiles: files.length,
        filename: file.originalname,
        stage: 'auto-collect',
        message: '자동 그룹 분류 확인 중...',
        timestamp: new Date().toISOString()
      });

      try {
        const autoCollectResults = await AutoCollectionService.runAutoCollectionForNewImage(imageId);
        if (autoCollectResults.length > 0) {
          sendProgress({
            type: 'stage',
            currentFile,
            totalFiles: files.length,
            filename: file.originalname,
            stage: 'auto-collect',
            message: `${autoCollectResults.length}개 그룹에 자동 추가됨`,
            timestamp: new Date().toISOString()
          });
        }
      } catch (autoCollectError) {
        console.warn('⚠️ Failed to run auto collection for', file.originalname, autoCollectError);
      }

      // 7. 완료 이벤트
      sendProgress({
        type: 'complete',
        currentFile,
        totalFiles: files.length,
        filename: file.originalname,
        message: '업로드 완료',
        imageId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      // 에러 이벤트
      sendProgress({
        type: 'error',
        currentFile,
        totalFiles: files.length,
        filename: file.originalname,
        error: error instanceof Error ? error.message : 'Processing failed',
        timestamp: new Date().toISOString()
      });
    }
  }

  // 스트림 종료
  res.end();
  return;
});

export { router as uploadRoutes };
