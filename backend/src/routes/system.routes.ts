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

export { router as systemRoutes };
