import { Router, Request, Response } from 'express';
import { routeParam } from './routeParam';
import { asyncHandler } from '../middleware/errorHandler';
import { settingsService } from '../services/settingsService';
import { imageTaggerService } from '../services/imageTaggerService';
import { autoTagScheduler } from '../services/autoTagScheduler';
import { kaloscopeTaggerService } from '../services/kaloscopeTaggerService';
import { GeneralSettings, TaggerSettings, KaloscopeSettings, TaggerDevice, TaggerModel, SimilaritySettings, MetadataExtractionSettings, ThumbnailSettings, SupportedLanguage } from '../types/settings';
import { autoTestMediaService } from '../services/autoTestMediaService';
import { ratingSettingsRoutes } from './settings/rating.routes';
import { runtimeSettingsRoutes } from './settings/runtime.routes';

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
    if (generalSettings.language !== undefined) {
      const validLanguages: SupportedLanguage[] = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW'];
      if (!validLanguages.includes(generalSettings.language)) {
        res.status(400).json({
          success: false,
          error: `Invalid language. Must be one of: ${validLanguages.join(', ')}`,
        });
        return;
      }
    }

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

    if (kaloscopeSettings.device !== undefined) {
      const validDevices = ['auto', 'cpu', 'cuda'];
      if (!validDevices.includes(kaloscopeSettings.device)) {
        res.status(400).json({
          success: false,
          error: `Invalid device. Must be one of: ${validDevices.join(', ')}`,
        });
        return;
      }
    }

    if (kaloscopeSettings.topK !== undefined) {
      if (!Number.isInteger(kaloscopeSettings.topK) || kaloscopeSettings.topK < 1 || kaloscopeSettings.topK > 200) {
        res.status(400).json({
          success: false,
          error: 'topK must be an integer between 1 and 200',
        });
        return;
      }
    }

    const updatedSettings = settingsService.updateKaloscopeSettings(kaloscopeSettings);
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
 * Cache the Kaloscope model locally
 */
router.post(
  '/kaloscope/load-model',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await kaloscopeTaggerService.ensureModelCached();

    if (!result.success) {
      res.status(400).json({
        success: false,
        error: result.message,
      });
      return;
    }

    res.json({
      success: true,
      data: result,
      message: result.message,
    });
    return;
  })
);

/**
 * POST /api/settings/kaloscope/unload-model
 * Remove the cached Kaloscope model files
 */
router.post(
  '/kaloscope/unload-model',
  asyncHandler(async (req: Request, res: Response) => {
    const result = kaloscopeTaggerService.clearModelCache();

    res.json({
      success: true,
      data: result,
      message: result.message,
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
      res.status(400).json({
        success: false,
        error: 'imageId is required',
      });
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

    const currentSettings = settingsService.loadSettings();
    const nextEnabled = taggerSettings.enabled ?? currentSettings.tagger.enabled;
    const wasEnabled = currentSettings.tagger.enabled;

    if (!wasEnabled && nextEnabled) {
      const dependencyStatus = await imageTaggerService.checkPythonDependencies();
      if (!dependencyStatus.available) {
        res.status(400).json({
          success: false,
          error: dependencyStatus.message,
        });
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
    const { model, device }: { model?: TaggerModel; device?: TaggerDevice } = req.body;

    if (model && !['vit', 'swinv2', 'convnext'].includes(model)) {
      res.status(400).json({
        success: false,
        error: 'Invalid model. Must be one of: vit, swinv2, convnext',
      });
      return;
    }

    if (device && !['auto', 'cpu', 'cuda'].includes(device)) {
      res.status(400).json({
        success: false,
        error: 'Invalid device. Must be one of: auto, cpu, cuda',
      });
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
      res.status(400).json({
        success: false,
        error: 'imageId is required',
      });
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
      res.status(400).json({
        success: false,
        error: 'imageId is required',
      });
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

// ==================== Similarity Settings Routes ====================

/**
 * PUT /api/settings/similarity
 * Update similarity settings
 */
router.put(
  '/similarity',
  asyncHandler(async (req: Request, res: Response) => {
    const similaritySettings: Partial<SimilaritySettings> = req.body;

    if (similaritySettings.autoGenerateHashOnUpload !== undefined && typeof similaritySettings.autoGenerateHashOnUpload !== 'boolean') {
      res.status(400).json({
        success: false,
        error: 'autoGenerateHashOnUpload must be a boolean',
      });
      return;
    }

    if (similaritySettings.detailSimilarThreshold !== undefined) {
      if (!Number.isInteger(similaritySettings.detailSimilarThreshold) || similaritySettings.detailSimilarThreshold < 1 || similaritySettings.detailSimilarThreshold > 64) {
        res.status(400).json({
          success: false,
          error: 'detailSimilarThreshold must be an integer between 1 and 64',
        });
        return;
      }
    }

    if (similaritySettings.detailSimilarLimit !== undefined) {
      if (!Number.isInteger(similaritySettings.detailSimilarLimit) || similaritySettings.detailSimilarLimit < 1 || similaritySettings.detailSimilarLimit > 100) {
        res.status(400).json({
          success: false,
          error: 'detailSimilarLimit must be an integer between 1 and 100',
        });
        return;
      }
    }

    if (similaritySettings.detailSimilarIncludeColorSimilarity !== undefined && typeof similaritySettings.detailSimilarIncludeColorSimilarity !== 'boolean') {
      res.status(400).json({
        success: false,
        error: 'detailSimilarIncludeColorSimilarity must be a boolean',
      });
      return;
    }

    if (similaritySettings.detailSimilarSortBy !== undefined) {
      const validSortBy = ['similarity', 'upload_date', 'file_size'];
      if (!validSortBy.includes(similaritySettings.detailSimilarSortBy)) {
        res.status(400).json({
          success: false,
          error: `detailSimilarSortBy must be one of: ${validSortBy.join(', ')}`,
        });
        return;
      }
    }

    if (similaritySettings.detailSimilarSortOrder !== undefined) {
      const validSortOrder = ['ASC', 'DESC'];
      if (!validSortOrder.includes(similaritySettings.detailSimilarSortOrder)) {
        res.status(400).json({
          success: false,
          error: `detailSimilarSortOrder must be one of: ${validSortOrder.join(', ')}`,
        });
        return;
      }
    }

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

// ==================== Metadata Extraction Settings Routes ====================

/**
 * PUT /api/settings/metadata
 * Update metadata extraction settings
 */
router.put(
  '/metadata',
  asyncHandler(async (req: Request, res: Response) => {
    const metadataSettings: Partial<MetadataExtractionSettings> = req.body;

    // Validate scan mode if provided
    if (metadataSettings.stealthScanMode !== undefined) {
      const validModes = ['fast', 'full', 'skip'];
      if (!validModes.includes(metadataSettings.stealthScanMode)) {
        res.status(400).json({
          success: false,
          error: `Invalid scan mode. Must be one of: ${validModes.join(', ')}`,
        });
        return;
      }
    }

    // Validate file size limit if provided
    if (metadataSettings.stealthMaxFileSizeMB !== undefined) {
      if (metadataSettings.stealthMaxFileSizeMB <= 0) {
        res.status(400).json({
          success: false,
          error: 'File size limit must be greater than 0',
        });
        return;
      }
    }

    // Validate resolution limit if provided
    if (metadataSettings.stealthMaxResolutionMP !== undefined) {
      if (metadataSettings.stealthMaxResolutionMP <= 0) {
        res.status(400).json({
          success: false,
          error: 'Resolution limit must be greater than 0',
        });
        return;
      }
    }

    // Update settings
    const updatedSettings = settingsService.updateMetadataSettings(metadataSettings);

    res.json({
      success: true,
      data: updatedSettings,
      message: 'Metadata extraction settings updated successfully',
    });
    return;
  })
);

// ==================== Thumbnail Settings Routes ====================

/**
 * PUT /api/settings/thumbnail
 * Update thumbnail settings
 */
router.put(
  '/thumbnail',
  asyncHandler(async (req: Request, res: Response) => {
    const thumbnailSettings: Partial<ThumbnailSettings> = req.body;

    // Validate size if provided
    if (thumbnailSettings.size !== undefined) {
      const validSizes = ['original', '2048', '1080', '720', '512'];
      if (!validSizes.includes(thumbnailSettings.size)) {
        res.status(400).json({
          success: false,
          error: `Invalid size. Must be one of: ${validSizes.join(', ')}`,
        });
        return;
      }
    }

    // Validate quality if provided
    if (thumbnailSettings.quality !== undefined) {
      if (thumbnailSettings.quality < 60 || thumbnailSettings.quality > 100) {
        res.status(400).json({
          success: false,
          error: 'Quality must be between 60 and 100',
        });
        return;
      }
    }

    // Update settings
    const updatedSettings = settingsService.updateThumbnailSettings(thumbnailSettings);

    res.json({
      success: true,
      data: updatedSettings,
      message: 'Thumbnail settings updated successfully',
    });
    return;
  })
);

router.use('/rating', ratingSettingsRoutes);
router.use('/', runtimeSettingsRoutes);

export const settingsRoutes = router;
