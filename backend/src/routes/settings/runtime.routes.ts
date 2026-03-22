import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { MaintenanceService } from '../../services/maintenanceService';
import { AutoScanScheduler } from '../../services/autoScanScheduler';
import { autoTagScheduler } from '../../services/autoTagScheduler';
import { SystemSettingsService } from '../../services/systemSettingsService';

const router = Router();

router.get(
  '/phase2-interval',
  asyncHandler(async (req: Request, res: Response) => {
    const interval = SystemSettingsService.getPhase2Interval();
    res.json({
      success: true,
      data: { interval },
    });
    return;
  }),
);

router.put(
  '/phase2-interval',
  asyncHandler(async (req: Request, res: Response) => {
    const { interval } = req.body;

    if (typeof interval !== 'number' || interval < 5 || interval > 300) {
      res.status(400).json({
        success: false,
        error: '백그라운드 간격은 5-300초 사이여야 합니다',
      });
      return;
    }

    SystemSettingsService.updatePhase2Interval(interval);
    AutoScanScheduler.restart();

    res.json({
      success: true,
      data: { interval },
      message: `백그라운드 처리 간격이 ${interval}초로 업데이트되었습니다`,
    });
    return;
  }),
);

router.get(
  '/auto-tag-config',
  asyncHandler(async (req: Request, res: Response) => {
    const pollingInterval = SystemSettingsService.getAutoTagPollingInterval();
    const batchSize = SystemSettingsService.getAutoTagBatchSize();

    res.json({
      success: true,
      data: {
        pollingInterval,
        batchSize,
      },
    });
    return;
  }),
);

router.put(
  '/auto-tag-config',
  asyncHandler(async (req: Request, res: Response) => {
    const { pollingInterval, batchSize } = req.body;

    if (pollingInterval !== undefined) {
      if (typeof pollingInterval !== 'number' || pollingInterval < 5 || pollingInterval > 300) {
        res.status(400).json({
          success: false,
          error: '자동 태깅 폴링 간격은 5-300초 사이여야 합니다',
        });
        return;
      }
    }

    if (batchSize !== undefined) {
      if (typeof batchSize !== 'number' || batchSize < 1 || batchSize > 100) {
        res.status(400).json({
          success: false,
          error: '자동 태깅 배치 크기는 1-100 사이여야 합니다',
        });
        return;
      }
    }

    if (pollingInterval !== undefined) {
      SystemSettingsService.updateAutoTagPollingInterval(pollingInterval);
    }
    if (batchSize !== undefined) {
      SystemSettingsService.updateAutoTagBatchSize(batchSize);
    }

    autoTagScheduler.restart();

    res.json({
      success: true,
      data: {
        pollingInterval: SystemSettingsService.getAutoTagPollingInterval(),
        batchSize: SystemSettingsService.getAutoTagBatchSize(),
      },
      message: '자동 태깅 스케줄러 설정이 업데이트되었습니다',
    });
    return;
  }),
);

router.post(
  '/maintenance/sync-tags',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await MaintenanceService.syncAutoTags();
      res.json({
        success: true,
        data: result,
        message: `Sync complete. Processed ${result.processed} images, collected ${result.collected} tags.`,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during sync',
      });
    }
    return;
  }),
);

export { router as runtimeSettingsRoutes };
