import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { settingsService } from '../services/settingsService';
import { imageTaggerService } from '../services/imageTaggerService';
import { RatingScoreService } from '../services/ratingScoreService';
import { TaggerSettings, SimilaritySettings } from '../types/settings';
import { RatingWeightsUpdate, RatingTierInput, RatingData } from '../types/rating';

const router = Router();

/**
 * GET /api/settings
 * Get current application settings
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const settings = settingsService.loadSettings();
    res.json({
      success: true,
      data: settings,
    });
    return;
  })
);

/**
 * GET /api/settings/tagger/models
 * Get list of available tagger models with download status
 */
router.get(
  '/tagger/models',
  asyncHandler(async (req: Request, res: Response) => {
    const models = settingsService.getModelsList();
    res.json({
      success: true,
      data: models,
    });
    return;
  })
);

/**
 * PUT /api/settings/tagger
 * Update tagger settings
 */
router.put(
  '/tagger',
  asyncHandler(async (req: Request, res: Response) => {
    const taggerSettings: Partial<TaggerSettings> = req.body;

    // Validate settings
    if (taggerSettings.generalThreshold !== undefined) {
      if (taggerSettings.generalThreshold < 0 || taggerSettings.generalThreshold > 1) {
        res.status(400).json({
          success: false,
          error: 'General threshold must be between 0 and 1',
        });
        return;
      }
    }

    if (taggerSettings.characterThreshold !== undefined) {
      if (taggerSettings.characterThreshold < 0 || taggerSettings.characterThreshold > 1) {
        res.status(400).json({
          success: false,
          error: 'Character threshold must be between 0 and 1',
        });
        return;
      }
    }

    if (taggerSettings.model !== undefined) {
      const validModels = ['vit', 'swinv2', 'convnext'];
      if (!validModels.includes(taggerSettings.model)) {
        res.status(400).json({
          success: false,
          error: `Invalid model. Must be one of: ${validModels.join(', ')}`,
        });
        return;
      }
    }

    // Update settings
    const updatedSettings = settingsService.updateTaggerSettings(taggerSettings);

    // Reload tagger service configuration
    await imageTaggerService.reloadConfig();

    res.json({
      success: true,
      data: updatedSettings,
      message: 'Tagger settings updated successfully',
    });
    return;
  })
);

/**
 * POST /api/settings/tagger/check-dependencies
 * Check if Python and required packages are available
 */
router.post(
  '/tagger/check-dependencies',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await imageTaggerService.checkPythonDependencies();

    res.json({
      success: true,
      data: result,
    });
    return;
  })
);

/**
 * POST /api/settings/tagger/download
 * Download a specific tagger model
 * This endpoint triggers a model download by attempting to tag a dummy request
 */
router.post(
  '/tagger/download',
  asyncHandler(async (req: Request, res: Response) => {
    const { model } = req.body;

    if (!model || !['vit', 'swinv2', 'convnext'].includes(model)) {
      res.status(400).json({
        success: false,
        error: 'Invalid model. Must be one of: vit, swinv2, convnext',
      });
      return;
    }

    // Check if model is already downloaded
    const isDownloaded = settingsService.isModelDownloaded(model);

    if (isDownloaded) {
      res.json({
        success: true,
        message: 'Model is already downloaded',
        data: {
          model,
          downloaded: true,
        },
      });
      return;
    }

    res.json({
      success: true,
      message: 'Model download will occur on first use. Please tag an image to download the model.',
      data: {
        model,
        downloaded: false,
        note: 'The model will be automatically downloaded when you tag an image using this model.',
      },
    });
    return;
  })
);

/**
 * GET /api/settings/tagger/status
 * Get current tagger daemon status
 */
router.get(
  '/tagger/status',
  asyncHandler(async (req: Request, res: Response) => {
    const status = await imageTaggerService.getStatus();

    res.json({
      success: true,
      data: status,
    });
    return;
  })
);

/**
 * POST /api/settings/tagger/load-model
 * Load model into memory
 */
router.post(
  '/tagger/load-model',
  asyncHandler(async (req: Request, res: Response) => {
    const { model } = req.body;

    if (model && !['vit', 'swinv2', 'convnext'].includes(model)) {
      res.status(400).json({
        success: false,
        error: 'Invalid model. Must be one of: vit, swinv2, convnext',
      });
      return;
    }

    await imageTaggerService.loadModel(model);

    res.json({
      success: true,
      message: 'Model loaded successfully',
    });
    return;
  })
);

/**
 * POST /api/settings/tagger/unload-model
 * Unload model from memory
 */
router.post(
  '/tagger/unload-model',
  asyncHandler(async (req: Request, res: Response) => {
    await imageTaggerService.unloadModel();

    res.json({
      success: true,
      message: 'Model unloaded successfully',
    });
    return;
  })
);

// ==================== Similarity Settings Routes ====================

/**
 * PUT /api/settings/similarity
 * Update similarity settings
 */
router.put(
  '/similarity',
  asyncHandler(async (req: Request, res: Response) => {
    const similaritySettings: Partial<SimilaritySettings> = req.body;

    // Update settings
    const updatedSettings = settingsService.updateSimilaritySettings(similaritySettings);

    res.json({
      success: true,
      data: updatedSettings,
      message: 'Similarity settings updated successfully',
    });
    return;
  })
);

// ==================== Rating Score System Routes ====================

/**
 * GET /api/settings/rating/weights
 * Get current rating weight configuration
 */
router.get(
  '/rating/weights',
  asyncHandler(async (req: Request, res: Response) => {
    const weights = await RatingScoreService.getWeights();
    res.json({
      success: true,
      data: weights,
    });
    return;
  })
);

/**
 * PUT /api/settings/rating/weights
 * Update rating weight configuration
 */
router.put(
  '/rating/weights',
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
  })
);

/**
 * GET /api/settings/rating/tiers
 * Get all rating tiers
 */
router.get(
  '/rating/tiers',
  asyncHandler(async (req: Request, res: Response) => {
    const tiers = await RatingScoreService.getAllTiers();
    res.json({
      success: true,
      data: tiers,
    });
    return;
  })
);

/**
 * POST /api/settings/rating/tiers
 * Create a new rating tier
 */
router.post(
  '/rating/tiers',
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
  })
);

/**
 * PUT /api/settings/rating/tiers/:id
 * Update a specific rating tier
 */
router.put(
  '/rating/tiers/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const tierId = parseInt(req.params.id, 10);
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
  })
);

/**
 * DELETE /api/settings/rating/tiers/:id
 * Delete a specific rating tier
 */
router.delete(
  '/rating/tiers/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const tierId = parseInt(req.params.id, 10);

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
  })
);

/**
 * PUT /api/settings/rating/tiers
 * Update all rating tiers at once (bulk update)
 */
router.put(
  '/rating/tiers',
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
  })
);

/**
 * POST /api/settings/rating/calculate
 * Calculate rating score from rating data (for testing)
 */
router.post(
  '/rating/calculate',
  asyncHandler(async (req: Request, res: Response) => {
    const ratingData: RatingData = req.body;

    // Validate rating data
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
  })
);

export const settingsRoutes = router;
