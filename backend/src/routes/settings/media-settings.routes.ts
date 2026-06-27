import { Router, Request, Response } from 'express';
import fs from 'fs';
import { asyncHandler } from '../../middleware/errorHandler';
import { db } from '../../database/init';
import { resolveUploadsPath } from '../../config/runtimePaths';
import {
  validateBooleanIfDefined,
  validateIntegerInRangeIfDefined,
  validateNumberGreaterThanIfDefined,
  validateNumberInRangeIfDefined,
  validateStringEnumIfDefined,
} from '../routeValidation';
import { BackgroundQueueService } from '../../services/backgroundQueue';
import { settingsService } from '../../services/settingsService';
import { GenerationThrottleSettings, ImageSaveSettings, MetadataExtractionSettings, SimilaritySettings, ThumbnailSettings, VideoOptimizationSettings } from '../../types/settings';

const router = Router();

router.put(
  '/similarity',
  asyncHandler(async (req: Request, res: Response) => {
    const similaritySettings: Partial<SimilaritySettings> = req.body;

    if (!validateBooleanIfDefined(res, similaritySettings.autoGenerateHashOnUpload, 'autoGenerateHashOnUpload must be a boolean')) return;
    if (!validateIntegerInRangeIfDefined(res, similaritySettings.detailSimilarThreshold, 1, 64, 'detailSimilarThreshold must be an integer between 1 and 64')) return;
    if (!validateIntegerInRangeIfDefined(res, similaritySettings.detailSimilarLimit, 1, 12, 'detailSimilarLimit must be an integer between 1 and 12')) return;
    if (!validateBooleanIfDefined(res, similaritySettings.detailSimilarIncludeColorSimilarity, 'detailSimilarIncludeColorSimilarity must be a boolean')) return;
    if (!validateBooleanIfDefined(res, similaritySettings.detailSimilarUseMetadataFilter, 'detailSimilarUseMetadataFilter must be a boolean')) return;

    if (similaritySettings.detailSimilarWeights) {
      if (!validateNumberInRangeIfDefined(res, similaritySettings.detailSimilarWeights.perceptualHash, 0, 100, 'detailSimilarWeights.perceptualHash must be between 0 and 100')) return;
      if (!validateNumberInRangeIfDefined(res, similaritySettings.detailSimilarWeights.dHash, 0, 100, 'detailSimilarWeights.dHash must be between 0 and 100')) return;
      if (!validateNumberInRangeIfDefined(res, similaritySettings.detailSimilarWeights.aHash, 0, 100, 'detailSimilarWeights.aHash must be between 0 and 100')) return;
      if (!validateNumberInRangeIfDefined(res, similaritySettings.detailSimilarWeights.color, 0, 100, 'detailSimilarWeights.color must be between 0 and 100')) return;
    }

    if (similaritySettings.detailSimilarThresholds) {
      if (!validateNumberInRangeIfDefined(res, similaritySettings.detailSimilarThresholds.perceptualHash, 0, 64, 'detailSimilarThresholds.perceptualHash must be between 0 and 64')) return;
      if (!validateNumberInRangeIfDefined(res, similaritySettings.detailSimilarThresholds.dHash, 0, 64, 'detailSimilarThresholds.dHash must be between 0 and 64')) return;
      if (!validateNumberInRangeIfDefined(res, similaritySettings.detailSimilarThresholds.aHash, 0, 64, 'detailSimilarThresholds.aHash must be between 0 and 64')) return;
      if (!validateNumberInRangeIfDefined(res, similaritySettings.detailSimilarThresholds.color, 0, 100, 'detailSimilarThresholds.color must be between 0 and 100')) return;
    }

    const validSortBy = ['similarity', 'upload_date', 'file_size'] as const;
    if (!validateStringEnumIfDefined(res, similaritySettings.detailSimilarSortBy, validSortBy, `detailSimilarSortBy must be one of: ${validSortBy.join(', ')}`)) return;

    const validSortOrder = ['ASC', 'DESC'] as const;
    if (!validateStringEnumIfDefined(res, similaritySettings.detailSimilarSortOrder, validSortOrder, `detailSimilarSortOrder must be one of: ${validSortOrder.join(', ')}`)) return;

    if (similaritySettings.promptSimilarity !== undefined) {
      const promptSimilarity = similaritySettings.promptSimilarity;

      if (!validateBooleanIfDefined(res, promptSimilarity.enabled, 'promptSimilarity.enabled must be a boolean')) return;

      const validAlgorithms = ['simhash', 'minhash'] as const;
      if (!validateStringEnumIfDefined(res, promptSimilarity.algorithm, validAlgorithms, `promptSimilarity.algorithm must be one of: ${validAlgorithms.join(', ')}`)) return;

      if (!validateBooleanIfDefined(res, promptSimilarity.autoBuildOnMetadataUpdate, 'promptSimilarity.autoBuildOnMetadataUpdate must be a boolean')) return;
      if (!validateIntegerInRangeIfDefined(res, promptSimilarity.resultLimit, 1, 12, 'promptSimilarity.resultLimit must be an integer between 1 and 12')) return;
      if (!validateNumberInRangeIfDefined(res, promptSimilarity.combinedThreshold, 0, 100, 'promptSimilarity.combinedThreshold must be between 0 and 100')) return;

      if (promptSimilarity.weights) {
        if (!validateNumberInRangeIfDefined(res, promptSimilarity.weights.positive, 0, 1, 'promptSimilarity.weights.positive must be between 0 and 1')) return;
        if (!validateNumberInRangeIfDefined(res, promptSimilarity.weights.negative, 0, 1, 'promptSimilarity.weights.negative must be between 0 and 1')) return;
        if (!validateNumberInRangeIfDefined(res, promptSimilarity.weights.auto, 0, 1, 'promptSimilarity.weights.auto must be between 0 and 1')) return;
      }

      if (promptSimilarity.fieldThresholds) {
        if (!validateNumberInRangeIfDefined(res, promptSimilarity.fieldThresholds.positive, 0, 100, 'promptSimilarity.fieldThresholds.positive must be between 0 and 100')) return;
        if (!validateNumberInRangeIfDefined(res, promptSimilarity.fieldThresholds.negative, 0, 100, 'promptSimilarity.fieldThresholds.negative must be between 0 and 100')) return;
        if (!validateNumberInRangeIfDefined(res, promptSimilarity.fieldThresholds.auto, 0, 100, 'promptSimilarity.fieldThresholds.auto must be between 0 and 100')) return;
      }
    }

    const updatedSettings = settingsService.updateSimilaritySettings(similaritySettings);

    res.json({
      success: true,
      data: updatedSettings,
      message: 'Similarity settings updated successfully',
    });
    return;
  }),
);

router.put(
  '/metadata',
  asyncHandler(async (req: Request, res: Response) => {
    const metadataSettings: Partial<MetadataExtractionSettings> = req.body;

    const validModes = ['fast', 'full', 'skip'] as const;
    if (!validateStringEnumIfDefined(res, metadataSettings.stealthScanMode, validModes, `Invalid scan mode. Must be one of: ${validModes.join(', ')}`)) return;
    if (!validateNumberGreaterThanIfDefined(res, metadataSettings.stealthMaxFileSizeMB, 0, 'File size limit must be greater than 0')) return;
    if (!validateNumberGreaterThanIfDefined(res, metadataSettings.stealthMaxResolutionMP, 0, 'Resolution limit must be greater than 0')) return;

    const updatedSettings = settingsService.updateMetadataSettings(metadataSettings);

    res.json({
      success: true,
      data: updatedSettings,
      message: 'Metadata extraction settings updated successfully',
    });
    return;
  }),
);

router.post(
  '/metadata/reextract-all',
  asyncHandler(async (_req: Request, res: Response) => {
    const rows = db.prepare(`
      SELECT f.composite_hash, f.original_file_path
      FROM image_files f
      WHERE f.file_status = 'active'
        AND f.file_type = 'image'
        AND f.composite_hash IS NOT NULL
        AND f.original_file_path IS NOT NULL
        AND f.id = (
          SELECT f2.id
          FROM image_files f2
          WHERE f2.composite_hash = f.composite_hash
            AND f2.file_status = 'active'
            AND f2.file_type = 'image'
            AND f2.original_file_path IS NOT NULL
          ORDER BY f2.last_verified_date DESC, f2.id DESC
          LIMIT 1
        )
      ORDER BY f.scan_date DESC, f.id DESC
    `).all() as Array<{ composite_hash: string; original_file_path: string }>;

    let queuedCount = 0;
    let skippedMissingCount = 0;

    for (const row of rows) {
      const filePath = resolveUploadsPath(row.original_file_path);
      if (!fs.existsSync(filePath)) {
        skippedMissingCount += 1;
        continue;
      }

      BackgroundQueueService.addMetadataExtractionTask(filePath, row.composite_hash);
      queuedCount += 1;
    }

    res.json({
      success: true,
      data: {
        queuedCount,
        skippedMissingCount,
        totalCandidates: rows.length,
      },
      message: 'Metadata re-extraction queued successfully',
    });
    return;
  }),
);

router.put(
  '/thumbnail',
  asyncHandler(async (req: Request, res: Response) => {
    const thumbnailSettings: Partial<ThumbnailSettings> = req.body;

    const validSizes = ['original', '2048', '1080', '720', '512'] as const;
    if (!validateStringEnumIfDefined(res, thumbnailSettings.size, validSizes, `Invalid size. Must be one of: ${validSizes.join(', ')}`)) return;
    if (!validateNumberInRangeIfDefined(res, thumbnailSettings.quality, 60, 100, 'Quality must be between 60 and 100')) return;

    const updatedSettings = settingsService.updateThumbnailSettings(thumbnailSettings);

    res.json({
      success: true,
      data: updatedSettings,
      message: 'Thumbnail settings updated successfully',
    });
    return;
  }),
);

router.put(
  '/image-save',
  asyncHandler(async (req: Request, res: Response) => {
    const imageSaveSettings: Partial<ImageSaveSettings> = req.body;

    const validFormats = ['original', 'png', 'jpeg', 'webp'] as const;
    if (!validateStringEnumIfDefined(res, imageSaveSettings.defaultFormat, validFormats, `Invalid format. Must be one of: ${validFormats.join(', ')}`)) return;
    if (!validateNumberInRangeIfDefined(res, imageSaveSettings.quality, 1, 100, 'Quality must be between 1 and 100')) return;

    for (const field of ['maxWidth', 'maxHeight'] as const) {
      const value = imageSaveSettings[field];
      if (!validateIntegerInRangeIfDefined(res, value, 64, 16384, `${field} must be an integer between 64 and 16384`)) return;
    }

    for (const field of ['resizeEnabled', 'alwaysShowDialog', 'applyToGenerationAttachments', 'applyToEditorSave', 'applyToCanvasSave', 'applyToUpload', 'applyToWorkflowOutputs'] as const) {
      const value = imageSaveSettings[field];
      if (!validateBooleanIfDefined(res, value, `${field} must be a boolean`)) return;
    }

    const updatedSettings = settingsService.updateImageSaveSettings(imageSaveSettings);

    res.json({
      success: true,
      data: updatedSettings,
      message: 'Image save settings updated successfully',
    });
    return;
  }),
);

router.put(
  '/generation-throttle',
  asyncHandler(async (req: Request, res: Response) => {
    const generationThrottleSettings: Partial<GenerationThrottleSettings> = req.body;

    const validateServiceThrottle = (serviceSettings: Partial<GenerationThrottleSettings['novelai']> | undefined, label: string) => {
      if (serviceSettings === undefined) {
        return true;
      }

      if (!serviceSettings || typeof serviceSettings !== 'object' || Array.isArray(serviceSettings)) {
        res.status(400).json({ success: false, error: `${label} throttle settings must be an object` });
        return false;
      }

      const validScheduleModes = ['even', 'random'] as const;
      if (!validateIntegerInRangeIfDefined(res, serviceSettings.maxConcurrentJobs, 1, 8, `${label} maxConcurrentJobs must be an integer between 1 and 8`)) return false;
      if (!validateIntegerInRangeIfDefined(res, serviceSettings.scheduleWindowMinutes, 1, 1440, `${label} scheduleWindowMinutes must be an integer between 1 and 1440`)) return false;
      if (!validateIntegerInRangeIfDefined(res, serviceSettings.scheduleJobCount, 1, 10000, `${label} scheduleJobCount must be an integer between 1 and 10000`)) return false;
      if (!validateStringEnumIfDefined(res, serviceSettings.scheduleMode, validScheduleModes, `${label} scheduleMode must be one of: ${validScheduleModes.join(', ')}`)) return false;
      if (!validateIntegerInRangeIfDefined(res, serviceSettings.minStartIntervalSeconds, 0, 3600, `${label} minStartIntervalSeconds must be an integer between 0 and 3600`)) return false;

      return true;
    };

    const validateReservationThrottle = (reservationSettings: Partial<GenerationThrottleSettings['reservations']> | undefined) => {
      if (reservationSettings === undefined) {
        return true;
      }

      if (!reservationSettings || typeof reservationSettings !== 'object' || Array.isArray(reservationSettings)) {
        res.status(400).json({ success: false, error: 'Reservation throttle settings must be an object' });
        return false;
      }

      const validUserQueuePolicies = ['continue_limited', 'hold_until_empty'] as const;
      if (!validateIntegerInRangeIfDefined(res, reservationSettings.maxConcurrentJobs, 1, 12, 'Reservation maxConcurrentJobs must be an integer between 1 and 12')) return false;
      if (!validateStringEnumIfDefined(res, reservationSettings.userQueuePolicy, validUserQueuePolicies, `Reservation userQueuePolicy must be one of: ${validUserQueuePolicies.join(', ')}`)) return false;

      return true;
    };

    if (!validateServiceThrottle(generationThrottleSettings.novelai, 'NovelAI')) return;
    if (!validateServiceThrottle(generationThrottleSettings.codex, 'Codex')) return;
    if (!validateReservationThrottle(generationThrottleSettings.reservations)) return;

    const updatedSettings = settingsService.updateGenerationThrottleSettings(generationThrottleSettings);

    res.json({
      success: true,
      data: updatedSettings,
      message: 'Generation throttle settings updated successfully',
    });
    return;
  }),
);

router.put(
  '/video-optimization',
  asyncHandler(async (req: Request, res: Response) => {
    const videoOptimizationSettings: Partial<VideoOptimizationSettings> = req.body;

    const validPresets = ['high-quality', 'balanced', 'economy'] as const;
    if (!validateStringEnumIfDefined(res, videoOptimizationSettings.preset, validPresets, `Invalid preset. Must be one of: ${validPresets.join(', ')}`)) return;
    if (!validateIntegerInRangeIfDefined(res, videoOptimizationSettings.crf, 18, 40, 'crf must be an integer between 18 and 40')) return;
    if (!validateIntegerInRangeIfDefined(res, videoOptimizationSettings.audioBitrateKbps, 32, 320, 'audioBitrateKbps must be an integer between 32 and 320')) return;

    for (const field of ['enabled', 'applyToUpload', 'applyToGeneratedOutputs', 'applyToBackupImports'] as const) {
      const value = videoOptimizationSettings[field];
      if (!validateBooleanIfDefined(res, value, `${field} must be a boolean`)) return;
    }

    const updatedSettings = settingsService.updateVideoOptimizationSettings(videoOptimizationSettings);

    res.json({
      success: true,
      data: updatedSettings,
      message: 'Video optimization settings updated successfully',
    });
    return;
  }),
);

export { router as mediaSettingsRoutes };
