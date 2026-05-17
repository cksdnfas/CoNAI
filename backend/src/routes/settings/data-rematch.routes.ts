import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { DataRematchService } from '../../services/dataRematchService';

const router = Router();

router.get(
  '/data-rematch/status',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: DataRematchService.getStatus(),
    });
    return;
  }),
);

router.post(
  '/data-rematch/jobs',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const job = DataRematchService.startJob(req.body);
      res.status(202).json({
        success: true,
        data: job,
        message: '데이터 재매칭 작업을 시작했습니다.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '데이터 재매칭 작업을 시작하지 못했습니다.';
      const status = message.includes('이미 실행 중') ? 409 : 400;
      res.status(status).json({
        success: false,
        error: message,
      });
    }
    return;
  }),
);

export { router as dataRematchSettingsRoutes };
