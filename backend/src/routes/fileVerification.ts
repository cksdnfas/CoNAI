import { Router, Request, Response } from 'express';
import { FileVerificationService } from '../services/fileVerificationService';
import { SystemSettingsService } from '../services/systemSettingsService';
import { AutoScanScheduler } from '../services/autoScanScheduler';
import { asyncHandler } from '../middleware/asyncHandler';
import { successResponse } from '@conai/shared';
import {
  applyFileVerificationSettingsUpdate,
  parseFileVerificationLogLimit,
  readFileVerificationSettings,
} from './file-verification-route-helpers';

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
    const limit = parseFileVerificationLogLimit(req.query.limit);
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
    const settings = readFileVerificationSettings({
      isFileVerificationEnabled: () => SystemSettingsService.isFileVerificationEnabled(),
      getFileVerificationInterval: () => SystemSettingsService.getFileVerificationInterval(),
    });
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
    const { settings: updatedSettings } = applyFileVerificationSettingsUpdate(req.body, {
      isFileVerificationEnabled: () => SystemSettingsService.isFileVerificationEnabled(),
      getFileVerificationInterval: () => SystemSettingsService.getFileVerificationInterval(),
      updateFileVerificationEnabled: (enabled) => SystemSettingsService.updateFileVerificationEnabled(enabled),
      updateFileVerificationInterval: (interval) => SystemSettingsService.updateFileVerificationInterval(interval),
      restartScheduler: () => AutoScanScheduler.restart(),
    });

    return res.json({
      success: true,
      settings: updatedSettings,
    });
  })
);

export default router;
