import { Router, Request, Response } from 'express';
import { routeParam } from './routeParam';
import path from 'path';
import fs from 'fs';
import { asyncHandler } from '../middleware/asyncHandler';
import { optionalAuth } from '../middleware/authMiddleware';
import { CivitaiSettings } from '../models/CivitaiSettings';
import { ModelInfo } from '../models/ModelInfo';
import { ImageModel } from '../models/ImageModel';
import { MediaMetadataModel } from '../models/Image/MediaMetadataModel';
import { CivitaiTempUrl } from '../models/CivitaiTempUrl';
import { resolveUploadsPath } from '../config/runtimePaths';
import { CivitaiService } from '../services/civitaiService';
import { CivitaiTempUrlService } from '../services/civitaiTempUrlService';
import { ImageSafetyService } from '../services/imageSafetyService';
import { db } from '../database/init';

const router = Router();

router.use(optionalAuth);

/**
 * Get Civitai settings
 * GET /api/civitai/settings
 */
router.get('/settings', asyncHandler(async (req: Request, res: Response) => {
  const settings = CivitaiSettings.get();
  res.json({
    success: true,
    data: settings
  });
}));

/**
 * Update Civitai settings
 * PUT /api/civitai/settings
 */
router.put('/settings', asyncHandler(async (req: Request, res: Response) => {
  const { enabled, apiCallInterval } = req.body;

  const updated = CivitaiSettings.update({
    enabled,
    apiCallInterval
  });

  const settings = CivitaiSettings.get();
  res.json({
    success: true,
    data: settings
  });
}));

/**
 * Get Civitai statistics
 * GET /api/civitai/stats
 */
router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
  const settings = CivitaiSettings.get();
  res.json({
    success: true,
    data: {
      totalLookups: settings.totalLookups,
      successfulLookups: settings.successfulLookups,
      failedLookups: settings.failedLookups,
      lastApiCall: settings.lastApiCall,
      successRate: settings.totalLookups > 0
        ? Math.round((settings.successfulLookups / settings.totalLookups) * 100)
        : 0
    }
  });
}));

/**
 * Reset statistics
 * POST /api/civitai/stats/reset
 */
router.post('/stats/reset', asyncHandler(async (req: Request, res: Response) => {
  CivitaiSettings.resetStats();
  res.json({
    success: true,
    message: 'Statistics reset'
  });
}));

/**
 * Get all cached models
 * GET /api/civitai/models
 */
router.get('/models', asyncHandler(async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const offset = parseInt(req.query.offset as string) || 0;

  const models = ModelInfo.findAll(limit, offset);
  res.json({
    success: true,
    data: models
  });
}));

/**
 * Get model info by hash
 * GET /api/civitai/models/:hash
 */
router.get('/models/:hash', asyncHandler(async (req: Request, res: Response) => {
  const hash = routeParam(req.params.hash);
  const model = ModelInfo.findByHash(hash);

  if (!model) {
    res.status(404).json({
      success: false,
      error: 'Model not found in cache'
    });
    return;
  }

  res.json({
    success: true,
    data: model
  });
}));

/**
 * Get models used in an image
 * GET /api/civitai/images/:compositeHash/models
 */
router.get('/images/:compositeHash/models', asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = routeParam(req.params.compositeHash);
  const imageModels = ImageModel.findByCompositeHash(compositeHash);

  // Enrich with model info
  const enriched = imageModels.map(im => {
    const modelInfo = ModelInfo.findByHash(im.model_hash);
    return {
      ...im,
      modelInfo: modelInfo || null
    };
  });

  res.json({
    success: true,
    data: enriched
  });
}));

/**
 * Manually trigger lookup for a hash
 * POST /api/civitai/lookup/:hash
 */
router.post('/lookup/:hash', asyncHandler(async (req: Request, res: Response) => {
  const hash = routeParam(req.params.hash);

  // 활성화 상태 확인
  const settings = CivitaiSettings.get();
  if (!settings.enabled) {
    res.status(400).json({
      success: false,
      error: 'Civitai integration is disabled. Please enable it in settings.',
      code: 'CIVITAI_DISABLED'
    });
    return;
  }

  const success = await CivitaiService.lookupAndCacheModel(hash);

  if (success) {
    const model = ModelInfo.findByHash(hash);
    res.json({
      success: true,
      data: model
    });
  } else {
    res.status(404).json({
      success: false,
      error: 'Model not found on Civitai'
    });
  }
}));

/**
 * Reset failed lookups to allow retry
 * POST /api/civitai/reset-failed
 */
router.post('/reset-failed', asyncHandler(async (req: Request, res: Response) => {
  const count = ImageModel.resetFailed();
  res.json({
    success: true,
    message: `Reset ${count} failed lookups`
  });
}));

/**
 * Clear model cache
 * DELETE /api/civitai/models
 */
router.delete('/models', asyncHandler(async (req: Request, res: Response) => {
  const count = ModelInfo.clearAll();
  res.json({
    success: true,
    message: `Cleared ${count} cached models`
  });
}));

// ============================================
// Post Intent System
// ============================================

/**
 * Create Post Intent URL
 * POST /api/civitai/create-intent
 */
router.post('/create-intent', asyncHandler(async (req: Request, res: Response) => {
  const { compositeHashes, includeMetadata, title, description, tags } = req.body;

  if (!compositeHashes || !Array.isArray(compositeHashes) || compositeHashes.length === 0) {
    res.status(400).json({
      success: false,
      error: 'compositeHashes array is required'
    });
    return;
  }

  if (compositeHashes.length > 20) {
    res.status(400).json({
      success: false,
      error: 'Maximum 20 images allowed per post'
    });
    return;
  }

  // Get base URL from request
  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}`;

  const result = CivitaiTempUrlService.createIntentUrl(baseUrl, {
    compositeHashes,
    includeMetadata,
    title,
    description,
    tags
  });

  res.json({
    success: true,
    data: result
  });
}));

/**
 * Serve temporary image for Civitai
 * GET /api/civitai/temp-image/:token
 * This endpoint is accessed by Civitai servers to fetch the image
 */
router.get('/temp-image/:token', asyncHandler(async (req: Request, res: Response) => {
  const token = routeParam(req.params.token);

  // Find valid (non-expired) temp URL
  const tempUrl = CivitaiTempUrl.findValidByToken(token);

  if (!tempUrl) {
    res.status(404).json({
      success: false,
      error: 'Image not found or expired'
    });
    return;
  }

  const metadata = MediaMetadataModel.findByHash(tempUrl.composite_hash);
  if (!metadata || ImageSafetyService.isHidden(metadata.rating_score)) {
    res.status(404).json({
      success: false,
      error: 'Image not found or expired'
    });
    return;
  }

  // Increment access count
  CivitaiTempUrl.incrementAccessCount(token);

  // Get image path from database
  const imageData = db.prepare(`
    SELECT if.original_file_path
    FROM image_files if
    WHERE if.composite_hash = ?
      AND if.file_status = 'active'
    ORDER BY if.last_verified_date DESC
    LIMIT 1
  `).get(tempUrl.composite_hash) as { original_file_path: string } | undefined;

  if (!imageData || !imageData.original_file_path) {
    res.status(404).json({
      success: false,
      error: 'Image file not found'
    });
    return;
  }

  const imagePath = resolveUploadsPath(imageData.original_file_path);

  if (!fs.existsSync(imagePath)) {
    res.status(404).json({
      success: false,
      error: 'Image file not found on disk'
    });
    return;
  }

  // Determine content type
  const ext = path.extname(imagePath).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif'
  };

  const contentType = contentTypes[ext] || 'application/octet-stream';

  // Send file
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(imagePath);
}));

/**
 * Cleanup expired temp URLs
 * POST /api/civitai/cleanup-temp-urls
 */
router.post('/cleanup-temp-urls', asyncHandler(async (req: Request, res: Response) => {
  const count = CivitaiTempUrl.cleanupExpired();
  res.json({
    success: true,
    message: `Cleaned up ${count} expired URLs`
  });
}));

// ============================================
// Rescan System (기존 이미지 재스캔)
// ============================================

// 재스캔 진행 상태 (메모리 내 관리)
let rescanProgress = {
  isRunning: false,
  total: 0,
  processed: 0,
  added: 0,
  startedAt: null as string | null
};

/**
 * 전체 이미지 모델 정보 재스캔 시작
 * POST /api/civitai/rescan-all
 */
router.post('/rescan-all', asyncHandler(async (req: Request, res: Response) => {
  // 활성화 상태 확인
  const settings = CivitaiSettings.get();
  if (!settings.enabled) {
    res.status(400).json({
      success: false,
      error: 'Civitai integration is disabled. Please enable it in settings.',
      code: 'CIVITAI_DISABLED'
    });
    return;
  }

  // 이미 실행 중인지 확인
  if (rescanProgress.isRunning) {
    res.status(409).json({
      success: false,
      error: 'Rescan is already in progress',
      code: 'RESCAN_IN_PROGRESS',
      progress: rescanProgress
    });
    return;
  }

  // media_metadata에서 model_references가 있는 모든 이미지 조회
  const imagesWithRefs = db.prepare(`
    SELECT composite_hash, model_references
    FROM media_metadata
    WHERE model_references IS NOT NULL AND model_references != '[]'
  `).all() as Array<{ composite_hash: string; model_references: string }>;

  if (imagesWithRefs.length === 0) {
    res.json({
      success: true,
      message: 'No images with model references found',
      total: 0,
      added: 0
    });
    return;
  }

  // 진행 상태 초기화
  rescanProgress = {
    isRunning: true,
    total: imagesWithRefs.length,
    processed: 0,
    added: 0,
    startedAt: new Date().toISOString()
  };

  // 비동기로 처리 시작 (응답은 바로 반환)
  (async () => {
    let addedCount = 0;

    for (const image of imagesWithRefs) {
      try {
        const modelRefs = JSON.parse(image.model_references);

        for (const ref of modelRefs) {
          if (!ref.hash) continue;

          // 이미 존재하는지 확인
          const existing = db.prepare(`
            SELECT 1 FROM image_models
            WHERE composite_hash = ? AND model_hash = ? AND model_role = ?
            LIMIT 1
          `).get(image.composite_hash, ref.hash, ref.type);

          if (!existing) {
            // image_models에 추가
            ImageModel.create({
              composite_hash: image.composite_hash,
              model_hash: ref.hash,
              model_role: ref.type as any,
              weight: ref.weight
            });
            addedCount++;
          }
        }
      } catch (err) {
        console.warn(`재스캔 중 오류 (${image.composite_hash}):`, err);
      }

      rescanProgress.processed++;
      rescanProgress.added = addedCount;
    }

    rescanProgress.isRunning = false;
    console.log(`✅ Civitai 재스캔 완료: ${addedCount}개 모델 참조 추가`);
  })();

  res.json({
    success: true,
    message: 'Rescan started',
    total: imagesWithRefs.length
  });
}));

/**
 * 재스캔 진행률 조회
 * GET /api/civitai/rescan-progress
 */
router.get('/rescan-progress', asyncHandler(async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      ...rescanProgress,
      percentage: rescanProgress.total > 0
        ? Math.round((rescanProgress.processed / rescanProgress.total) * 100)
        : 0
    }
  });
}));

/**
 * 미확인 모델 개수 조회
 * GET /api/civitai/unchecked-count
 */
router.get('/unchecked-count', asyncHandler(async (req: Request, res: Response) => {
  const result = db.prepare(`
    SELECT COUNT(*) as count
    FROM image_models
    WHERE civitai_checked = 0 AND civitai_failed = 0
  `).get() as { count: number };

  res.json({
    success: true,
    data: {
      uncheckedCount: result.count
    }
  });
}));

export default router;
