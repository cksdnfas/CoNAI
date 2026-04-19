import { Router, Request, Response } from 'express';
import { routeParam } from '../routeParam';
import { asyncHandler } from '../../middleware/errorHandler';
import { RatingScoreService } from '../../services/ratingScoreService';
import { RatingData, RatingTierInput, RatingWeightsUpdate } from '../../types/rating';
import { sendRouteBadRequest } from '../routeValidation';

const router = Router();

/** Parse the tier route id without changing current route-param behavior. */
function parseTierRouteId(value: string | string[] | undefined) {
  return parseInt(routeParam(routeParam(value)), 10);
}

router.get(
  '/weights',
  asyncHandler(async (req: Request, res: Response) => {
    const weights = await RatingScoreService.getWeights();
    res.json({
      success: true,
      data: weights,
    });
    return;
  }),
);

router.put(
  '/weights',
  asyncHandler(async (req: Request, res: Response) => {
    const weightsUpdate: RatingWeightsUpdate = req.body;

    try {
      const updatedWeights = await RatingScoreService.updateWeights(weightsUpdate);
      res.json({
        success: true,
        data: updatedWeights,
        message: 'Rating weights updated successfully',
      });
    } catch (error) {
      sendRouteBadRequest(res, (error as Error).message);
    }
    return;
  }),
);

router.get(
  '/tiers',
  asyncHandler(async (req: Request, res: Response) => {
    const tiers = await RatingScoreService.getAllTiers();
    res.json({
      success: true,
      data: tiers,
    });
    return;
  }),
);

router.post(
  '/tiers',
  asyncHandler(async (req: Request, res: Response) => {
    const tierData: RatingTierInput = req.body;

    try {
      const newTier = await RatingScoreService.createTier(tierData);
      res.status(201).json({
        success: true,
        data: newTier,
        message: 'Rating tier created successfully',
      });
    } catch (error) {
      sendRouteBadRequest(res, (error as Error).message);
    }
    return;
  }),
);

router.put(
  '/tiers/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const tierId = parseTierRouteId(req.params.id);
    const tierData: Partial<RatingTierInput> = req.body;

    if (isNaN(tierId)) {
      sendRouteBadRequest(res, 'Invalid tier ID');
      return;
    }

    try {
      const updatedTier = await RatingScoreService.updateTier(tierId, tierData);
      res.json({
        success: true,
        data: updatedTier,
        message: 'Rating tier updated successfully',
      });
    } catch (error) {
      sendRouteBadRequest(res, (error as Error).message);
    }
    return;
  }),
);

router.delete(
  '/tiers/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const tierId = parseTierRouteId(req.params.id);

    if (isNaN(tierId)) {
      sendRouteBadRequest(res, 'Invalid tier ID');
      return;
    }

    try {
      await RatingScoreService.deleteTier(tierId);
      res.json({
        success: true,
        message: 'Rating tier deleted successfully',
      });
    } catch (error) {
      sendRouteBadRequest(res, (error as Error).message);
    }
    return;
  }),
);

router.put(
  '/tiers',
  asyncHandler(async (req: Request, res: Response) => {
    const tiers: RatingTierInput[] = req.body;

    if (!Array.isArray(tiers)) {
      sendRouteBadRequest(res, 'Request body must be an array of tiers');
      return;
    }

    try {
      const updatedTiers = await RatingScoreService.updateAllTiers(tiers);
      res.json({
        success: true,
        data: updatedTiers,
        message: 'All rating tiers updated successfully',
      });
    } catch (error) {
      sendRouteBadRequest(res, (error as Error).message);
    }
    return;
  }),
);

router.post(
  '/calculate',
  asyncHandler(async (req: Request, res: Response) => {
    const ratingData: RatingData = req.body;

    if (!ratingData || typeof ratingData !== 'object') {
      sendRouteBadRequest(res, 'Invalid rating data');
      return;
    }

    const requiredFields = ['general', 'sensitive', 'questionable', 'explicit'];
    for (const field of requiredFields) {
      if (typeof (ratingData as any)[field] !== 'number') {
        sendRouteBadRequest(res, `Field "${field}" is required and must be a number`);
        return;
      }
    }

    try {
      const result = await RatingScoreService.calculateScore(ratingData);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      sendRouteBadRequest(res, (error as Error).message);
    }
    return;
  }),
);

export { router as ratingSettingsRoutes };
