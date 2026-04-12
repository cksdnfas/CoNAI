import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { settingsService } from '../../services/settingsService';
import { ImageSaveSettings, MetadataExtractionSettings, SimilaritySettings, ThumbnailSettings } from '../../types/settings';

const router = Router();

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
      if (!Number.isInteger(similaritySettings.detailSimilarLimit) || similaritySettings.detailSimilarLimit < 1 || similaritySettings.detailSimilarLimit > 12) {
        res.status(400).json({
          success: false,
          error: 'detailSimilarLimit must be an integer between 1 and 12',
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

    if (similaritySettings.detailSimilarUseMetadataFilter !== undefined && typeof similaritySettings.detailSimilarUseMetadataFilter !== 'boolean') {
      res.status(400).json({
        success: false,
        error: 'detailSimilarUseMetadataFilter must be a boolean',
      });
      return;
    }

    const validateRange = (value: unknown, label: string, min: number, max: number) => {
      if (value !== undefined && (!Number.isFinite(value as number) || Number(value) < min || Number(value) > max)) {
        res.status(400).json({
          success: false,
          error: `${label} must be between ${min} and ${max}`,
        });
        return false;
      }
      return true;
    };

    if (similaritySettings.detailSimilarWeights) {
      if (!validateRange(similaritySettings.detailSimilarWeights.perceptualHash, 'detailSimilarWeights.perceptualHash', 0, 100)) return;
      if (!validateRange(similaritySettings.detailSimilarWeights.dHash, 'detailSimilarWeights.dHash', 0, 100)) return;
      if (!validateRange(similaritySettings.detailSimilarWeights.aHash, 'detailSimilarWeights.aHash', 0, 100)) return;
      if (!validateRange(similaritySettings.detailSimilarWeights.color, 'detailSimilarWeights.color', 0, 100)) return;
    }

    if (similaritySettings.detailSimilarThresholds) {
      if (!validateRange(similaritySettings.detailSimilarThresholds.perceptualHash, 'detailSimilarThresholds.perceptualHash', 0, 64)) return;
      if (!validateRange(similaritySettings.detailSimilarThresholds.dHash, 'detailSimilarThresholds.dHash', 0, 64)) return;
      if (!validateRange(similaritySettings.detailSimilarThresholds.aHash, 'detailSimilarThresholds.aHash', 0, 64)) return;
      if (!validateRange(similaritySettings.detailSimilarThresholds.color, 'detailSimilarThresholds.color', 0, 100)) return;
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

    if (similaritySettings.promptSimilarity !== undefined) {
      const promptSimilarity = similaritySettings.promptSimilarity;

      if (promptSimilarity.enabled !== undefined && typeof promptSimilarity.enabled !== 'boolean') {
        res.status(400).json({
          success: false,
          error: 'promptSimilarity.enabled must be a boolean',
        });
        return;
      }

      if (promptSimilarity.algorithm !== undefined) {
        const validAlgorithms = ['simhash', 'minhash'];
        if (!validAlgorithms.includes(promptSimilarity.algorithm)) {
          res.status(400).json({
            success: false,
            error: `promptSimilarity.algorithm must be one of: ${validAlgorithms.join(', ')}`,
          });
          return;
        }
      }

      if (promptSimilarity.autoBuildOnMetadataUpdate !== undefined && typeof promptSimilarity.autoBuildOnMetadataUpdate !== 'boolean') {
        res.status(400).json({
          success: false,
          error: 'promptSimilarity.autoBuildOnMetadataUpdate must be a boolean',
        });
        return;
      }

      if (promptSimilarity.resultLimit !== undefined) {
        if (!Number.isInteger(promptSimilarity.resultLimit) || promptSimilarity.resultLimit < 1 || promptSimilarity.resultLimit > 12) {
          res.status(400).json({
            success: false,
            error: 'promptSimilarity.resultLimit must be an integer between 1 and 12',
          });
          return;
        }
      }

      if (promptSimilarity.combinedThreshold !== undefined) {
        if (!Number.isFinite(promptSimilarity.combinedThreshold) || promptSimilarity.combinedThreshold < 0 || promptSimilarity.combinedThreshold > 100) {
          res.status(400).json({
            success: false,
            error: 'promptSimilarity.combinedThreshold must be between 0 and 100',
          });
          return;
        }
      }

      const validateWeight = (value: unknown, label: string) => {
        if (value !== undefined && (!Number.isFinite(value as number) || Number(value) < 0 || Number(value) > 1)) {
          res.status(400).json({
            success: false,
            error: `${label} must be between 0 and 1`,
          });
          return false;
        }
        return true;
      };

      if (promptSimilarity.weights) {
        if (!validateWeight(promptSimilarity.weights.positive, 'promptSimilarity.weights.positive')) return;
        if (!validateWeight(promptSimilarity.weights.negative, 'promptSimilarity.weights.negative')) return;
        if (!validateWeight(promptSimilarity.weights.auto, 'promptSimilarity.weights.auto')) return;
      }

      if (promptSimilarity.fieldThresholds) {
        if (!validateWeight(promptSimilarity.fieldThresholds.positive, 'promptSimilarity.fieldThresholds.positive')) return;
        if (!validateWeight(promptSimilarity.fieldThresholds.negative, 'promptSimilarity.fieldThresholds.negative')) return;
        if (!validateWeight(promptSimilarity.fieldThresholds.auto, 'promptSimilarity.fieldThresholds.auto')) return;
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

    if (metadataSettings.stealthMaxFileSizeMB !== undefined) {
      if (metadataSettings.stealthMaxFileSizeMB <= 0) {
        res.status(400).json({
          success: false,
          error: 'File size limit must be greater than 0',
        });
        return;
      }
    }

    if (metadataSettings.stealthMaxResolutionMP !== undefined) {
      if (metadataSettings.stealthMaxResolutionMP <= 0) {
        res.status(400).json({
          success: false,
          error: 'Resolution limit must be greater than 0',
        });
        return;
      }
    }

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

    if (thumbnailSettings.quality !== undefined) {
      if (thumbnailSettings.quality < 60 || thumbnailSettings.quality > 100) {
        res.status(400).json({
          success: false,
          error: 'Quality must be between 60 and 100',
        });
        return;
      }
    }

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

    if (imageSaveSettings.defaultFormat !== undefined) {
      const validFormats = ['original', 'png', 'jpeg', 'webp'];
      if (!validFormats.includes(imageSaveSettings.defaultFormat)) {
        res.status(400).json({
          success: false,
          error: `Invalid format. Must be one of: ${validFormats.join(', ')}`,
        });
        return;
      }
    }

    if (imageSaveSettings.quality !== undefined) {
      if (!Number.isFinite(imageSaveSettings.quality) || imageSaveSettings.quality < 1 || imageSaveSettings.quality > 100) {
        res.status(400).json({
          success: false,
          error: 'Quality must be between 1 and 100',
        });
        return;
      }
    }

    for (const field of ['maxWidth', 'maxHeight'] as const) {
      const value = imageSaveSettings[field];
      if (value !== undefined && (!Number.isInteger(value) || value < 64 || value > 16384)) {
        res.status(400).json({
          success: false,
          error: `${field} must be an integer between 64 and 16384`,
        });
        return;
      }
    }

    for (const field of ['resizeEnabled', 'alwaysShowDialog', 'applyToGenerationAttachments', 'applyToEditorSave', 'applyToCanvasSave', 'applyToUpload', 'applyToWorkflowOutputs'] as const) {
      const value = imageSaveSettings[field];
      if (value !== undefined && typeof value !== 'boolean') {
        res.status(400).json({
          success: false,
          error: `${field} must be a boolean`,
        });
        return;
      }
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
