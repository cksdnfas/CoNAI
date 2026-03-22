import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { settingsService } from '../../services/settingsService';
import { MetadataExtractionSettings, SimilaritySettings, ThumbnailSettings } from '../../types/settings';

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

export { router as mediaSettingsRoutes };
