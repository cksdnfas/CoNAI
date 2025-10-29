import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { asyncHandler } from '../../middleware/errorHandler';
import { ImageModel } from '../../models/Image';
import { ImageMetadataModel } from '../../models/Image/ImageMetadataModel';
import { db } from '../../database/init';
import { imageTaggerService, ImageTaggerService } from '../../services/imageTaggerService';
import { ImageListResponse } from '../../types/image';
import { runtimePaths, resolveUploadsPath } from '../../config/runtimePaths';
import { AutoTagSearchService } from '../../services/autoTagSearchService';
import { AutoTagSearchParams } from '../../types/autoTag';
import { enrichImageRecord } from './utils';

const router = Router();

/**
 * 단일 이미지 태깅 (WD v3 Tagger)
 */
router.post('/:id/tag', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = req.params.id;

  console.log('[TagRoute] POST /:id/tag hit!');
  console.log('[TagRoute] req.params.id:', compositeHash);
  console.log('[TagRoute] req.url:', req.url);
  console.log('[TagRoute] req.path:', req.path);

  if (!compositeHash || typeof compositeHash !== 'string') {
    console.log('[TagRoute] Invalid composite hash:', compositeHash);
    return res.status(400).json({
      success: false,
      error: 'Invalid composite hash'
    });
  }

  try {
    console.log('[TagRoute] Querying database for composite_hash:', compositeHash);

    // 이미지 메타데이터 및 파일 정보 조회
    const imageData = db.prepare(`
      SELECT
        im.*,
        if.original_file_path,
        if.mime_type as file_mime_type
      FROM image_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
      WHERE im.composite_hash = ?
      LIMIT 1
    `).get(compositeHash) as any;

    console.log('[TagRoute] Database query result:', imageData ? 'Found' : 'Not found');

    if (!imageData) {
      console.log('[TagRoute] Image not found in database');
      return res.status(404).json({
        success: false,
        error: 'Image not found'
      });
    }

    console.log('[TagRoute] Image data retrieved, file_path:', imageData.original_file_path);

    if (!imageData.original_file_path) {
      return res.status(404).json({
        success: false,
        error: 'No active file found for this image'
      });
    }

    // 원본 이미지 경로
    const imagePath = resolveUploadsPath(imageData.original_file_path);

    console.log('[TagRoute] original_file_path from DB:', imageData.original_file_path);
    console.log('[TagRoute] Calculated imagePath:', imagePath);
    console.log('[TagRoute] File exists?', fs.existsSync(imagePath));

    if (!fs.existsSync(imagePath)) {
      console.log('[TagRoute] Image file not found on disk');
      return res.status(404).json({
        success: false,
        error: 'Image file not found on disk'
      });
    }

    console.log(`[ImageTag] Tagging file ${compositeHash}: ${imagePath}`);

    // 동영상 또는 이미지 태깅 실행
    const mimeType = imageData.file_mime_type || imageData.mime_type;
    let taggerResult;
    if (ImageTaggerService.isVideoFile(imagePath, mimeType)) {
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

    ImageMetadataModel.update(compositeHash, { auto_tags: autoTagsJson });

    console.log(`[ImageTag] Successfully tagged image ${compositeHash}`);

    res.json({
      success: true,
      data: {
        composite_hash: compositeHash,
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

    for (const compositeHash of image_ids) {
      try {
        // 이미지 메타데이터 및 파일 정보 조회
        const imageData = db.prepare(`
          SELECT
            im.*,
            if.original_file_path,
            if.mime_type as file_mime_type
          FROM image_metadata im
          LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
          WHERE im.composite_hash = ?
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
        ImageMetadataModel.update(compositeHash, { auto_tags: autoTagsJson });

        results.push({
          composite_hash: compositeHash,
          success: true,
          auto_tags: autoTagsJson ? JSON.parse(autoTagsJson) : null
        });
        successCount++;

        console.log(`[BatchTag] Tagged image ${compositeHash} (${successCount}/${image_ids.length})`);
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
    // 미처리 이미지 조회 (composite_hash, file_path 포함)
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
        ImageMetadataModel.update(compositeHash, { auto_tags: autoTagsJson });

        results.push({
          composite_hash: compositeHash,
          success: true,
          auto_tags: autoTagsJson ? JSON.parse(autoTagsJson) : null
        });
        successCount++;

        console.log(`[BatchTagUnprocessed] Tagged file ${compositeHash} (${successCount}/${untaggedImages.length})`);
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
    // 전체 이미지 composite_hash 조회
    const query = maxLimit
      ? `SELECT composite_hash FROM image_metadata ORDER BY first_seen_date DESC LIMIT ?`
      : `SELECT composite_hash FROM image_metadata ORDER BY first_seen_date DESC`;

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

    console.log(`[BatchTagAll] Processing ${compositeHashes.length} images (force=${forceRetag})`);

    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const compositeHash of compositeHashes) {
      try {
        // 이미지 메타데이터 및 파일 정보 조회
        const imageData = db.prepare(`
          SELECT
            im.*,
            if.original_file_path,
            if.mime_type as file_mime_type
          FROM image_metadata im
          LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
          WHERE im.composite_hash = ?
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
        ImageMetadataModel.update(compositeHash, { auto_tags: autoTagsJson });

        results.push({
          composite_hash: compositeHash,
          success: true,
          auto_tags: autoTagsJson ? JSON.parse(autoTagsJson) : null
        });
        successCount++;

        console.log(`[BatchTagAll] Tagged file ${compositeHash} (${successCount}/${compositeHashes.length})`);
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

    console.log(`[BatchTagAll] Completed: ${successCount} success, ${failCount} failed`);

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
 * 오토태그 기반 이미지 검색 (기본 검색 조건 결합 지원)
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

    // 오토태그 검색 실행 (기본 검색 조건 포함)
    const result = await ImageModel.searchByAutoTags(searchParams, basicSearchParams);

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
