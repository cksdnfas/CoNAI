import { Router, Request, Response } from 'express';
import { FileVerificationService } from '../services/fileVerificationService';
import { SystemSettingsService } from '../services/systemSettingsService';
import { asyncHandler } from '../middleware/asyncHandler';
import { successResponse } from '@conai/shared';

const router = Router();

/**
 * GET /api/file-verification/stats
 * 파일 검증 통계 조회
 */
router.get(
  '/stats',
  asyncHandler(async (req: Request, res: Response) => {
    const stats = FileVerificationService.getStats();
    return res.json(successResponse(stats));
  })
);

/**
 * GET /api/file-verification/progress
 * 현재 검증 진행 상황 조회
 */
router.get(
  '/progress',
  asyncHandler(async (req: Request, res: Response) => {
    const progress = FileVerificationService.getProgress();
    return res.json(successResponse(progress));
  })
);

/**
 * POST /api/file-verification/verify
 * 파일 검증 수동 실행
 */
router.post(
  '/verify',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await FileVerificationService.verifyAllFiles();
    return res.json({
      success: true,
      result,
    });
  })
);

/**
 * GET /api/file-verification/logs
 * 최근 검증 로그 조회
 */
router.get(
  '/logs',
  asyncHandler(async (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const logs = FileVerificationService.getRecentLogs(limit);
    return res.json(successResponse(logs));
  })
);

/**
 * GET /api/file-verification/settings
 * 파일 검증 설정 조회
 */
router.get(
  '/settings',
  asyncHandler(async (req: Request, res: Response) => {
    const settings = {
      enabled: SystemSettingsService.isFileVerificationEnabled(),
      interval: SystemSettingsService.getFileVerificationInterval(),
    };
    return res.json(successResponse(settings));
  })
);

/**
 * PUT /api/file-verification/settings
 * 파일 검증 설정 업데이트
 */
router.put(
  '/settings',
  asyncHandler(async (req: Request, res: Response) => {
    const { enabled, interval } = req.body;

    if (typeof enabled === 'boolean') {
      SystemSettingsService.updateFileVerificationEnabled(enabled);
    }

    if (typeof interval === 'number') {
      SystemSettingsService.updateFileVerificationInterval(interval);
    }

    const updatedSettings = {
      enabled: SystemSettingsService.isFileVerificationEnabled(),
      interval: SystemSettingsService.getFileVerificationInterval(),
    };

    return res.json({
      success: true,
      settings: updatedSettings,
    });
  })
);

export default router;
