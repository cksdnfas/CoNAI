import { Router, Request, Response } from 'express';
import { successResponse } from '@conai/shared';
import { asyncHandler } from '../middleware/errorHandler';
import { settingsService } from '../services/settingsService';

const router = Router();

/** Return the shared saved appearance settings for runtime theme application. */
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const settings = settingsService.loadSettings();
  return res.json(successResponse(settings.appearance));
}));

export { router as runtimeAppearanceRoutes };
