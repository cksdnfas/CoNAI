import { Router, Request, Response } from 'express';
import { routeParam } from './routeParam';
import {
  sendRouteBadRequest,
  validateIntegerInRangeIfDefined,
  validateNumberInRangeIfDefined,
  validateStringEnumIfDefined,
} from './routeValidation';
import { asyncHandler } from '../middleware/errorHandler';
import { settingsService } from '../services/settingsService';
import { imageTaggerService } from '../services/imageTaggerService';
import { autoTagScheduler } from '../services/autoTagScheduler';
import { kaloscopeTaggerService } from '../services/kaloscopeTaggerService';
import {
  DEFAULT_ARTIST_LINK_URL_TEMPLATE,
  GeneralSettings,
  TaggerSettings,
  KaloscopeSettings,
  TaggerDevice,
  TaggerModel,
  SupportedLanguage,
} from '../types/settings';
import { autoTestMediaService } from '../services/autoTestMediaService';
import { mediaSettingsRoutes } from './settings/media-settings.routes';
import { ratingSettingsRoutes } from './settings/rating.routes';
import { runtimeSettingsRoutes } from './settings/runtime.routes';
import { appearanceSettingsRoutes } from './settings/appearance.routes';

const router = Router();
const validLanguages: SupportedLanguage[] = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW'];
const validKaloscopeDevices = ['auto', 'cpu', 'cuda'] as const;
const validTaggerModels = ['vit', 'swinv2', 'convnext'] as const;
const validTaggerDevices = ['auto', 'cpu', 'cuda'] as const;

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

// ==================== General Settings Routes ====================

/**
 * PUT /api/settings/general
 * Update general settings (e.g., language)
 */
router.put(
  '/general',
  asyncHandler(async (req: Request, res: Response) => {
    const generalSettings: Partial<GeneralSettings> = req.body;

    // Validate language if provided
    if (!validateStringEnumIfDefined(res, generalSettings.language, validLanguages, `Invalid language. Must be one of: ${validLanguages.join(', ')}`)) return;

    // Update settings
    const updatedSettings = settingsService.updateGeneralSettings(generalSettings);

    res.json({
      success: true,
      data: updatedSettings,
      message: 'General settings updated successfully',
    });
    return;
  })
);

// ==================== Tagger Settings Routes ====================

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
 * PUT /api/settings/kaloscope
 * Update kaloscope settings
 */
router.put(
  '/kaloscope',
  asyncHandler(async (req: Request, res: Response) => {
    const kaloscopeSettings: Partial<KaloscopeSettings> = req.body;

    if (!validateStringEnumIfDefined(res, kaloscopeSettings.device, validKaloscopeDevices, `Invalid device. Must be one of: ${validKaloscopeDevices.join(', ')}`)) return;
    if (!validateIntegerInRangeIfDefined(res, kaloscopeSettings.topK, 1, 200, 'topK must be an integer between 1 and 200')) return;

    if (kaloscopeSettings.autoUnloadMinutes !== undefined) {
      if (!Number.isInteger(kaloscopeSettings.autoUnloadMinutes) || kaloscopeSettings.autoUnloadMinutes < 1) {
        sendRouteBadRequest(res, 'autoUnloadMinutes must be an integer greater than or equal to 1');
        return;
      }
    }

    if (kaloscopeSettings.artistLinkUrlTemplate !== undefined) {
      const normalizedTemplate = String(kaloscopeSettings.artistLinkUrlTemplate).trim();

      if (!normalizedTemplate) {
        sendRouteBadRequest(res, 'artistLinkUrlTemplate must not be empty');
        return;
      }

      if (!normalizedTemplate.includes('{key}')) {
        sendRouteBadRequest(res, `artistLinkUrlTemplate must include {key}. Example: ${DEFAULT_ARTIST_LINK_URL_TEMPLATE}`);
        return;
      }

      kaloscopeSettings.artistLinkUrlTemplate = normalizedTemplate;
    }

    const currentSettings = settingsService.loadSettings();
    const nextEnabled = kaloscopeSettings.enabled ?? currentSettings.kaloscope.enabled;
    const wasEnabled = currentSettings.kaloscope.enabled;

    if (!wasEnabled && nextEnabled) {
      const dependencyStatus = await kaloscopeTaggerService.checkDependencies();
      if (!dependencyStatus.available) {
        sendRouteBadRequest(res, dependencyStatus.message);
        return;
      }
    }

    const updatedSettings = settingsService.updateKaloscopeSettings(kaloscopeSettings);
    await kaloscopeTaggerService.reloadConfig();
    autoTagScheduler.restart();

    res.json({
      success: true,
      data: updatedSettings,
      message: 'Kaloscope settings updated successfully',
    });
    return;
  })
);

/**
 * GET /api/settings/kaloscope/status
 * Get kaloscope runtime/config status
 */
router.get(
  '/kaloscope/status',
  asyncHandler(async (req: Request, res: Response) => {
    const status = await kaloscopeTaggerService.getServerStatus();

    res.json({
      success: true,
      data: status,
    });
    return;
  })
);

/**
 * POST /api/settings/kaloscope/load-model
 * Load the Kaloscope model into memory
 */
router.post(
  '/kaloscope/load-model',
  asyncHandler(async (req: Request, res: Response) => {
    await kaloscopeTaggerService.loadModel();

    res.json({
      success: true,
      message: 'Model loaded successfully',
    });
    return;
  })
);

/**
 * POST /api/settings/kaloscope/unload-model
 * Unload the Kaloscope model from memory
 */
router.post(
  '/kaloscope/unload-model',
  asyncHandler(async (req: Request, res: Response) => {
    await kaloscopeTaggerService.unloadModel();

    res.json({
      success: true,
      message: 'Model unloaded successfully',
    });
    return;
  })
);

/**
 * POST /api/settings/kaloscope/test
 * Test kaloscope tagging with a single image hash
 */
router.post(
  '/kaloscope/test',
  asyncHandler(async (req: Request, res: Response) => {
    const imageId = String(req.body?.imageId || '').trim();
    if (!imageId) {
      sendRouteBadRequest(res, 'imageId is required');
      return;
    }

    const target = autoTestMediaService.resolveFileTarget(imageId);
    if (!target || !target.originalFilePath) {
      res.status(404).json({
        success: false,
        error: 'Image not found or no active file',
      });
      return;
    }

    if (!target.resolvedPath || !target.existsOnDisk) {
      res.status(404).json({
        success: false,
        error: 'Image file not found on disk',
      });
      return;
    }

    const result = target.fileType === 'video'
      ? await kaloscopeTaggerService.tagVideo(target.resolvedPath)
      : await kaloscopeTaggerService.tagImage(target.resolvedPath);

    if (!result.success) {
      res.status(500).json({
        success: false,
        error: result.error || 'Kaloscope test failed',
        details: {
          error_type: result.error_type,
        },
      });
      return;
    }

    res.json({
      success: true,
      data: result,
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
    if (!validateNumberInRangeIfDefined(res, taggerSettings.generalThreshold, 0, 1, 'General threshold must be between 0 and 1')) return;
    if (!validateNumberInRangeIfDefined(res, taggerSettings.characterThreshold, 0, 1, 'Character threshold must be between 0 and 1')) return;
    if (!validateStringEnumIfDefined(res, taggerSettings.model, validTaggerModels, `Invalid model. Must be one of: ${validTaggerModels.join(', ')}`)) return;

    const currentSettings = settingsService.loadSettings();
    const nextEnabled = taggerSettings.enabled ?? currentSettings.tagger.enabled;
    const wasEnabled = currentSettings.tagger.enabled;

    if (!wasEnabled && nextEnabled) {
      const dependencyStatus = await imageTaggerService.checkPythonDependencies();
      if (!dependencyStatus.available) {
        sendRouteBadRequest(res, dependencyStatus.message);
        return;
      }
    }

    // Update settings
    const updatedSettings = settingsService.updateTaggerSettings(taggerSettings);

    // Reload tagger service configuration
    await imageTaggerService.reloadConfig();

    // Restart auto-tag scheduler to apply new settings (e.g. enabled/disabled)
    autoTagScheduler.restart();

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

    if (!model || !validTaggerModels.includes(model)) {
      sendRouteBadRequest(res, 'Invalid model. Must be one of: vit, swinv2, convnext');
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
    const { model, device }: { model?: TaggerModel; device?: TaggerDevice } = req.body;

    if (model && !validTaggerModels.includes(model)) {
      sendRouteBadRequest(res, 'Invalid model. Must be one of: vit, swinv2, convnext');
      return;
    }

    if (device && !validTaggerDevices.includes(device)) {
      sendRouteBadRequest(res, 'Invalid device. Must be one of: auto, cpu, cuda');
      return;
    }

    await imageTaggerService.loadModel(model, device);

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

/**
 * GET /api/settings/auto-test/media/:imageId
 * Resolve a test target by composite hash and report whether the file still exists.
 */
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
      res.status(404).json({
        success: false,
        error: 'Image not found or no active file',
      });
      return;
    }

    res.json({
      success: true,
      data: imageData,
    });
    return;
  })
);

/**
 * GET /api/settings/auto-test/random
 * Pick a random media row for Auto page testing.
 */
router.get(
  '/auto-test/random',
  asyncHandler(async (req: Request, res: Response) => {
    const imageData = autoTestMediaService.getRandomPayload();
    if (!imageData) {
      res.status(404).json({
        success: false,
        error: 'No active media found for testing',
      });
      return;
    }

    res.json({
      success: true,
      data: imageData,
    });
    return;
  })
);

/**
 * POST /api/settings/tagger/test
 * Test WD Tagger with a single media hash without changing saved settings.
 */
router.post(
  '/tagger/test',
  asyncHandler(async (req: Request, res: Response) => {
    const imageId = String(req.body?.imageId || '').trim();
    if (!imageId) {
      sendRouteBadRequest(res, 'imageId is required');
      return;
    }

    const target = autoTestMediaService.resolveFileTarget(imageId);
    if (!target || !target.originalFilePath) {
      res.status(404).json({
        success: false,
        error: 'Image not found or no active file',
      });
      return;
    }

    if (!target.resolvedPath || !target.existsOnDisk) {
      res.status(404).json({
        success: false,
        error: 'Image file not found on disk',
      });
      return;
    }

    const result = target.fileType === 'video'
      ? await imageTaggerService.tagVideo(target.resolvedPath)
      : await imageTaggerService.tagImage(target.resolvedPath);

    if (!result.success) {
      res.status(500).json({
        success: false,
        error: result.error || 'Tagger test failed',
        details: {
          error_type: result.error_type,
        },
      });
      return;
    }

    res.json({
      success: true,
      data: result,
    });
    return;
  })
);

router.use('/', appearanceSettingsRoutes);
router.use('/', mediaSettingsRoutes);
router.use('/rating', ratingSettingsRoutes);
router.use('/', runtimeSettingsRoutes);

export const settingsRoutes = router;
