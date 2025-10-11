import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { uploadSingle, uploadMultiple } from '../middleware/upload';
import { asyncHandler } from '../middleware/errorHandler';
import { ImageProcessor } from '../services/imageProcessor';
import { ImageModel } from '../models/Image';
import { PromptCollectionService } from '../services/promptCollectionService';
import { AutoCollectionService } from '../services/autoCollectionService';
import { imageTaggerService, ImageTaggerService } from '../services/imageTaggerService';
import { UploadResponse, ImageListResponse } from '../types/image';
import { runtimePaths, toUploadsUrl } from '../config/runtimePaths';

const router = Router();
const UPLOAD_BASE_PATH = runtimePaths.uploadsDir;

/**
 * 이미지 레코드에 URL과 구조화된 메타데이터 추가
 */
function enrichImageRecord(image: any) {
  const enriched = {
    ...image,
    thumbnail_url: toUploadsUrl(image.thumbnail_path as string)!,
    image_url: toUploadsUrl(image.file_path as string)!,
    optimized_url: image.optimized_path ? toUploadsUrl(image.optimized_path) : null,

    // 그룹 정보 (이미 있는 경우 그대로 유지)
    groups: image.groups || [],

    // 구조화된 AI 메타데이터
    ai_metadata: {
      ai_tool: image.ai_tool,
      model_name: image.model_name,
      lora_models: image.lora_models ? JSON.parse(image.lora_models) : null,
      generation_params: {
        steps: image.steps,
        cfg_scale: image.cfg_scale,
        sampler: image.sampler,
        seed: image.seed,
        scheduler: image.scheduler,
        denoise_strength: image.denoise_strength,
        generation_time: image.generation_time,
        batch_size: image.batch_size,
        batch_index: image.batch_index
      },
      prompts: {
        prompt: image.prompt,
        negative_prompt: image.negative_prompt
      }
    },

    // 원본 메타데이터는 그대로 유지
    metadata: image.metadata ? JSON.parse(image.metadata) : null,

    // 자동 태그 정보 추가
    auto_tags: image.auto_tags ? JSON.parse(image.auto_tags) : null
  };

  // null 값 정리
  if (!enriched.ai_metadata.lora_models) {
    delete enriched.ai_metadata.lora_models;
  }

  // generation_params에서 null 값 제거
  Object.keys(enriched.ai_metadata.generation_params).forEach(key => {
    if (enriched.ai_metadata.generation_params[key] === null || enriched.ai_metadata.generation_params[key] === undefined) {
      delete enriched.ai_metadata.generation_params[key];
    }
  });

  // prompts에서 null 값 제거
  Object.keys(enriched.ai_metadata.prompts).forEach(key => {
    if (enriched.ai_metadata.prompts[key] === null || enriched.ai_metadata.prompts[key] === undefined) {
      delete enriched.ai_metadata.prompts[key];
    }
  });

  return enriched;
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
      const { settingsService } = await import('../services/settingsService');
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
          const { settingsService } = await import('../services/settingsService');
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

/**
 * 이미지 목록 조회 (그룹 정보 포함)
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const sortBy = (req.query.sortBy as 'upload_date' | 'filename' | 'file_size') || 'upload_date';
  const sortOrder = (req.query.sortOrder as 'ASC' | 'DESC') || 'DESC';

  try {
    // 기본적으로 그룹 정보 포함하여 조회
    const result = await ImageModel.findWithGroups(page, limit, sortBy, sortOrder);

    // URL과 구조화된 메타데이터 추가
    const enrichedImages = result.images.map(enrichImageRecord);

    const response: ImageListResponse = {
      success: true,
      data: {
        images: enrichedImages,
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit)
      }
    };

    return res.json(response);
    return;
  } catch (error) {
    console.error('Get images error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch images'
    } as ImageListResponse);
    return;
  }
}));

/**
 * 고급 이미지 검색 (프롬프트 중심)
 * POST /api/images/search
 */
router.post('/search', asyncHandler(async (req: Request, res: Response) => {
  const {
    search_text,         // 긍정 프롬프트 검색 키워드
    negative_text,       // 네거티브 프롬프트 검색 키워드 (필터)
    ai_tool,
    model_name,
    min_width,
    max_width,
    min_height,
    max_height,
    min_file_size,
    max_file_size,
    start_date,
    end_date,
    group_id,
    page = 1,
    limit = 20,
    sortBy = 'upload_date',
    sortOrder = 'DESC'
  } = req.body;

  try {
    const searchParams = {
      search_text,
      negative_text,
      ai_tool,
      model_name,
      min_width: min_width ? parseInt(min_width) : undefined,
      max_width: max_width ? parseInt(max_width) : undefined,
      min_height: min_height ? parseInt(min_height) : undefined,
      max_height: max_height ? parseInt(max_height) : undefined,
      min_file_size: min_file_size ? parseInt(min_file_size) : undefined,
      max_file_size: max_file_size ? parseInt(max_file_size) : undefined,
      start_date,
      end_date,
      group_id: group_id !== undefined ? parseInt(group_id) : undefined
    };

    const result = await ImageModel.advancedSearch(
      searchParams,
      parseInt(page),
      parseInt(limit),
      sortBy,
      sortOrder
    );

    // URL과 구조화된 메타데이터 추가 (그룹 정보 이미 포함됨)
    const enrichedImages = result.images.map(enrichImageRecord);

    const response: ImageListResponse = {
      success: true,
      data: {
        images: enrichedImages,
        total: result.total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(result.total / parseInt(limit))
      }
    };

    return res.json(response);
    return;
  } catch (error) {
    console.error('Advanced search error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to perform advanced search'
    } as ImageListResponse);
    return;
  }
}));

/**
 * 특정 이미지 조회
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid image ID'
    });
  }

  try {
    const image = await ImageModel.findById(id);

    if (!image) {
      return res.status(404).json({
        success: false,
        error: 'Image not found'
      });
    }

    res.json({
      success: true,
      data: enrichImageRecord(image)
    });
    return;
  } catch (error) {
    console.error('Get image error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch image'
    });
    return;
  }
}));

/**
 * 날짜 범위로 이미지 조회
 */
router.get('/date/:startDate/:endDate', asyncHandler(async (req: Request, res: Response) => {
  const { startDate, endDate } = req.params;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;

  try {
    const result = await ImageModel.findByDateRange(startDate, endDate, page, limit);

    const enrichedImages = result.images.map(enrichImageRecord);

    res.json({
      success: true,
      data: {
        images: enrichedImages,
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit)
      }
    });
    return;
  } catch (error) {
    console.error('Get images by date error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch images by date'
    });
    return;
  }
}));

/**
 * 원본 이미지 다운로드
 */
router.get('/:id/download/original', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid image ID'
    });
  }

  try {
    const image = await ImageModel.findById(id);

    if (!image) {
      return res.status(404).json({
        success: false,
        error: 'Image not found'
      });
    }

    const filePath = path.join(UPLOAD_BASE_PATH, image.file_path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    // 파일 다운로드 헤더 설정
    res.setHeader('Content-Disposition', `attachment; filename="${image.original_name}"`);
    res.setHeader('Content-Type', image.mime_type);

    // 파일 스트림으로 전송
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    return;
  } catch (error) {
    console.error('Original download error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to download original image'
    });
    return;
  }
}));

/**
 * 저용량 이미지 다운로드
 */
router.get('/:id/download/optimized', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid image ID'
    });
  }

  try {
    const image = await ImageModel.findById(id);

    if (!image) {
      return res.status(404).json({
        success: false,
        error: 'Image not found'
      });
    }

    if (!image.optimized_path) {
      return res.status(404).json({
        success: false,
        error: 'Optimized version not available'
      });
    }

    const filePath = path.join(UPLOAD_BASE_PATH, image.optimized_path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'Optimized file not found'
      });
    }

    // 파일 다운로드 헤더 설정
    const originalName = path.parse(image.original_name).name;
    res.setHeader('Content-Disposition', `attachment; filename="${originalName}_optimized.webp"`);
    res.setHeader('Content-Type', 'image/webp');

    // 파일 스트림으로 전송
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    return;
  } catch (error) {
    console.error('Optimized download error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to download optimized image'
    });
    return;
  }
}));

/**
 * 단일 이미지 태깅 (WD v3 Tagger)
 */
router.post('/:id/tag', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid image ID'
    });
  }

  try {
    // 이미지 정보 조회
    const image = await ImageModel.findById(id);

    if (!image) {
      return res.status(404).json({
        success: false,
        error: 'Image not found'
      });
    }

    // 원본 이미지 경로
    const imagePath = path.join(UPLOAD_BASE_PATH, image.file_path);

    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({
        success: false,
        error: 'Image file not found'
      });
    }

    console.log(`[ImageTag] Tagging image ${id}: ${imagePath}`);

    // 이미지 태깅 실행
    const taggerResult = await imageTaggerService.tagImage(imagePath);

    console.log('[ImageTag] Tagger result:', {
      success: taggerResult.success,
      hasCaption: !!taggerResult.caption,
      hasGeneral: !!taggerResult.general,
      captionLength: taggerResult.caption?.length || 0
    });

    if (!taggerResult.success) {
      return res.status(500).json({
        success: false,
        error: taggerResult.error || 'Tagging failed',
        details: {
          error_type: taggerResult.error_type
        }
      });
    }

    // 데이터베이스에 저장
    const autoTagsJson = ImageTaggerService.formatForDatabase(taggerResult);
    console.log('[ImageTag] Formatted JSON length:', autoTagsJson?.length || 0);
    console.log('[ImageTag] Formatted JSON preview:', autoTagsJson?.substring(0, 100));

    await ImageModel.updateAutoTags(id, autoTagsJson);

    console.log(`[ImageTag] Successfully tagged image ${id}`);

    res.json({
      success: true,
      data: {
        image_id: id,
        auto_tags: autoTagsJson ? JSON.parse(autoTagsJson) : null
      }
    });
    return;
  } catch (error) {
    console.error('[ImageTag] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to tag image'
    });
    return;
  }
}));

/**
 * 일괄 이미지 태깅 (WD v3 Tagger)
 */
router.post('/batch-tag', asyncHandler(async (req: Request, res: Response) => {
  const { image_ids } = req.body;

  if (!Array.isArray(image_ids) || image_ids.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'image_ids must be a non-empty array'
    });
  }

  try {
    const results = [];
    let successCount = 0;
    let failCount = 0;

    console.log(`[BatchTag] Starting batch tagging for ${image_ids.length} images`);

    for (const id of image_ids) {
      try {
        // 이미지 정보 조회
        const image = await ImageModel.findById(id);

        if (!image) {
          results.push({
            image_id: id,
            success: false,
            error: 'Image not found'
          });
          failCount++;
          continue;
        }

        // 원본 이미지 경로
        const imagePath = path.join(UPLOAD_BASE_PATH, image.file_path);

        if (!fs.existsSync(imagePath)) {
          results.push({
            image_id: id,
            success: false,
            error: 'Image file not found'
          });
          failCount++;
          continue;
        }

        // 이미지 태깅 실행
        const taggerResult = await imageTaggerService.tagImage(imagePath);

        if (!taggerResult.success) {
          results.push({
            image_id: id,
            success: false,
            error: taggerResult.error || 'Tagging failed'
          });
          failCount++;
          continue;
        }

        // 데이터베이스에 저장
        const autoTagsJson = ImageTaggerService.formatForDatabase(taggerResult);
        await ImageModel.updateAutoTags(id, autoTagsJson);

        results.push({
          image_id: id,
          success: true,
          auto_tags: autoTagsJson ? JSON.parse(autoTagsJson) : null
        });
        successCount++;

        console.log(`[BatchTag] Tagged image ${id} (${successCount}/${image_ids.length})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          image_id: id,
          success: false,
          error: message
        });
        failCount++;
      }
    }

    console.log(`[BatchTag] Completed: ${successCount} success, ${failCount} failed`);

    res.json({
      success: true,
      data: {
        total: image_ids.length,
        success_count: successCount,
        fail_count: failCount,
        results
      }
    });
    return;
  } catch (error) {
    console.error('[BatchTag] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to batch tag images'
    });
    return;
  }
}));

/**
 * 미처리 이미지 일괄 태깅 (auto_tags IS NULL)
 */
router.post('/batch-tag-unprocessed', asyncHandler(async (req: Request, res: Response) => {
  const { limit } = req.body;
  const maxLimit = limit ? parseInt(limit) : 100;

  try {
    // 미처리 이미지 조회
    const untaggedImages = await ImageModel.findUntagged(maxLimit);

    if (untaggedImages.length === 0) {
      res.json({
        success: true,
        data: {
          total: 0,
          success_count: 0,
          fail_count: 0,
          message: 'No untagged images found',
          results: []
        }
      });
      return;
    }

    console.log(`[BatchTagUnprocessed] Processing ${untaggedImages.length} untagged images`);

    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const image of untaggedImages) {
      try {
        const imagePath = path.join(UPLOAD_BASE_PATH, image.file_path);

        if (!fs.existsSync(imagePath)) {
          results.push({
            image_id: image.id,
            success: false,
            error: 'Image file not found'
          });
          failCount++;
          continue;
        }

        const taggerResult = await imageTaggerService.tagImage(imagePath);

        if (!taggerResult.success) {
          results.push({
            image_id: image.id,
            success: false,
            error: taggerResult.error || 'Tagging failed'
          });
          failCount++;
          continue;
        }

        const autoTagsJson = ImageTaggerService.formatForDatabase(taggerResult);
        await ImageModel.updateAutoTags(image.id, autoTagsJson);

        results.push({
          image_id: image.id,
          success: true,
          auto_tags: autoTagsJson ? JSON.parse(autoTagsJson) : null
        });
        successCount++;

        console.log(`[BatchTagUnprocessed] Tagged image ${image.id} (${successCount}/${untaggedImages.length})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          image_id: image.id,
          success: false,
          error: message
        });
        failCount++;
      }
    }

    console.log(`[BatchTagUnprocessed] Completed: ${successCount} success, ${failCount} failed`);

    res.json({
      success: true,
      data: {
        total: untaggedImages.length,
        success_count: successCount,
        fail_count: failCount,
        results
      }
    });
    return;
  } catch (error) {
    console.error('[BatchTagUnprocessed] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to batch tag unprocessed images'
    });
    return;
  }
}));

/**
 * 전체 이미지 재태깅
 */
router.post('/batch-tag-all', asyncHandler(async (req: Request, res: Response) => {
  const { limit, force } = req.body;
  const maxLimit = limit ? parseInt(limit) : 100;
  const forceRetag = force !== undefined ? force : true;

  try {
    // 전체 이미지 ID 조회
    const imageIds = await ImageModel.findAllIds(maxLimit);

    if (imageIds.length === 0) {
      res.json({
        success: true,
        data: {
          total: 0,
          success_count: 0,
          fail_count: 0,
          message: 'No images found',
          results: []
        }
      });
      return;
    }

    console.log(`[BatchTagAll] Processing ${imageIds.length} images (force=${forceRetag})`);

    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const id of imageIds) {
      try {
        const image = await ImageModel.findById(id);

        if (!image) {
          results.push({
            image_id: id,
            success: false,
            error: 'Image not found'
          });
          failCount++;
          continue;
        }

        const imagePath = path.join(UPLOAD_BASE_PATH, image.file_path);

        if (!fs.existsSync(imagePath)) {
          results.push({
            image_id: id,
            success: false,
            error: 'Image file not found'
          });
          failCount++;
          continue;
        }

        const taggerResult = await imageTaggerService.tagImage(imagePath);

        if (!taggerResult.success) {
          results.push({
            image_id: id,
            success: false,
            error: taggerResult.error || 'Tagging failed'
          });
          failCount++;
          continue;
        }

        const autoTagsJson = ImageTaggerService.formatForDatabase(taggerResult);
        await ImageModel.updateAutoTags(id, autoTagsJson);

        results.push({
          image_id: id,
          success: true,
          auto_tags: autoTagsJson ? JSON.parse(autoTagsJson) : null
        });
        successCount++;

        console.log(`[BatchTagAll] Tagged image ${id} (${successCount}/${imageIds.length})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          image_id: id,
          success: false,
          error: message
        });
        failCount++;
      }
    }

    console.log(`[BatchTagAll] Completed: ${successCount} success, ${failCount} failed`);

    res.json({
      success: true,
      data: {
        total: imageIds.length,
        success_count: successCount,
        fail_count: failCount,
        results
      }
    });
    return;
  } catch (error) {
    console.error('[BatchTagAll] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to batch tag all images'
    });
    return;
  }
}));

/**
 * 미처리 이미지 개수 조회
 */
router.get('/untagged-count', asyncHandler(async (req: Request, res: Response) => {
  try {
    const count = await ImageModel.countUntagged();

    res.json({
      success: true,
      data: {
        count
      }
    });
    return;
  } catch (error) {
    console.error('[UntaggedCount] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to count untagged images'
    });
    return;
  }
}));

/**
 * Check Python dependencies for tagger
 */
router.get('/tagger/check', asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await imageTaggerService.checkPythonDependencies();
    const status = await imageTaggerService.getStatus();

    res.json({
      success: true,
      data: {
        dependencies: result,
        daemon_status: status,
        models_dir: runtimePaths.modelsDir
      }
    });
    return;
  } catch (error) {
    console.error('[TaggerCheck] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check tagger status'
    });
    return;
  }
}));

/**
 * 이미지 삭제
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid image ID'
    });
  }

  try {
    // 이미지 정보 조회
    const image = await ImageModel.findById(id);

    if (!image) {
      return res.status(404).json({
        success: false,
        error: 'Image not found'
      });
    }

    // 프롬프트 사용 횟수 감산 (비동기로 처리, 오류가 있어도 삭제는 계속 진행)
    try {
      console.log('🔍 Removing prompts from collection...');
      await PromptCollectionService.removeFromImage(
        image.prompt || null,
        image.negative_prompt || null
      );
      console.log('✅ Prompts removed from collection successfully');
    } catch (promptError) {
      console.warn('⚠️ Failed to remove prompts from collection (non-critical):', promptError);
    }

    // 파일 삭제 (3개 버전 모두)
    await ImageProcessor.deleteImageFiles(
      image.file_path,
      image.thumbnail_path,
      image.optimized_path || '',
      UPLOAD_BASE_PATH
    );

    // 데이터베이스에서 삭제
    const deleted = await ImageModel.delete(id);

    if (deleted) {
      res.json({
        success: true,
        message: 'Image deleted successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to delete image from database'
      });
    }
    return;
  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete image'
    });
    return;
  }
}));

export { router as imageRoutes };