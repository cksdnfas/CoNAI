import { Router, Request, Response } from 'express';
import path from 'path';
import { uploadSingle, uploadMultiple } from '../../middleware/upload';
import { asyncHandler } from '../../middleware/errorHandler';
import { ImageProcessor } from '../../services/imageProcessor';
import { ImageModel } from '../../models/Image';
import { PromptCollectionService } from '../../services/promptCollectionService';
import { AutoCollectionService } from '../../services/autoCollectionService';
import { imageTaggerService, ImageTaggerService } from '../../services/imageTaggerService';
import { UploadResponse } from '../../types/image';
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

    // 자동수집 그룹 처리 (비동기로 처리, 오류가 있어도 업로드는 계속 진행)
    try {
      console.log('🔍 Running auto collection for new image...');
      const autoCollectResults = await AutoCollectionService.runAutoCollectionForNewImage(imageId);
      if (autoCollectResults.length > 0) {
        console.log(`✅ Image automatically added to ${autoCollectResults.length} groups`);
      }
    } catch (autoCollectError) {
      console.warn('⚠️ Failed to run auto collection (non-critical):', autoCollectError);
    }

    // 자동 태깅 (설정에서 활성화된 경우)
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

        // 자동수집 그룹 처리 (비동기로 처리, 오류가 있어도 업로드는 계속 진행)
        try {
          const autoCollectResults = await AutoCollectionService.runAutoCollectionForNewImage(imageId);
          if (autoCollectResults.length > 0) {
            console.log(`✅ ${file.originalname} automatically added to ${autoCollectResults.length} groups`);
          }
        } catch (autoCollectError) {
          console.warn('⚠️ Failed to run auto collection for', file.originalname, '(non-critical):', autoCollectError);
        }

        // 자동 태깅 (설정에서 활성화된 경우)
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

export { router as uploadRoutes };
