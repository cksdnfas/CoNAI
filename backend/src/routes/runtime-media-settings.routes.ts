import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { settingsService } from '../services/settingsService';
import { RatingScoreService } from '../services/ratingScoreService';

const router = Router();

router.get(
  '/similarity',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: settingsService.loadSettings().similarity,
    });
    return;
  }),
);

router.get(
  '/rating-tiers',
  asyncHandler(async (_req: Request, res: Response) => {
    const tiers = await RatingScoreService.getAllTiers();
    res.json({
      success: true,
      data: tiers,
    });
    return;
  }),
);

router.get(
  '/generation-history',
  asyncHandler(async (_req: Request, res: Response) => {
    const { applyRatingSafetyToGenerationHistory } = settingsService.loadSettings().general;
    res.json({
      success: true,
      data: { applyRatingSafetyToGenerationHistory },
    });
    return;
  }),
);

export { router as runtimeMediaSettingsRoutes };
