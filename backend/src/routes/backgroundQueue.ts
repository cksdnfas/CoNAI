import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAdmin } from '../middleware/authMiddleware';
import { BackgroundQueueService } from '../services/backgroundQueue';
import { autoTagScheduler } from '../services/autoTagScheduler';
import { successResponse } from '@conai/shared';

const router = Router();

/**
 * GET /api/background-queue/status
 * 백그라운드 큐 상태 조회 (메타데이터 추출, 프롬프트 수집 + 자동 태깅)
 */
router.get('/status', asyncHandler(async (_req: Request, res: Response) => {
  const queueStatus = BackgroundQueueService.getQueueStatus();
  const autoTagStatus = autoTagScheduler.getStatus();

  const combinedStatus = {
    queue: queueStatus,
    autoTag: autoTagStatus
  };

  return res.json(successResponse(combinedStatus));
}));

/**
 * POST /api/background-queue/clear
 * 백그라운드 큐 초기화
 */
router.post('/clear', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  BackgroundQueueService.clearQueue();
  return res.json(successResponse({ message: '백그라운드 큐가 초기화되었습니다' }));
}));

/**
 * POST /api/background-queue/trigger-auto-tag
 * 자동 태깅 수동 트리거
 */
router.post('/trigger-auto-tag', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  await autoTagScheduler.triggerManualProcessing();
  return res.json(successResponse({ message: '자동 태깅이 수동으로 트리거되었습니다' }));
}));

export { router as backgroundQueueRoutes };
