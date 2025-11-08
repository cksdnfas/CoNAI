import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { settingsService } from '../services/settingsService';
import { imageTaggerService } from '../services/imageTaggerService';
import { RatingScoreService } from '../services/ratingScoreService';
import { SystemSettingsService } from '../services/systemSettingsService';
import { AutoScanScheduler } from '../services/autoScanScheduler';
import { GeneralSettings, TaggerSettings, SimilaritySettings, MetadataExtractionSettings, SupportedLanguage } from '../types/settings';
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

// ==================== System Settings Routes ====================

/**
 * GET /api/settings/phase2-interval
 * Get Phase 2 background processing interval
 */
router.get(
  '/phase2-interval',
  asyncHandler(async (req: Request, res: Response) => {
    const interval = SystemSettingsService.getPhase2Interval();
    res.json({
      success: true,
      data: { interval },
    });
    return;
  })
);

/**
 * PUT /api/settings/phase2-interval
 * Update Phase 2 background processing interval and restart scheduler
 */
router.put(
  '/phase2-interval',
  asyncHandler(async (req: Request, res: Response) => {
    const { interval } = req.body;

    if (typeof interval !== 'number' || interval < 5 || interval > 300) {
      res.status(400).json({
        success: false,
        error: 'Phase 2 간격은 5-300초 사이여야 합니다',
      });
      return;
    }

    // 설정 업데이트
    SystemSettingsService.updatePhase2Interval(interval);

    // 스케줄러 재시작
    AutoScanScheduler.restart();

    res.json({
      success: true,
      data: { interval },
      message: `Phase 2 처리 간격이 ${interval}초로 업데이트되었습니다`,
    });
    return;
  })
);

// ==================== Auto-Tagging Scheduler Settings Routes ====================

/**
 * GET /api/settings/auto-tag-config
 * Get auto-tagging scheduler configuration
 */
router.get(
  '/auto-tag-config',
  asyncHandler(async (req: Request, res: Response) => {
    const pollingInterval = SystemSettingsService.getAutoTagPollingInterval();
    const batchSize = SystemSettingsService.getAutoTagBatchSize();

    res.json({
      success: true,
      data: {
        pollingInterval,
        batchSize,
      },
    });
    return;
  })
);

/**
 * PUT /api/settings/auto-tag-config
 * Update auto-tagging scheduler configuration and restart scheduler
 */
router.put(
  '/auto-tag-config',
  asyncHandler(async (req: Request, res: Response) => {
    const { pollingInterval, batchSize } = req.body;

    // 폴링 간격 검증
    if (pollingInterval !== undefined) {
      if (typeof pollingInterval !== 'number' || pollingInterval < 5 || pollingInterval > 300) {
        res.status(400).json({
          success: false,
          error: '자동 태깅 폴링 간격은 5-300초 사이여야 합니다',
        });
        return;
      }
    }

    // 배치 크기 검증
    if (batchSize !== undefined) {
      if (typeof batchSize !== 'number' || batchSize < 1 || batchSize > 100) {
        res.status(400).json({
          success: false,
          error: '자동 태깅 배치 크기는 1-100 사이여야 합니다',
        });
        return;
      }
    }

    // 설정 업데이트
    if (pollingInterval !== undefined) {
      SystemSettingsService.updateAutoTagPollingInterval(pollingInterval);
    }
    if (batchSize !== undefined) {
      SystemSettingsService.updateAutoTagBatchSize(batchSize);
    }

    // 자동 태깅 스케줄러 재시작
    const { autoTagScheduler } = await import('../services/autoTagScheduler');
    autoTagScheduler.restart();

    const updatedConfig = {
      pollingInterval: SystemSettingsService.getAutoTagPollingInterval(),
      batchSize: SystemSettingsService.getAutoTagBatchSize(),
    };

    res.json({
      success: true,
      data: updatedConfig,
      message: '자동 태깅 스케줄러 설정이 업데이트되었습니다',
    });
    return;
  })
);

export const settingsRoutes = router;
