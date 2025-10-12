import { Router, Request, Response } from 'express';
import path from 'path';
import { uploadSingle, uploadMultiple } from '../../middleware/upload';
import { asyncHandler } from '../../middleware/errorHandler';
import { ImageProcessor } from '../../services/imageProcessor';
import { ImageModel } from '../../models/Image';
import { PromptCollectionService } from '../../services/promptCollectionService';
import { AutoCollectionService } from '../../services/autoCollectionService';
import { imageTaggerService, ImageTaggerService } from '../../services/imageTaggerService';
import { UploadResponse, UploadProgressEvent } from '../../types/image';
import { runtimePaths, toUploadsUrl } from '../../config/runtimePaths';

const router = Router();
const UPLOAD_BASE_PATH = runtimePaths.uploadsDir;

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
    console.log('🔄 Processing image...');
    // 이미지 처리
    const processedImage = await ImageProcessor.processImage(file, UPLOAD_BASE_PATH);
    console.log('✅ Image processed successfully');

    console.log('💾 Saving to database...');
    // 메타데이터에서 구조화된 필드 추출
    const aiInfo = processedImage.metadata.ai_info || {};

    // 데이터베이스에 저장
    const imageId = await ImageModel.create({
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

      // AI 메타데이터 필드들
      ai_tool: aiInfo.ai_tool || null,
      model_name: aiInfo.model || null,
      lora_models: aiInfo.lora_models ? JSON.stringify(aiInfo.lora_models) : null,
      steps: aiInfo.steps || null,
      cfg_scale: aiInfo.cfg_scale || null,
      sampler: aiInfo.sampler || null,
      seed: aiInfo.seed || null,
      scheduler: aiInfo.scheduler || null,
      prompt: aiInfo.prompt || null,
      negative_prompt: aiInfo.negative_prompt || null,
      denoise_strength: aiInfo.denoise_strength || null,
      generation_time: aiInfo.generation_time || null,
      batch_size: aiInfo.batch_size || null,
      batch_index: aiInfo.batch_index || null,
      auto_tags: null  // 업로드 시에는 null, 별도 태깅 요청으로 추가
    });
    console.log('✅ Database save successful, ID:', imageId);

    // 프롬프트 수집 (비동기로 처리, 오류가 있어도 업로드는 계속 진행)
    try {
      console.log('🔍 Collecting prompts...');
      await PromptCollectionService.collectFromImage(
        aiInfo.prompt || null,
        aiInfo.negative_prompt || null
      );
      console.log('✅ Prompts collected successfully');
    } catch (promptError) {
      console.warn('⚠️ Failed to collect prompts (non-critical):', promptError);
    }

    // 자동 태깅 (설정에서 활성화된 경우) - 자동수집보다 먼저 실행
    try {
      const { settingsService } = await import('../../services/settingsService');
      const settings = settingsService.loadSettings();

      if (settings.tagger.enabled && settings.tagger.autoTagOnUpload) {
        console.log('🏷️ Auto-tagging image on upload...');
        const imagePath = path.join(UPLOAD_BASE_PATH, processedImage.originalPath);
        const taggerResult = await imageTaggerService.tagImage(imagePath);

        if (taggerResult.success) {
          const autoTagsJson = ImageTaggerService.formatForDatabase(taggerResult);
          await ImageModel.updateAutoTags(imageId, autoTagsJson);
          console.log('✅ Auto-tagging completed successfully');
        } else {
          console.warn('⚠️ Auto-tagging failed (non-critical):', taggerResult.error);
        }
      }
    } catch (autoTagError) {
      console.warn('⚠️ Failed to auto-tag image (non-critical):', autoTagError);
    }

    // 자동수집 그룹 처리 (자동 태깅 이후 실행하여 auto_tags 조건도 체크 가능)
    try {
      console.log('🔍 Running auto collection for new image...');
      const autoCollectResults = await AutoCollectionService.runAutoCollectionForNewImage(imageId);
      if (autoCollectResults.length > 0) {
        console.log(`✅ Image automatically added to ${autoCollectResults.length} groups`);
      }
    } catch (autoCollectError) {
      console.warn('⚠️ Failed to run auto collection (non-critical):', autoCollectError);
    }

    const response: UploadResponse = {
      success: true,
      data: {
        id: imageId,
        filename: processedImage.filename,
        original_name: file.originalname,
        thumbnail_url: toUploadsUrl(processedImage.thumbnailPath)!,
        optimized_url: toUploadsUrl(processedImage.optimizedPath)!,
        file_size: processedImage.fileSize,
        mime_type: file.mimetype,
        width: processedImage.width,
        height: processedImage.height,
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
        // 이미지 처리
        const processedImage = await ImageProcessor.processImage(file, UPLOAD_BASE_PATH);

        // 메타데이터에서 구조화된 필드 추출
        const aiInfo = processedImage.metadata.ai_info || {};

        // 데이터베이스에 저장
        const imageId = await ImageModel.create({
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

          // AI 메타데이터 필드들
          ai_tool: aiInfo.ai_tool || null,
          model_name: aiInfo.model || null,
          lora_models: aiInfo.lora_models ? JSON.stringify(aiInfo.lora_models) : null,
          steps: aiInfo.steps || null,
          cfg_scale: aiInfo.cfg_scale || null,
          sampler: aiInfo.sampler || null,
          seed: aiInfo.seed || null,
          scheduler: aiInfo.scheduler || null,
          prompt: aiInfo.prompt || null,
          negative_prompt: aiInfo.negative_prompt || null,
          denoise_strength: aiInfo.denoise_strength || null,
          generation_time: aiInfo.generation_time || null,
          batch_size: aiInfo.batch_size || null,
          batch_index: aiInfo.batch_index || null,
          auto_tags: null  // 업로드 시에는 null, 별도 태깅 요청으로 추가
        });

        // 프롬프트 수집 (비동기로 처리, 오류가 있어도 업로드는 계속 진행)
        try {
          await PromptCollectionService.collectFromImage(
            aiInfo.prompt || null,
            aiInfo.negative_prompt || null
          );
        } catch (promptError) {
          console.warn('⚠️ Failed to collect prompts for', file.originalname, '(non-critical):', promptError);
        }

        // 자동 태깅 (설정에서 활성화된 경우) - 자동수집보다 먼저 실행
        try {
          const { settingsService } = await import('../../services/settingsService');
          const settings = settingsService.loadSettings();

          if (settings.tagger.enabled && settings.tagger.autoTagOnUpload) {
            const imagePath = path.join(UPLOAD_BASE_PATH, processedImage.originalPath);
            const taggerResult = await imageTaggerService.tagImage(imagePath);

            if (taggerResult.success) {
              const autoTagsJson = ImageTaggerService.formatForDatabase(taggerResult);
              await ImageModel.updateAutoTags(imageId, autoTagsJson);
            }
          }
        } catch (autoTagError) {
          console.warn('⚠️ Failed to auto-tag', file.originalname, '(non-critical):', autoTagError);
        }

        // 자동수집 그룹 처리 (자동 태깅 이후 실행하여 auto_tags 조건도 체크 가능)
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
          filename: processedImage.filename,
          original_name: file.originalname,
          thumbnail_url: toUploadsUrl(processedImage.thumbnailPath)!,
          optimized_url: toUploadsUrl(processedImage.optimizedPath)!,
          file_size: processedImage.fileSize,
          mime_type: file.mimetype,
          width: processedImage.width,
          height: processedImage.height,
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

      // 2. 이미지 처리 단계
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

      // 3. 썸네일 생성 단계
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

      // 데이터베이스에 저장
      const imageId = await ImageModel.create({
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
        prompt: aiInfo.prompt || null,
        negative_prompt: aiInfo.negative_prompt || null,
        denoise_strength: aiInfo.denoise_strength || null,
        generation_time: aiInfo.generation_time || null,
        batch_size: aiInfo.batch_size || null,
        batch_index: aiInfo.batch_index || null,
        auto_tags: null
      });

      // 4. 프롬프트 수집
      try {
        await PromptCollectionService.collectFromImage(
          aiInfo.prompt || null,
          aiInfo.negative_prompt || null
        );
      } catch (promptError) {
        console.warn('⚠️ Failed to collect prompts for', file.originalname, promptError);
      }

      // 5. 자동 태깅 (설정에서 활성화된 경우) - 자동수집보다 먼저 실행
      if (autoTagEnabled) {
        sendProgress({
          type: 'stage',
          currentFile,
          totalFiles: files.length,
          filename: file.originalname,
          stage: 'auto-tag',
          message: '자동 태깅 실행 중...',
          timestamp: new Date().toISOString()
        });

        try {
          const imagePath = path.join(UPLOAD_BASE_PATH, processedImage.originalPath);
          const taggerResult = await imageTaggerService.tagImage(imagePath);

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
