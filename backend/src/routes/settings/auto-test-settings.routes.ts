import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { autoTestMediaService } from '../../services/autoTestMediaService';
import { routeParam } from '../routeParam';
import { sendRouteBadRequest } from '../routeValidation';

const router = Router();

router.get(
  '/auto-test/media/:imageId',
  asyncHandler(async (req: Request, res: Response) => {
    const imageId = routeParam(req.params.imageId);
    if (!imageId) {
      sendRouteBadRequest(res, 'imageId is required');
      return;
    }

    const imageData = autoTestMediaService.getPayloadByHash(imageId);
    if (!imageData) {
      res.status(404).json({ success: false, error: 'Image not found or no active file' });
      return;
    }

    res.json({ success: true, data: imageData });
    return;
  })
);

router.get(
  '/auto-test/random',
  asyncHandler(async (_req: Request, res: Response) => {
    const imageData = autoTestMediaService.getRandomPayload();
    if (!imageData) {
      res.status(404).json({ success: false, error: 'No active media found for testing' });
      return;
    }

    res.json({ success: true, data: imageData });
    return;
  })
);

export const autoTestSettingsRoutes = router;
