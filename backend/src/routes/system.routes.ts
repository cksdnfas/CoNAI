import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { QueryCacheService } from '../services/QueryCacheService';
import { APIImageIntegrationService } from '../services/apiImageIntegrationService';

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
 */
router.get('/api-image-stats', asyncHandler(async (req: Request, res: Response) => {
  try {
    const stats = await APIImageIntegrationService.getProcessingStatistics();

    return res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('API image stats error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch API image stats',
    });
  }
}));

/**
 * 미처리된 API 이미지 재처리
 * POST /api/system/process-unprocessed
 */
router.post('/process-unprocessed', asyncHandler(async (req: Request, res: Response) => {
  try {
    const stats = await APIImageIntegrationService.processUnprocessedRecords();

    return res.json({
      success: true,
      data: stats,
      message: `Processed ${stats.processed} records, ${stats.failed} failed`,
    });
  } catch (error) {
    console.error('Process unprocessed error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process unprocessed records',
    });
  }
}));

/**
 * 특정 생성 히스토리 레코드 재처리
 * POST /api/system/process-record/:id
 */
router.post('/process-record/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const historyId = parseInt(req.params.id, 10);
    if (isNaN(historyId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid history ID',
      });
    }

    const success = await APIImageIntegrationService.processRecordById(historyId);

    if (success) {
      return res.json({
        success: true,
        message: `Record ${historyId} processed successfully`,
      });
    } else {
      return res.status(500).json({
        success: false,
        error: `Failed to process record ${historyId}`,
      });
    }
  } catch (error) {
    console.error('Process record error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process record',
    });
  }
}));

/**
 * 특정 레코드의 처리 상태 검증
 * GET /api/system/verify-record/:id
 */
router.get('/verify-record/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const historyId = parseInt(req.params.id, 10);
    if (isNaN(historyId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid history ID',
      });
    }

    const verification = await APIImageIntegrationService.verifyRecordProcessing(historyId);

    return res.json({
      success: true,
      data: verification,
    });
  } catch (error) {
    console.error('Verify record error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to verify record',
    });
  }
}));

export { router as systemRoutes };
