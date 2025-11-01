import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { QueryCacheService } from '../services/QueryCacheService';

const router = Router();

/**
 * 캐시 통계 조회
 * GET /api/system/cache-stats
 */
router.get('/cache-stats', asyncHandler(async (req: Request, res: Response) => {
  try {
    const stats = QueryCacheService.getStats();
    const hitRates = QueryCacheService.getHitRate();

    const response = {
      success: true,
      data: {
        stats,
        hitRates: {
          gallery: `${hitRates.gallery.toFixed(2)}%`,
          metadata: `${hitRates.metadata.toFixed(2)}%`,
          thumbnail: `${hitRates.thumbnail.toFixed(2)}%`,
        },
        timestamp: new Date().toISOString(),
      },
    };

    return res.json(response);
  } catch (error) {
    console.error('Cache stats error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch cache stats',
    });
  }
}));

/**
 * 캐시 통계 초기화
 * POST /api/system/cache-stats/reset
 */
router.post('/cache-stats/reset', asyncHandler(async (req: Request, res: Response) => {
  try {
    QueryCacheService.resetStats();

    return res.json({
      success: true,
      message: 'Cache statistics reset successfully',
    });
  } catch (error) {
    console.error('Cache stats reset error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reset cache stats',
    });
  }
}));

/**
 * 캐시 전체 무효화
 * POST /api/system/cache/invalidate
 */
router.post('/cache/invalidate', asyncHandler(async (req: Request, res: Response) => {
  try {
    QueryCacheService.invalidateImageCache();

    return res.json({
      success: true,
      message: 'All caches invalidated successfully',
    });
  } catch (error) {
    console.error('Cache invalidate error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to invalidate cache',
    });
  }
}));

/**
 * API 이미지 처리 통계 조회
 * GET /api/system/api-image-stats
 * DEPRECATED: 이제 composite_hash가 생성 시점에 자동으로 생성되므로 불필요
 */
router.get('/api-image-stats', asyncHandler(async (req: Request, res: Response) => {
  return res.json({
    success: true,
    data: {
      total: 0,
      completed: 0,
      processing: 0,
      processingWithHash: 0,
      processingWithoutHash: 0,
      failed: 0,
      pending: 0
    },
    timestamp: new Date().toISOString(),
    message: 'This endpoint is deprecated. All images now have composite_hash generated automatically.'
  });
}));

/**
 * 미처리된 API 이미지 재처리
 * POST /api/system/process-unprocessed
 * DEPRECATED: 이제 composite_hash가 생성 시점에 자동으로 생성되므로 불필요
 */
router.post('/process-unprocessed', asyncHandler(async (req: Request, res: Response) => {
  return res.json({
    success: true,
    data: { total: 0, processed: 0, failed: 0 },
    message: 'This endpoint is deprecated. Composite hash is now generated automatically during image generation.',
  });
}));

/**
 * 특정 생성 히스토리 레코드 재처리
 * POST /api/system/process-record/:id
 * DEPRECATED: 이제 composite_hash가 생성 시점에 자동으로 생성되므로 불필요
 */
router.post('/process-record/:id', asyncHandler(async (req: Request, res: Response) => {
  const historyId = parseInt(req.params.id, 10);
  if (isNaN(historyId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid history ID',
    });
  }

  return res.json({
    success: true,
    message: 'This endpoint is deprecated. Composite hash is now generated automatically during image generation.',
  });
}));

/**
 * 특정 레코드의 처리 상태 검증
 * GET /api/system/verify-record/:id
 * DEPRECATED: 이제 composite_hash가 생성 시점에 자동으로 생성되므로 불필요
 */
router.get('/verify-record/:id', asyncHandler(async (req: Request, res: Response) => {
  const historyId = parseInt(req.params.id, 10);
  if (isNaN(historyId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid history ID',
    });
  }

  return res.json({
    success: true,
    data: {
      hasCompositeHash: true,
      hasImageFile: false,
      hasMetadata: false,
      hasThumbnail: false
    },
    message: 'This endpoint is deprecated. Composite hash is now generated automatically during image generation.'
  });
}));

export { router as systemRoutes };
