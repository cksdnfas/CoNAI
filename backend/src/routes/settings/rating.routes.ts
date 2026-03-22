import { Router, Request, Response } from 'express';
import { routeParam } from '../routeParam';
import { asyncHandler } from '../../middleware/errorHandler';
import { RatingScoreService } from '../../services/ratingScoreService';
import { RatingData, RatingTierInput, RatingWeightsUpdate } from '../../types/rating';

const router = Router();

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
      res.status(400).json({
        success: false,
        error: (error as Error).message,
      });
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
      res.status(400).json({
        success: false,
        error: (error as Error).message,
      });
    }
    return;
  }),
);

router.put(
  '/tiers/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const tierId = parseInt(routeParam(routeParam(req.params.id)), 10);
    const tierData: Partial<RatingTierInput> = req.body;

    if (isNaN(tierId)) {
      res.status(400).json({
        success: false,
        error: 'Invalid tier ID',
      });
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
      res.status(400).json({
        success: false,
        error: (error as Error).message,
      });
    }
    return;
  }),
);

router.delete(
  '/tiers/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const tierId = parseInt(routeParam(routeParam(req.params.id)), 10);

    if (isNaN(tierId)) {
      res.status(400).json({
        success: false,
        error: 'Invalid tier ID',
      });
      return;
    }

    try {
      await RatingScoreService.deleteTier(tierId);
      res.json({
        success: true,
        message: 'Rating tier deleted successfully',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: (error as Error).message,
      });
    }
    return;
  }),
);

router.put(
  '/tiers',
  asyncHandler(async (req: Request, res: Response) => {
    const tiers: RatingTierInput[] = req.body;

    if (!Array.isArray(tiers)) {
      res.status(400).json({
        success: false,
        error: 'Request body must be an array of tiers',
      });
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
      res.status(400).json({
        success: false,
        error: (error as Error).message,
      });
    }
    return;
  }),
);

router.post(
  '/calculate',
  asyncHandler(async (req: Request, res: Response) => {
    const ratingData: RatingData = req.body;

    if (!ratingData || typeof ratingData !== 'object') {
      res.status(400).json({
        success: false,
        error: 'Invalid rating data',
      });
      return;
    }

    const requiredFields = ['general', 'sensitive', 'questionable', 'explicit'];
    for (const field of requiredFields) {
      if (typeof (ratingData as any)[field] !== 'number') {
        res.status(400).json({
          success: false,
          error: `Field "${field}" is required and must be a number`,
        });
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
      res.status(400).json({
        success: false,
        error: (error as Error).message,
      });
    }
    return;
  }),
);

export { router as ratingSettingsRoutes };
