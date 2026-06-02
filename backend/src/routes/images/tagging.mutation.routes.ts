import { Router, Request, Response } from 'express';
import { routeParam } from '../routeParam';
import fs from 'fs';
import { asyncHandler } from '../../middleware/errorHandler';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { ImageStatsModel } from '../../models/Image/ImageStatsModel';
import { ImageTaggingModel } from '../../models/Image/ImageTaggingModel';
import { db } from '../../database/init';
import { imageTaggerService, ImageTaggerService } from '../../services/imageTaggerService';
import { TaggerResult } from '../../services/taggerDaemon';
import { resolveUploadsPath } from '../../config/runtimePaths';
import { RatingScoreService } from '../../services/ratingScoreService';
import { AutoTagIndexService } from '../../services/autoTagIndexService';
import { logger } from '../../utils/logger';
import { QueryCacheService } from '../../services/QueryCacheService';
import { buildMergedAutoTags, extractRatingData } from './tagging.shared';
import { sendRouteBadRequest } from '../routeValidation';

const router = Router();

interface ImageTagRecord {
  composite_hash?: string;
  id?: string;
  original_file_path?: string;
  file_path?: string;
  file_mime_type?: string;
  mime_type?: string;
  auto_tags?: string | null;
}

interface TaggingTarget {
  compositeHash: string;
  imagePath: string;
  mimeType?: string;
  existingAutoTags: string | null;
}

interface FailedTaggingResult {
  composite_hash: string;
  success: false;
  error: string;
  error_type?: string;
}

interface SuccessfulTaggingResult {
  composite_hash: string;
  success: true;
  auto_tags: unknown;
}

type TaggingResultPayload = FailedTaggingResult | SuccessfulTaggingResult;

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

function createFailedTaggingResult(compositeHash: string, error: string, errorType?: string): FailedTaggingResult {
  return errorType
    ? { composite_hash: compositeHash, success: false, error, error_type: errorType }
    : { composite_hash: compositeHash, success: false, error };
}

function queryActiveImageRecord(compositeHash: string): ImageTagRecord | null {
  return db.prepare(`
    SELECT
      mm.*,
      if.original_file_path,
      if.mime_type as file_mime_type
    FROM media_metadata mm
    LEFT JOIN image_files if ON mm.composite_hash = if.composite_hash AND if.file_status = 'active'
    WHERE mm.composite_hash = ?
    LIMIT 1
  `).get(compositeHash) as ImageTagRecord | null;
}

function buildTargetFromRecord(
  record: ImageTagRecord,
  compositeHash: string,
  filePath: string,
  missingFileError: string,
): { target: TaggingTarget } | { failure: FailedTaggingResult } {
  const imagePath = resolveUploadsPath(filePath);

  if (!fs.existsSync(imagePath)) {
    return { failure: createFailedTaggingResult(compositeHash, missingFileError) };
  }

  return {
    target: {
      compositeHash,
      imagePath,
      mimeType: record.file_mime_type || record.mime_type,
      existingAutoTags: record.auto_tags || null,
    },
  };
}

function resolveHashTaggingTarget(
  compositeHash: string,
  errors: {
    notFound: string;
    noActiveFile: string;
    missingFile: string;
  },
): { target: TaggingTarget } | { failure: FailedTaggingResult } {
  const imageData = queryActiveImageRecord(compositeHash);

  if (!imageData) {
    return { failure: createFailedTaggingResult(compositeHash, errors.notFound) };
  }

  if (!imageData.original_file_path) {
    return { failure: createFailedTaggingResult(compositeHash, errors.noActiveFile) };
  }

  return buildTargetFromRecord(imageData, compositeHash, imageData.original_file_path, errors.missingFile);
}

function resolveRecordTaggingTarget(
  image: ImageTagRecord,
  noFilePathError: string,
  missingFileError: string,
): { target: TaggingTarget } | { failure: FailedTaggingResult } {
  const compositeHash = image.composite_hash || image.id || '';
  const filePath = image.original_file_path || image.file_path;

  if (!filePath) {
    return { failure: createFailedTaggingResult(compositeHash, noFilePathError) };
  }

  return buildTargetFromRecord(image, compositeHash, filePath, missingFileError);
}

async function runTagger(target: TaggingTarget, logPrefix: string, verboseResult = false): Promise<TaggerResult> {
  const isVideo = ImageTaggerService.isVideoFile(target.imagePath, target.mimeType);
  if (verboseResult && isVideo) {
    logger.debug('[ImageTag] Detected video file, extracting frames...');
  }

  const taggerResult = isVideo
    ? await imageTaggerService.tagVideo(target.imagePath)
    : await imageTaggerService.tagImage(target.imagePath);

  if (verboseResult) {
    logger.debug(`${logPrefix} Tagger result details logged to file`);
    logger.verbose(`${logPrefix} Tagger result:`, {
      success: taggerResult.success,
      hasCaption: !!taggerResult.caption,
      hasGeneral: !!taggerResult.general,
      captionLength: taggerResult.caption?.length || 0,
    });
  }

  return taggerResult;
}

async function calculateRatingScore(taggerResult: TaggerResult, logPrefix: string, logSuccess = false): Promise<number | null> {
  const ratingData = extractRatingData(taggerResult.rating);
  if (!ratingData) {
    return null;
  }

  try {
    const scoreResult = await RatingScoreService.calculateScore(ratingData);
    if (logSuccess) {
      logger.debug(`${logPrefix} Calculated rating_score: ${scoreResult.score}`);
    }
    return scoreResult.score;
  } catch (error) {
    logger.error(`${logPrefix} Failed to calculate rating_score:`, error);
    return null;
  }
}

async function tagAndPersistTarget(
  target: TaggingTarget,
  logPrefix: string,
  options: { verboseResult?: boolean; logRatingScore?: boolean; includeErrorType?: boolean } = {},
): Promise<TaggingResultPayload> {
  const taggerResult = await runTagger(target, logPrefix, options.verboseResult);

  if (!taggerResult.success) {
    return createFailedTaggingResult(
      target.compositeHash,
      taggerResult.error || 'Tagging failed',
      options.includeErrorType ? taggerResult.error_type : undefined,
    );
  }

  const autoTagsJson = await buildMergedAutoTags(target.existingAutoTags, taggerResult, target.imagePath, target.mimeType);
  if (options.verboseResult) {
    logger.debug(`${logPrefix} Formatted JSON length: ${autoTagsJson?.length || 0}`);
    if (autoTagsJson) {
      logger.verbose(`${logPrefix} Formatted JSON preview: ${autoTagsJson.substring(0, 100)}`);
    }
  }

  const ratingScore = await calculateRatingScore(taggerResult, logPrefix, options.logRatingScore);
  MediaMetadataModel.update(target.compositeHash, {
    auto_tags: autoTagsJson,
    rating_score: ratingScore,
  });

  return {
    composite_hash: target.compositeHash,
    success: true,
    auto_tags: autoTagsJson ? JSON.parse(autoTagsJson) : null,
  };
}

async function processHashTaggingItem(
  compositeHash: string,
  logPrefix: string,
): Promise<TaggingResultPayload> {
  const resolved = resolveHashTaggingTarget(compositeHash, {
    notFound: 'Image not found',
    noActiveFile: 'No active file found',
    missingFile: 'Image file not found',
  });

  if ('failure' in resolved) {
    return resolved.failure;
  }

  return await tagAndPersistTarget(resolved.target, logPrefix);
}

async function processRecordTaggingItem(
  image: ImageTagRecord,
  logPrefix: string,
): Promise<TaggingResultPayload> {
  const resolved = resolveRecordTaggingTarget(image, 'No file path available', 'Image file not found');

  if ('failure' in resolved) {
    return resolved.failure;
  }

  return await tagAndPersistTarget(resolved.target, logPrefix);
}

router.post('/:id/tag', asyncHandler(async (req: Request, res: Response) => {
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

router.post('/batch-tag', asyncHandler(async (req: Request, res: Response) => {
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

router.post('/batch-tag-unprocessed', asyncHandler(async (req: Request, res: Response) => {
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

router.post('/batch-tag-all', asyncHandler(async (req: Request, res: Response) => {
  const { limit, force } = req.body;
  const maxLimit = parseBatchLimit(limit);
  const forceRetag = force !== undefined ? force : true;

  try {
    const query = maxLimit
      ? `SELECT composite_hash FROM media_metadata ORDER BY first_seen_date DESC LIMIT ?`
      : `SELECT composite_hash FROM media_metadata ORDER BY first_seen_date DESC`;

    const hashRows = maxLimit
      ? db.prepare(query).all(maxLimit) as any[]
      : db.prepare(query).all() as any[];

    const compositeHashes = hashRows.map(row => row.composite_hash);

    if (compositeHashes.length === 0) {
      res.json({
        success: true,
        data: {
          total: 0,
          success_count: 0,
          fail_count: 0,
          message: 'No images found',
          results: [],
        },
      });
      return;
    }

    logger.debug(`[BatchTagAll] Processing ${compositeHashes.length} images (force=${forceRetag})`);
    const results: TaggingResultPayload[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const compositeHash of compositeHashes) {
      try {
        const result = await processHashTaggingItem(compositeHash, '[BatchTagAll]');
        results.push(result);

        if (result.success) {
          successCount++;
          logger.debug(`[BatchTagAll] Tagged file ${compositeHash} (${successCount}/${compositeHashes.length})`);
        } else {
          failCount++;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push({ composite_hash: compositeHash, success: false, error: message });
        failCount++;
      }
    }

    logger.info(`[BatchTagAll] Completed: ${successCount} success, ${failCount} failed`);
    QueryCacheService.invalidateImageCache(undefined, true);

    res.json({
      success: true,
      data: {
        total: compositeHashes.length,
        success_count: successCount,
        fail_count: failCount,
        results,
      },
    });
    return;
  } catch (error) {
    logger.error('[BatchTagAll] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to batch tag all images'
    });
    return;
  }
}));

router.post('/reset-auto-tags', asyncHandler(async (req: Request, res: Response) => {
  try {
    logger.info('[ResetAutoTags] Resetting all auto_tags to NULL');

    const result = db.prepare(`
      UPDATE media_metadata
      SET auto_tags = NULL
    `).run();
    AutoTagIndexService.clearAll();
    ImageStatsModel.invalidateAutoTagStatsCache();

    logger.info(`[ResetAutoTags] Reset complete. Changes: ${result.changes}`);
    QueryCacheService.invalidateImageCache(undefined, true);

    res.json({
      success: true,
      data: {
        changes: result.changes,
        message: 'All auto tags have been reset. The scheduler will pick them up shortly.'
      }
    });
  } catch (error) {
    logger.error('[ResetAutoTags] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reset auto tags'
    });
  }
}));

router.post('/recalculate-rating-scores', asyncHandler(async (req: Request, res: Response) => {
  try {
    logger.info('[RecalculateRatingScores] Starting rating score recalculation for all images');

    const imagesWithTags = db.prepare(`
      SELECT composite_hash, auto_tags
      FROM media_metadata
      WHERE auto_tags IS NOT NULL
    `).all() as Array<{ composite_hash: string; auto_tags: string }>;

    console.log(`[RecalculateRatingScores] Found ${imagesWithTags.length} images with auto_tags`);

    let successCount = 0;
    let failCount = 0;
    const results = [];

    for (const image of imagesWithTags) {
      try {
        const autoTagsData = JSON.parse(image.auto_tags);
        const ratingData = extractRatingData(autoTagsData?.rating || autoTagsData?.tagger?.rating);

        if (ratingData) {
          const scoreResult = await RatingScoreService.calculateScore(ratingData);

          db.prepare(`
            UPDATE media_metadata
            SET rating_score = ?
            WHERE composite_hash = ?
          `).run(scoreResult.score, image.composite_hash);

          successCount++;
          results.push({
            composite_hash: image.composite_hash,
            success: true,
            rating_score: scoreResult.score
          });
        } else {
          db.prepare(`
            UPDATE media_metadata
            SET rating_score = NULL
            WHERE composite_hash = ?
          `).run(image.composite_hash);

          successCount++;
          results.push({
            composite_hash: image.composite_hash,
            success: true,
            rating_score: null,
            note: 'No rating data available'
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[RecalculateRatingScores] Failed for ${image.composite_hash}:`, message);
        failCount++;
        results.push({ composite_hash: image.composite_hash, success: false, error: message });
      }
    }

    logger.info(`[RecalculateRatingScores] Completed: ${successCount} updated, ${failCount} errors`);
    QueryCacheService.invalidateImageCache(undefined, true);

    res.json({
      success: true,
      data: {
        total: imagesWithTags.length,
        fail_count: failCount,
        results
      }
    });
    return;
  } catch (error) {
    console.error('[RecalculateRatingScores] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to recalculate rating scores'
    });
    return;
  }
}));

export { router as taggingMutationRoutes };
