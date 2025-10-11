import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { settingsService } from '../services/settingsService';
import { imageTaggerService } from '../services/imageTaggerService';
import { TaggerSettings } from '../types/settings';

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

export const settingsRoutes = router;
