import { Router, Request, Response } from 'express';
import fs from 'fs';
import { asyncHandler } from '../middleware/errorHandler';
import { settingsService } from '../services/settingsService';
import { imageTaggerService, ImageTaggerService } from '../services/imageTaggerService';
import { RatingScoreService } from '../services/ratingScoreService';
import { SystemSettingsService } from '../services/systemSettingsService';
import { AutoScanScheduler } from '../services/autoScanScheduler';
import { autoTagScheduler } from '../services/autoTagScheduler';
import { kaloscopeTaggerService } from '../services/kaloscopeTaggerService';
import path from 'path';
import { GeneralSettings, TaggerSettings, KaloscopeSettings, TaggerDevice, TaggerModel, SimilaritySettings, MetadataExtractionSettings, ThumbnailSettings, SupportedLanguage, KaloscopeServerStatus } from '../types/settings';
import { RatingWeightsUpdate, RatingTierInput, RatingData } from '../types/rating';
import { MaintenanceService } from '../services/maintenanceService';
import { db } from '../database/init';
import { resolveUploadsPath, runtimePaths } from '../config/runtimePaths';

const router = Router();

function isKaloscopeModelCached(repoId: string, modelFile: string): boolean {
  const modelDirName = `models--${repoId.replace('/', '--')}`;
  const possibleBasePaths = [
    path.join(runtimePaths.modelsDir, modelDirName),
    path.join(runtimePaths.modelsDir, 'hub', modelDirName),
  ];

  for (const basePath of possibleBasePaths) {
    const snapshotsPath = path.join(basePath, 'snapshots');
    if (!fs.existsSync(snapshotsPath)) {
      continue;
    }

    try {
      const snapshots = fs.readdirSync(snapshotsPath);
      for (const snapshot of snapshots) {
        const snapshotPath = path.join(snapshotsPath, snapshot);
        if (!fs.statSync(snapshotPath).isDirectory()) {
          continue;
        }

        const exactPath = path.join(snapshotPath, modelFile);
        if (fs.existsSync(exactPath)) {
          return true;
        }

        const modelFileName = path.basename(modelFile);
        const directPath = path.join(snapshotPath, modelFileName);
        if (fs.existsSync(directPath)) {
          return true;
        }
      }
    } catch {
      // Ignore cache read errors and treat as not cached.
    }
  }

  return false;
}

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
    const settings = settingsService.loadSettings();
    const modelRepo = process.env.KALOSCOPE_MODEL_REPO || 'DraconicDragon/Kaloscope-onnx';
    const modelFile = process.env.KALOSCOPE_MODEL_FILE || 'v2.0/kaloscope_2-0.onnx';
    const scriptPath = path.join(__dirname, '..', '..', 'python', 'kaloscope_tagger.py');
    const dependencyStatus = await kaloscopeTaggerService.checkDependencies();

    const status: KaloscopeServerStatus = {
      enabled: settings.kaloscope.enabled,
      autoTagOnUpload: settings.kaloscope.autoTagOnUpload,
      currentDevice: settings.kaloscope.device,
      topK: settings.kaloscope.topK,
      scriptExists: fs.existsSync(scriptPath),
      modelCached: isKaloscopeModelCached(modelRepo, modelFile),
      modelRepo,
      modelFile,
      dependenciesAvailable: dependencyStatus.available,
      missingPackages: dependencyStatus.missingPackages,
      statusMessage: dependencyStatus.message,
      installCommand: dependencyStatus.installCommand,
    };

    res.json({
      success: true,
      data: status,
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

    const imageData = db.prepare(`
      SELECT
        mm.composite_hash,
        if_.original_file_path,
        if_.mime_type as file_mime_type,
        mm.mime_type
      FROM media_metadata mm
      LEFT JOIN image_files if_ ON mm.composite_hash = if_.composite_hash AND if_.file_status = 'active'
      WHERE mm.composite_hash = ?
      LIMIT 1
    `).get(imageId) as { composite_hash: string; original_file_path: string | null; file_mime_type: string | null; mime_type: string | null } | undefined;

    if (!imageData || !imageData.original_file_path) {
      res.status(404).json({
        success: false,
        error: 'Image not found or no active file',
      });
      return;
    }

    const imagePath = resolveUploadsPath(imageData.original_file_path);
    if (!fs.existsSync(imagePath)) {
      res.status(404).json({
        success: false,
        error: 'Image file not found on disk',
      });
      return;
    }

    const mimeType = imageData.file_mime_type || imageData.mime_type || undefined;
    if (ImageTaggerService.isVideoFile(imagePath, mimeType)) {
      res.status(400).json({
        success: false,
        error: 'Kaloscope test supports only image files',
      });
      return;
    }

    const result = await kaloscopeTaggerService.tagImage(imagePath);
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
        error: '백그라운드 간격은 5-300초 사이여야 합니다',
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
      message: `백그라운드 처리 간격이 ${interval}초로 업데이트되었습니다`,
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

// ==================== Maintenance Routes ====================

/**
 * POST /api/settings/maintenance/sync-tags
 * Sync auto-tags from media_metadata to auto_prompt_collection
 */
router.post(
  '/maintenance/sync-tags',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await MaintenanceService.syncAutoTags();
      res.json({
        success: true,
        data: result,
        message: `Sync complete. Processed ${result.processed} images, collected ${result.collected} tags.`,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during sync',
      });
    }
    return;
  })
);

export const settingsRoutes = router;
