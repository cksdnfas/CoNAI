import { requireImageAction } from '../../middleware/imageAccess';
import { Router, Request, Response } from 'express';
import { routeParam } from '../routeParam';
import fs from 'fs';
import { asyncHandler } from '../../middleware/asyncHandler';
import { ImageTaggingModel } from '../../models/Image/ImageTaggingModel';
import { resolveUploadsPath } from '../../config/runtimePaths';
import { logger } from '../../utils/logger';
import { QueryCacheService } from '../../services/QueryCacheService';
import {
  processHashTaggingItem,
  processRecordTaggingItem,
  queryActiveImageRecord,
  tagAndPersistTarget,
  type TaggingResultPayload,
} from '../../services/hashTaggingService';
import { sendRouteBadRequest } from '../routeValidation';
import { respondWithStartedJob } from '../runtimeJobRouteHelpers';

const router = Router();

/** Read the shared image tagging route param without redundant re-normalization. */
function getTaggingCompositeHash(req: Request): string {
  return routeParam(req.params.id);
}

/** Validate the existing batch-tag payload shape without changing the 400 response body. */
function validateBatchImageIds(res: Response, imageIds: unknown): imageIds is any[] {
  if (!Array.isArray(imageIds) || imageIds.length === 0) {
    sendRouteBadRequest(res, 'image_ids must be a non-empty array');
    return false;
  }

  return true;
}

function parseBatchLimit(limit: unknown): number {
  return limit ? parseInt(limit as string) : 100;
}

router.post('/:id/tag', requireImageAction('images.edit'), asyncHandler(async (req: Request, res: Response) => {
  const compositeHash = getTaggingCompositeHash(req);

  console.log('[TagRoute] POST /:id/tag hit!');
  logger.debug('[TagRoute] POST /:id/tag hit!');
  logger.debug(`[TagRoute] routeParam(req.params.id): ${compositeHash}`);
  logger.debug(`[TagRoute] req.url: ${req.url}`);
  logger.debug(`[TagRoute] req.path: ${req.path}`);

  if (!compositeHash) {
    logger.debug(`[TagRoute] Invalid composite hash: ${compositeHash}`);
    sendRouteBadRequest(res, 'Invalid composite hash');
    return;
  }

  try {
    logger.debug(`[TagRoute] Querying database for composite_hash: ${compositeHash}`);

    const imageData = queryActiveImageRecord(compositeHash);
    if (!imageData) {
      logger.debug('[TagRoute] Media not found in database');
      return res.status(404).json({ success: false, error: 'Image or video not found' });
    }

    logger.debug(`[TagRoute] Image data retrieved, file_path: ${imageData.original_file_path}`);

    if (!imageData.original_file_path) {
      return res.status(404).json({ success: false, error: 'No active file found for this image' });
    }

    const imagePath = resolveUploadsPath(imageData.original_file_path);

    logger.debug(`[TagRoute] original_file_path from DB: ${imageData.original_file_path}`);
    logger.debug(`[TagRoute] Calculated imagePath: ${imagePath}`);
    logger.debug(`[TagRoute] File exists? ${fs.existsSync(imagePath)}`);

    if (!fs.existsSync(imagePath)) {
      logger.debug('[TagRoute] Image file not found on disk');
      return res.status(404).json({ success: false, error: 'Image file not found on disk' });
    }

    logger.debug(`[ImageTag] Tagging file ${compositeHash}: ${imagePath}`);

    const result = await tagAndPersistTarget(
      {
        compositeHash,
        imagePath,
        mimeType: imageData.file_mime_type || imageData.mime_type,
        existingAutoTags: imageData.auto_tags || null,
      },
      '[ImageTag]',
      { verboseResult: true, logRatingScore: true, includeErrorType: true },
    );

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error,
        details: { error_type: result.error_type },
      });
    }

    logger.info(`[ImageTag] Successfully tagged ${compositeHash}`);
    QueryCacheService.invalidateImageCache(compositeHash, false);

    res.json({
      success: true,
      data: {
        composite_hash: result.composite_hash,
        auto_tags: result.auto_tags,
      },
    });
    return;
  } catch (error) {
    logger.error('[ImageTag] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to tag image'
    });
    return;
  }
}));

router.post('/batch-tag', requireImageAction('images.edit'), asyncHandler(async (req: Request, res: Response) => {
  const { image_ids } = req.body;

  if (!validateBatchImageIds(res, image_ids)) {
    return;
  }

  try {
    let successCount = 0;
    let failCount = 0;

    logger.debug(`[BatchTag] Starting batch tagging for ${image_ids.length} images`);
    const results: TaggingResultPayload[] = [];

    for (const compositeHash of image_ids) {
      try {
        const result = await processHashTaggingItem(compositeHash, '[BatchTag]');
        results.push(result);

        if (result.success) {
          successCount++;
          logger.debug(`[BatchTag] Tagged image ${compositeHash} (${successCount}/${image_ids.length})`);
        } else {
          failCount++;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push({ composite_hash: compositeHash, success: false, error: message });
        failCount++;
      }
    }

    logger.info(`[BatchTag] Completed: ${successCount} success, ${failCount} failed`);
    QueryCacheService.invalidateImageCache(undefined, true);

    res.json({
      success: true,
      data: {
        total: image_ids.length,
        success_count: successCount,
        fail_count: failCount,
        results,
      },
    });
    return;
  } catch (error) {
    logger.error('[BatchTag] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to batch tag images'
    });
    return;
  }
}));

router.post('/batch-tag-unprocessed', requireImageAction('images.edit'), asyncHandler(async (req: Request, res: Response) => {
  const { limit } = req.body;
  const maxLimit = parseBatchLimit(limit);

  try {
    const untaggedImages = await ImageTaggingModel.findUntagged(maxLimit);

    if (untaggedImages.length === 0) {
      res.json({
        success: true,
        data: {
          total: 0,
          success_count: 0,
          fail_count: 0,
          message: 'No untagged images found',
          results: [],
        },
      });
      return;
    }

    logger.debug(`[BatchTagUnprocessed] Processing ${untaggedImages.length} untagged images`);
    const results: TaggingResultPayload[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const image of untaggedImages) {
      try {
        const result = await processRecordTaggingItem(image, '[BatchTagUnprocessed]');
        results.push(result);

        if (result.success) {
          successCount++;
          logger.debug(`[BatchTagUnprocessed] Tagged file ${result.composite_hash} (${successCount}/${untaggedImages.length})`);
        } else {
          failCount++;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        const compositeHash = image.composite_hash || image.id || '';
        results.push({ composite_hash: compositeHash, success: false, error: message });
        failCount++;
      }
    }

    logger.info(`[BatchTagUnprocessed] Completed: ${successCount} success, ${failCount} failed`);
    QueryCacheService.invalidateImageCache(undefined, true);

    res.json({
      success: true,
      data: {
        total: untaggedImages.length,
        success_count: successCount,
        fail_count: failCount,
        results,
      },
    });
    return;
  } catch (error) {
    logger.error('[BatchTagUnprocessed] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to batch tag unprocessed images'
    });
    return;
  }
}));

/**
 * POST /api/images/batch-tag-all — 202 + `auto-tag-batch-all` job.
 * Same item selection as before: the newest `limit` rows (100 when omitted), every row when `limit` is not a number.
 * The per-item results list is gone from the response; failures are in the job's errors and counts in its result.
 */
router.post('/batch-tag-all', requireImageAction('images.edit'), asyncHandler(async (req: Request, res: Response) => {
  const maxLimit = parseBatchLimit(req.body?.limit);
  logger.debug(`[BatchTagAll] Starting job (limit=${maxLimit || 'all'})`);
  return respondWithStartedJob(req, res, 'auto-tag-batch-all', { limit: maxLimit || null }, 'Auto-tag maintenance is already running');
}));

/** POST /api/images/reset-auto-tags — 202 + `auto-tag-reset` job (paged, one page per transaction). */
router.post('/reset-auto-tags', requireImageAction('images.edit'), asyncHandler(async (req: Request, res: Response) => {
  logger.info('[ResetAutoTags] Resetting all auto_tags to NULL');
  return respondWithStartedJob(req, res, 'auto-tag-reset', {}, 'Auto-tag maintenance is already running');
}));

/** POST /api/images/recalculate-rating-scores — 202 + `rating-score-recalculate` job. */
router.post('/recalculate-rating-scores', requireImageAction('images.edit'), asyncHandler(async (req: Request, res: Response) => {
  logger.info('[RecalculateRatingScores] Starting rating score recalculation for all images');
  return respondWithStartedJob(req, res, 'rating-score-recalculate', {}, 'Auto-tag maintenance is already running');
}));

export { router as taggingMutationRoutes };
