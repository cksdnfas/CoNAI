import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { asyncHandler } from '../../middleware/errorHandler';
import { ImageModel } from '../../models/Image';
import { imageTaggerService, ImageTaggerService } from '../../services/imageTaggerService';
import { ImageListResponse } from '../../types/image';
import { runtimePaths } from '../../config/runtimePaths';
import { AutoTagSearchService } from '../../services/autoTagSearchService';
import { AutoTagSearchParams } from '../../types/autoTag';
import { enrichImageRecord } from './utils';

const router = Router();
const UPLOAD_BASE_PATH = runtimePaths.uploadsDir;

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

    console.log(`[ImageTag] Tagging file ${id}: ${imagePath}`);

    // 동영상 또는 이미지 태깅 실행
    let taggerResult;
    if (ImageTaggerService.isVideoFile(imagePath, image.mime_type)) {
      console.log('[ImageTag] Detected video file, extracting frames...');
      taggerResult = await imageTaggerService.tagVideo(imagePath);
    } else {
      taggerResult = await imageTaggerService.tagImage(imagePath);
    }

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

        // 동영상 또는 이미지 태깅 실행
        let taggerResult;
        if (ImageTaggerService.isVideoFile(imagePath, image.mime_type)) {
          taggerResult = await imageTaggerService.tagVideo(imagePath);
        } else {
          taggerResult = await imageTaggerService.tagImage(imagePath);
        }

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

        // 동영상 또는 이미지 태깅 실행
        let taggerResult;
        if (ImageTaggerService.isVideoFile(imagePath, image.mime_type)) {
          taggerResult = await imageTaggerService.tagVideo(imagePath);
        } else {
          taggerResult = await imageTaggerService.tagImage(imagePath);
        }

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

        console.log(`[BatchTagUnprocessed] Tagged file ${image.id} (${successCount}/${untaggedImages.length})`);
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

        // 동영상 또는 이미지 태깅 실행
        let taggerResult;
        if (ImageTaggerService.isVideoFile(imagePath, image.mime_type)) {
          taggerResult = await imageTaggerService.tagVideo(imagePath);
        } else {
          taggerResult = await imageTaggerService.tagImage(imagePath);
        }

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

        console.log(`[BatchTagAll] Tagged file ${id} (${successCount}/${imageIds.length})`);
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
 * 오토태그 기반 이미지 검색
 * POST /api/images/search-by-autotags
 */
router.post('/search-by-autotags', asyncHandler(async (req: Request, res: Response) => {
  try {
    const searchParams: AutoTagSearchParams = {
      rating: req.body.rating,
      rating_score: req.body.rating_score,
      general_tags: req.body.general_tags,
      character: req.body.character,
      model: req.body.model,
      has_auto_tags: req.body.has_auto_tags,
      page: parseInt(req.body.page) || 1,
      limit: parseInt(req.body.limit) || 20,
      sortBy: req.body.sortBy || 'upload_date',
      sortOrder: req.body.sortOrder || 'DESC'
    };

    // 검색 파라미터 유효성 검증
    const validation = AutoTagSearchService.validateSearchParams(searchParams);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: `Invalid search parameters: ${validation.errors.join(', ')}`
      });
    }

    // 오토태그 검색 실행
    const result = await ImageModel.searchByAutoTags(searchParams);

    // URL과 구조화된 메타데이터 추가
    const enrichedImages = result.images.map(enrichImageRecord);

    const response: ImageListResponse = {
      success: true,
      data: {
        images: enrichedImages,
        total: result.total,
        page: searchParams.page!,
        limit: searchParams.limit!,
        totalPages: Math.ceil(result.total / searchParams.limit!)
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('[AutoTagSearch] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to search by auto tags'
    } as ImageListResponse);
    return;
  }
}));

/**
 * 오토태그 통계 정보 조회
 * GET /api/images/autotag-stats
 */
router.get('/autotag-stats', asyncHandler(async (req: Request, res: Response) => {
  try {
    const stats = await ImageModel.getAutoTagStats();

    res.json({
      success: true,
      data: stats
    });
    return;
  } catch (error) {
    console.error('[AutoTagStats] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get auto tag statistics'
    });
    return;
  }
}));

export { router as taggingRoutes };
