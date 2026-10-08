import fs from 'fs';
import { db } from '../database/init';
import { resolveUploadsPath } from '../config/runtimePaths';
import { MediaMetadataModel } from '../models/Image/MediaMetadataModel';
import { imageTaggerService, ImageTaggerService } from './imageTaggerService';
import { TaggerResult } from './taggerDaemon';
import { AutoTagsComposeService } from './autoTagsComposeService';
import { kaloscopeTaggerService } from './kaloscopeTaggerService';
import { RatingScoreService } from './ratingScoreService';
import { settingsService } from './settingsService';
import { RatingData } from '../types/autoTag';
import { logger } from '../utils/logger';

/**
 * Tag one library item and persist the result. Shared by the tagging routes and the batch tagging job (moved out of
 * routes/images/tagging.mutation.routes.ts and tagging.shared.ts unchanged).
 */

export interface ImageTagRecord {
  composite_hash?: string;
  id?: string;
  original_file_path?: string;
  file_path?: string;
  file_mime_type?: string;
  mime_type?: string;
  auto_tags?: string | null;
}

export interface TaggingTarget {
  compositeHash: string;
  imagePath: string;
  mimeType?: string;
  existingAutoTags: string | null;
}

export interface FailedTaggingResult {
  composite_hash: string;
  success: false;
  error: string;
  error_type?: string;
}

export interface SuccessfulTaggingResult {
  composite_hash: string;
  success: true;
  auto_tags: unknown;
}

export type TaggingResultPayload = FailedTaggingResult | SuccessfulTaggingResult;

export function extractRatingData(raw: unknown): RatingData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const rating = raw as Record<string, unknown>;
  const general = rating.general;
  const sensitive = rating.sensitive;
  const questionable = rating.questionable;
  const explicit = rating.explicit;

  if (
    typeof general !== 'number' ||
    typeof sensitive !== 'number' ||
    typeof questionable !== 'number' ||
    typeof explicit !== 'number'
  ) {
    return null;
  }

  return { general, sensitive, questionable, explicit };
}

export async function buildMergedAutoTags(
  existingAutoTags: string | null,
  taggerResult: TaggerResult,
  imagePath: string,
  mimeType?: string
): Promise<string> {
  let autoTagsJson = AutoTagsComposeService.mergeTagger(existingAutoTags, taggerResult);
  const settings = settingsService.loadSettings();

  if (settings.kaloscope.enabled && !ImageTaggerService.isVideoFile(imagePath, mimeType)) {
    const kaloscopeResult = await kaloscopeTaggerService.tagImage(imagePath);
    if (kaloscopeResult.success) {
      autoTagsJson = AutoTagsComposeService.mergeKaloscope(autoTagsJson, kaloscopeResult);
    } else {
      logger.warn('[Kaloscope] Tagging skipped or failed:', kaloscopeResult.error || kaloscopeResult.error_type || 'unknown');
    }
  }

  return autoTagsJson;
}

export function createFailedTaggingResult(compositeHash: string, error: string, errorType?: string): FailedTaggingResult {
  return errorType
    ? { composite_hash: compositeHash, success: false, error, error_type: errorType }
    : { composite_hash: compositeHash, success: false, error };
}

export function queryActiveImageRecord(compositeHash: string): ImageTagRecord | null {
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

export async function tagAndPersistTarget(
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

export async function processHashTaggingItem(
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

export async function processRecordTaggingItem(
  image: ImageTagRecord,
  logPrefix: string,
): Promise<TaggingResultPayload> {
  const resolved = resolveRecordTaggingTarget(image, 'No file path available', 'Image file not found');

  if ('failure' in resolved) {
    return resolved.failure;
  }

  return await tagAndPersistTarget(resolved.target, logPrefix);
}
