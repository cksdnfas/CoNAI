import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { asyncHandler } from '../../middleware/errorHandler';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { ImageTaggingModel } from '../../models/Image/ImageTaggingModel';
import { ImageSearchModel } from '../../models/Image/ImageSearchModel';
import { ImageStatsModel } from '../../models/Image/ImageStatsModel';
import { db } from '../../database/init';
import { imageTaggerService, ImageTaggerService } from '../../services/imageTaggerService';
import { ImageListResponse } from '../../types/image';
import { runtimePaths, resolveUploadsPath } from '../../config/runtimePaths';
import { AutoTagSearchService } from '../../services/autoTagSearchService';
import { AutoTagSearchParams } from '../../types/autoTag';
import { enrichImageRecord } from './utils';
import { RatingScoreService } from '../../services/ratingScoreService';
import { logger } from '../../utils/logger';
import { QueryCacheService } from '../../services/QueryCacheService';

const router = Router();

/**
 * 단일 이미지 태깅 (WD v3 Tagger)
 */
router.post('/:id/tag', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = req.params.id;

  console.log('[TagRoute] POST /:id/tag hit!');
  logger.debug('[TagRoute] POST /:id/tag hit!');
  logger.debug(`[TagRoute] req.params.id: ${compositeHash}`);
  logger.debug(`[TagRoute] req.url: ${req.url}`);
  logger.debug(`[TagRoute] req.path: ${req.path}`);

  if (!compositeHash || typeof compositeHash !== 'string') {
    logger.debug(`[TagRoute] Invalid composite hash: ${compositeHash}`);
    return res.status(400).json({
      success: false,
      error: 'Invalid composite hash'
    });
  }

  try {
    logger.debug(`[TagRoute] Querying database for composite_hash: ${compositeHash}`);

    // 통합 media_metadata 테이블에서 메타데이터 및 파일 정보 조회
    const imageData = db.prepare(`
      SELECT
        mm.*,
        if.original_file_path,
        if.mime_type as file_mime_type
      FROM media_metadata mm
      LEFT JOIN image_files if ON mm.composite_hash = if.composite_hash AND if.file_status = 'active'
      WHERE mm.composite_hash = ?
      LIMIT 1
    `).get(compositeHash) as any;

    if (!imageData) {
      logger.debug('[TagRoute] Media not found in database');
      return res.status(404).json({
        success: false,
        error: 'Image or video not found'
      });
    }

    logger.debug(`[TagRoute] Image data retrieved, file_path: ${imageData.original_file_path}`);

    if (!imageData.original_file_path) {
      return res.status(404).json({
        success: false,
        error: 'No active file found for this image'
      });
    }

    // 원본 이미지 경로
    const imagePath = resolveUploadsPath(imageData.original_file_path);

    logger.debug(`[TagRoute] original_file_path from DB: ${imageData.original_file_path}`);
    logger.debug(`[TagRoute] Calculated imagePath: ${imagePath}`);
    logger.debug(`[TagRoute] File exists? ${fs.existsSync(imagePath)}`);

    if (!fs.existsSync(imagePath)) {
      logger.debug('[TagRoute] Image file not found on disk');
      return res.status(404).json({
        success: false,
        error: 'Image file not found on disk'
      });
    }

    logger.debug(`[ImageTag] Tagging file ${compositeHash}: ${imagePath}`);

    // 동영상 또는 이미지 태깅 실행
    const mimeType = imageData.file_mime_type || imageData.mime_type;
    let taggerResult;
    if (ImageTaggerService.isVideoFile(imagePath, mimeType)) {
      logger.debug('[ImageTag] Detected video file, extracting frames...');
      taggerResult = await imageTaggerService.tagVideo(imagePath);
    } else {
      taggerResult = await imageTaggerService.tagImage(imagePath);
    }

    logger.debug('[ImageTag] Tagger result details logged to file');
    logger.verbose('[ImageTag] Tagger result:', {
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

    // 데이터베이터에 저장 (통합 media_metadata 테이블 업데이트)
    const autoTagsJson = ImageTaggerService.formatForDatabase(taggerResult);
    logger.debug(`[ImageTag] Formatted JSON length: ${autoTagsJson?.length || 0}`);
    if (autoTagsJson) {
      logger.verbose(`[ImageTag] Formatted JSON preview: ${autoTagsJson.substring(0, 100)}`);
    }

    // Calculate rating_score if rating data is available
    let ratingScore = 0;
    if (taggerResult.rating) {
      try {
        const scoreResult = await RatingScoreService.calculateScore(taggerResult.rating as any);
        ratingScore = scoreResult.score;
        logger.debug(`[ImageTag] Calculated rating_score: ${ratingScore}`);
      } catch (error) {
        logger.error('[ImageTag] Failed to calculate rating_score:', error);
      }
    }

    MediaMetadataModel.update(compositeHash, {
      auto_tags: autoTagsJson,
      rating_score: ratingScore
    });

    logger.info(`[ImageTag] Successfully tagged ${compositeHash}`);

    // Invalidate cache for this image
    QueryCacheService.invalidateImageCache(compositeHash, false);

    res.json({
      success: true,
      data: {
        composite_hash: compositeHash,
        auto_tags: autoTagsJson ? JSON.parse(autoTagsJson) : null
      }
    });
    return;
  } catch (error) {
    logger.error('[ImageTag] Error:', error);
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
    let successCount = 0;
    let failCount = 0;

    logger.debug(`[BatchTag] Starting batch tagging for ${image_ids.length} images`);

    const results: any[] = [];

    for (const compositeHash of image_ids) {
      try {
        // 메타데이터 및 파일 정보 조회
        const imageData = db.prepare(`
          SELECT
            mm.*,
            if.original_file_path,
            if.mime_type as file_mime_type
          FROM media_metadata mm
          LEFT JOIN image_files if ON mm.composite_hash = if.composite_hash AND if.file_status = 'active'
          WHERE mm.composite_hash = ?
          LIMIT 1
        `).get(compositeHash) as any;

        if (!imageData) {
          results.push({
            composite_hash: compositeHash,
            success: false,
            error: 'Image not found'
          });
          failCount++;
          continue;
        }

        if (!imageData.original_file_path) {
          results.push({
            composite_hash: compositeHash,
            success: false,
            error: 'No active file found'
          });
          failCount++;
          continue;
        }

        // 원본 이미지 경로
        const imagePath = resolveUploadsPath(imageData.original_file_path);

        if (!fs.existsSync(imagePath)) {
          results.push({
            composite_hash: compositeHash,
            success: false,
            error: 'Image file not found'
          });
          failCount++;
          continue;
        }

        // 동영상 또는 이미지 태깅 실행
        const mimeType = imageData.file_mime_type || imageData.mime_type;
        let taggerResult;
        if (ImageTaggerService.isVideoFile(imagePath, mimeType)) {
          taggerResult = await imageTaggerService.tagVideo(imagePath);
        } else {
          taggerResult = await imageTaggerService.tagImage(imagePath);
        }

        if (!taggerResult.success) {
          results.push({
            composite_hash: compositeHash,
            success: false,
            error: taggerResult.error || 'Tagging failed'
          });
          failCount++;
          continue;
        }

        // 데이터베이스에 저장
        const autoTagsJson = ImageTaggerService.formatForDatabase(taggerResult);

        // Calculate rating_score if rating data is available
        let ratingScore = 0;
        if (taggerResult.rating) {
          try {
            const scoreResult = await RatingScoreService.calculateScore(taggerResult.rating as any);
            ratingScore = scoreResult.score;
          } catch (error) {
            logger.error('[BatchTag] Failed to calculate rating_score:', error);
          }
        }

        MediaMetadataModel.update(compositeHash, {
          auto_tags: autoTagsJson,
          rating_score: ratingScore
        });

        results.push({
          composite_hash: compositeHash,
          success: true,
          auto_tags: autoTagsJson ? JSON.parse(autoTagsJson) : null
        });
        successCount++;

        logger.debug(`[BatchTag] Tagged image ${compositeHash} (${successCount}/${image_ids.length})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          composite_hash: compositeHash,
          success: false,
          error: message
        });
        failCount++;
      }
    }

    logger.info(`[BatchTag] Completed: ${successCount} success, ${failCount} failed`);

    // Invalidate all caches after batch operation
    QueryCacheService.invalidateImageCache(undefined, true);

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
    logger.error('[BatchTag] Error:', error);
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
    // 미처리 이미지 조회 (composite_hash, file_path 포함)
    const untaggedImages = await ImageTaggingModel.findUntagged(maxLimit);

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

    logger.debug(`[BatchTagUnprocessed] Processing ${untaggedImages.length} untagged images`);

    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const image of untaggedImages) {
      try {
        const compositeHash = image.composite_hash || image.id;
        const filePath = image.original_file_path || image.file_path;

        if (!filePath) {
          results.push({
            composite_hash: compositeHash,
            success: false,
            error: 'No file path available'
          });
          failCount++;
          continue;
        }

        const imagePath = resolveUploadsPath(filePath);

        if (!fs.existsSync(imagePath)) {
          results.push({
            composite_hash: compositeHash,
            success: false,
            error: 'Image file not found'
          });
          failCount++;
          continue;
        }

        // 동영상 또는 이미지 태깅 실행
        const mimeType = image.file_mime_type || image.mime_type;
        let taggerResult;
        if (ImageTaggerService.isVideoFile(imagePath, mimeType)) {
          taggerResult = await imageTaggerService.tagVideo(imagePath);
        } else {
          taggerResult = await imageTaggerService.tagImage(imagePath);
        }

        if (!taggerResult.success) {
          results.push({
            composite_hash: compositeHash,
            success: false,
            error: taggerResult.error || 'Tagging failed'
          });
          failCount++;
          continue;
        }

        const autoTagsJson = ImageTaggerService.formatForDatabase(taggerResult);

        // Calculate rating_score if rating data is available
        let ratingScore = 0;
        if (taggerResult.rating) {
          try {
            const scoreResult = await RatingScoreService.calculateScore(taggerResult.rating as any);
            ratingScore = scoreResult.score;
          } catch (error) {
            logger.error('[BatchTagUnprocessed] Failed to calculate rating_score:', error);
          }
        }

        MediaMetadataModel.update(compositeHash, {
          auto_tags: autoTagsJson,
          rating_score: ratingScore
        });

        results.push({
          composite_hash: compositeHash,
          success: true,
          auto_tags: autoTagsJson ? JSON.parse(autoTagsJson) : null
        });
        successCount++;



        logger.debug(`[BatchTagUnprocessed] Tagged file ${compositeHash} (${successCount}/${untaggedImages.length})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        const compositeHash = image.composite_hash || image.id;
        results.push({
          composite_hash: compositeHash,
          success: false,
          error: message
        });
        failCount++;
      }
    }

    logger.info(`[BatchTagUnprocessed] Completed: ${successCount} success, ${failCount} failed`);

    // Invalidate all caches after batch operation
    QueryCacheService.invalidateImageCache(undefined, true);

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
    logger.error('[BatchTagUnprocessed] Error:', error);
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
    // 전체 미디어 composite_hash 조회
    const query = maxLimit
      ? `SELECT composite_hash FROM media_metadata ORDER BY first_seen_date DESC LIMIT ?`
      : `SELECT composite_hash FROM media_metadata ORDER BY first_seen_date DESC`;

    const hashRows = maxLimit
      ? db.prepare(query).all(maxLimit) as any[]
      : db.prepare(query).all() as any[];

    const compositeHashes = hashRows.map(row => row.composite_hash);

    if (compositeHashes.length === 0) {
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

    logger.debug(`[BatchTagAll] Processing ${compositeHashes.length} images (force=${forceRetag})`);

    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const compositeHash of compositeHashes) {
      try {
        // 메타데이터 및 파일 정보 조회
        const imageData = db.prepare(`
          SELECT
            mm.*,
            if.original_file_path,
            if.mime_type as file_mime_type
          FROM media_metadata mm
          LEFT JOIN image_files if ON mm.composite_hash = if.composite_hash AND if.file_status = 'active'
          WHERE mm.composite_hash = ?
          LIMIT 1
        `).get(compositeHash) as any;

        if (!imageData) {
          results.push({
            composite_hash: compositeHash,
            success: false,
            error: 'Image not found'
          });
          failCount++;
          continue;
        }

        if (!imageData.original_file_path) {
          results.push({
            composite_hash: compositeHash,
            success: false,
            error: 'No active file found'
          });
          failCount++;
          continue;
        }

        const imagePath = resolveUploadsPath(imageData.original_file_path);

        if (!fs.existsSync(imagePath)) {
          results.push({
            composite_hash: compositeHash,
            success: false,
            error: 'Image file not found'
          });
          failCount++;
          continue;
        }

        // 동영상 또는 이미지 태깅 실행
        const mimeType = imageData.file_mime_type || imageData.mime_type;
        let taggerResult;
        if (ImageTaggerService.isVideoFile(imagePath, mimeType)) {
          taggerResult = await imageTaggerService.tagVideo(imagePath);
        } else {
          taggerResult = await imageTaggerService.tagImage(imagePath);
        }

        if (!taggerResult.success) {
          results.push({
            composite_hash: compositeHash,
            success: false,
            error: taggerResult.error || 'Tagging failed'
          });
          failCount++;
          continue;
        }

        const autoTagsJson = ImageTaggerService.formatForDatabase(taggerResult);

        // Calculate rating_score if rating data is available
        let ratingScore = 0;
        if (taggerResult.rating) {
          try {
            const scoreResult = await RatingScoreService.calculateScore(taggerResult.rating as any);
            ratingScore = scoreResult.score;
          } catch (error) {
            logger.error('[BatchTagAll] Failed to calculate rating_score:', error);
          }
        }

        MediaMetadataModel.update(compositeHash, {
          auto_tags: autoTagsJson,
          rating_score: ratingScore
        });

        results.push({
          composite_hash: compositeHash,
          success: true,
          auto_tags: autoTagsJson ? JSON.parse(autoTagsJson) : null
        });
        successCount++;



        logger.debug(`[BatchTagAll] Tagged file ${compositeHash} (${successCount}/${compositeHashes.length})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          composite_hash: compositeHash,
          success: false,
          error: message
        });
        failCount++;
      }
    }

    logger.info(`[BatchTagAll] Completed: ${successCount} success, ${failCount} failed`);

    // Invalidate all caches after batch operation
    QueryCacheService.invalidateImageCache(undefined, true);

    res.json({
      success: true,
      data: {
        total: compositeHashes.length,
        success_count: successCount,
        fail_count: failCount,
        results
      }
    });
    return;
  } catch (error) {
    logger.error('[BatchTagAll] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to batch tag all images'
    });
    return;
  }
}));

/**
 * 모든 이미지의 auto_tags 초기화 (재태깅 유도)
 * POST /api/images/reset-auto-tags
 */
router.post('/reset-auto-tags', asyncHandler(async (req: Request, res: Response) => {
  try {
    logger.info('[ResetAutoTags] Resetting all auto_tags to NULL');

    const result = db.prepare(`
      UPDATE media_metadata
      SET auto_tags = NULL
    `).run();

    logger.info(`[ResetAutoTags] Reset complete. Changes: ${result.changes}`);

    // Invalidate all caches
    QueryCacheService.invalidateImageCache(undefined, true);

    res.json({
      success: true,
      data: {
        changes: result.changes,
        message: 'All auto tags have been reset. The scheduler will pick them up shortly.'
      }
    });
  } catch (error) {
    logger.error('[ResetAutoTags] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reset auto tags'
    });
  }
}));

/**
 * 미처리 이미지 개수 조회
 */
router.get('/untagged-count', asyncHandler(async (req: Request, res: Response) => {
  try {
    const count = await ImageTaggingModel.countUntagged();

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
 * 자동태그 기반 이미지 검색 (기본 검색 조건 결합 지원)
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

    // 기본 검색 파라미터 (선택적)
    const basicSearchParams = {
      search_text: req.body.search_text,
      negative_text: req.body.negative_text,
      ai_tool: req.body.ai_tool,
      model_name: req.body.model_name,
      start_date: req.body.start_date,
      end_date: req.body.end_date
    };

    // 검색 파라미터 유효성 검증
    const validation = AutoTagSearchService.validateSearchParams(searchParams);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: `Invalid search parameters: ${validation.errors.join(', ')}`
      });
    }

    // 자동태그 검색 실행 (기본 검색 조건 포함)
    const result = await ImageSearchModel.searchByAutoTags(searchParams, basicSearchParams);

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
    logger.error('[AutoTagSearch] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to search by auto tags'
    } as ImageListResponse);
    return;
  }
}));

/**
 * 자동태그 통계 정보 조회
 * GET /api/images/autotag-stats
 */
router.get('/autotag-stats', asyncHandler(async (req: Request, res: Response) => {
  try {
    const stats = await ImageStatsModel.getAutoTagStats();

    res.json({
      success: true,
      data: stats
    });
    return;
  } catch (error) {
    logger.error('[AutoTagStats] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get auto tag statistics'
    });
    return;
  }
}));

/**
 * 모든 media_metadata의 rating_score 재계산
 * POST /api/images/recalculate-rating-scores
 */
router.post('/recalculate-rating-scores', asyncHandler(async (req: Request, res: Response) => {
  try {
    logger.info('[RecalculateRatingScores] Starting rating score recalculation for all images');

    // Get all media_metadata with auto_tags
    const imagesWithTags = db.prepare(`
      SELECT composite_hash, auto_tags
      FROM media_metadata
      WHERE auto_tags IS NOT NULL
    `).all() as Array<{ composite_hash: string; auto_tags: string }>;

    console.log(`[RecalculateRatingScores] Found ${imagesWithTags.length} images with auto_tags`);

    let successCount = 0;
    let failCount = 0;
    const results = [];

    for (const image of imagesWithTags) {
      try {
        const autoTagsData = JSON.parse(image.auto_tags);

        if (autoTagsData.rating) {
          // Calculate rating score
          const scoreResult = await RatingScoreService.calculateScore(autoTagsData.rating);

          // Update only rating_score
          db.prepare(`
            UPDATE media_metadata
            SET rating_score = ?
            WHERE composite_hash = ?
          `).run(scoreResult.score, image.composite_hash);

          successCount++;
          results.push({
            composite_hash: image.composite_hash,
            success: true,
            rating_score: scoreResult.score
          });
        } else {
          // No rating data, set to 0
          db.prepare(`
            UPDATE media_metadata
            SET rating_score = 0
            WHERE composite_hash = ?
          `).run(image.composite_hash);

          successCount++;
          results.push({
            composite_hash: image.composite_hash,
            success: true,
            rating_score: 0,
            note: 'No rating data available'
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[RecalculateRatingScores] Failed for ${image.composite_hash}:`, message);
        failCount++;
        results.push({
          composite_hash: image.composite_hash,
          success: false,
          error: message
        });
      }
    }

    logger.info(`[RecalculateRatingScores] Completed: ${successCount} updated, ${failCount} errors`);

    // Invalidate all caches after recalculation
    QueryCacheService.invalidateImageCache(undefined, true);

    res.json({
      success: true,
      data: {
        total: imagesWithTags.length,
        fail_count: failCount,
        results
      }
    });
    return;
  } catch (error) {
    console.error('[RecalculateRatingScores] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to recalculate rating scores'
    });
    return;
  }
}));

export { router as taggingRoutes };
