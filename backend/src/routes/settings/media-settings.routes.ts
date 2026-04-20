import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import {
  validateBooleanIfDefined,
  validateIntegerInRangeIfDefined,
  validateNumberGreaterThanIfDefined,
  validateNumberInRangeIfDefined,
  validateStringEnumIfDefined,
} from '../routeValidation';
import { settingsService } from '../../services/settingsService';
import { ImageSaveSettings, MetadataExtractionSettings, SimilaritySettings, ThumbnailSettings } from '../../types/settings';

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

export { router as mediaSettingsRoutes };
