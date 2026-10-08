import { db } from '../../database/init';
import { maybeTruncateImagesWal } from '../../database/walMaintenance';
import { ImageStatsModel } from '../../models/Image/ImageStatsModel';
import { RatingScoreModel } from '../../models/RatingScore';
import { AutoTagIndexService } from '../autoTagIndexService';
import { extractRatingData, processHashTaggingItem } from '../hashTaggingService';
import { QueryCacheService } from '../QueryCacheService';
import { RatingScoreService } from '../ratingScoreService';
import { logger } from '../../utils/logger';
import { LIBRARY_BATCH_SIZE, pageBoundary, placeholders, type LibraryBatchHooks } from './libraryBatch';

/**
 * Whole-library auto-tag maintenance, run as runtime jobs (`auto-tag-reset`, `rating-score-recalculate`,
 * `auto-tag-batch-all`). Each one used to run inside its HTTP request: one UPDATE over every row (reset), a full
 * load plus one autocommit per row (rating recalculation), or every hash in one loop. They now page by rowid, write
 * one page per transaction and yield between pages, so the server keeps answering and other writers never wait
 * behind them for more than one page.
 */

export interface AutoTagResetResult {
  changes: number;
  message: string;
}

export interface RatingScoreRecalculationResult {
  total: number;
  success_count: number;
  fail_count: number;
}

export interface BatchTagLibraryParams {
  /** Newest-first item cap; null tags every media row. */
  limit: number | null;
}

export interface BatchTagLibraryResult {
  total: number;
  success_count: number;
  fail_count: number;
}

function countTaggedMedia(): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM media_metadata WHERE auto_tags IS NOT NULL').get() as { c: number }).c;
}

function invalidateTagCaches(): void {
  ImageStatsModel.invalidateAutoTagStatsCache();
  QueryCacheService.invalidateImageCache(undefined, true);
}

/**
 * Clear every row's auto_tags (the auto-tag state triggers move them back to 'pending' for the scheduler) and empty
 * the tag search index.
 *
 * The index is emptied first in one truncating clear (see AutoTagIndexService.clearAll), far faster than deleting
 * millions of index rows page by page. A row the scheduler re-tags while the reset is still running then keeps its
 * fresh index rows.
 */
export async function resetAllAutoTags(hooks: LibraryBatchHooks = {}): Promise<AutoTagResetResult> {
  const total = countTaggedMedia();
  if (AutoTagIndexService.hasIndexTable()) {
    AutoTagIndexService.clearAll();
  }
  const nextPage = db.prepare(`
    SELECT rowid AS id FROM media_metadata
    WHERE rowid > ? AND auto_tags IS NOT NULL
    ORDER BY rowid
    LIMIT ${LIBRARY_BATCH_SIZE}
  `);

  let cursor = 0;
  let changes = 0;
  hooks.progress?.(0, total);
  for (;;) {
    hooks.throwIfCancelled?.();
    const ids = (nextPage.all(cursor) as Array<{ id: number }>).map((row) => row.id);
    if (ids.length === 0) {
      break;
    }
    cursor = ids[ids.length - 1];

    changes += db.prepare(`UPDATE media_metadata SET auto_tags = NULL WHERE rowid IN (${placeholders(ids.length)}) AND auto_tags IS NOT NULL`)
      .run(...ids).changes;

    hooks.progress?.(changes, total);
    maybeTruncateImagesWal('auto-tag-reset');
    await pageBoundary(hooks);
  }

  invalidateTagCaches();
  maybeTruncateImagesWal('auto-tag-reset');
  logger.info(`[ResetAutoTags] Reset complete. Changes: ${changes}`);
  return { changes, message: 'All auto tags have been reset. The scheduler will pick them up shortly.' };
}

/** Recompute rating_score from each row's stored tagger rating with the current weights. */
export async function recalculateAllRatingScores(hooks: LibraryBatchHooks = {}): Promise<RatingScoreRecalculationResult> {
  const weights = RatingScoreModel.getWeights();
  if (!weights) {
    throw new Error('Rating weights not found. Please run database migrations.');
  }

  const total = countTaggedMedia();
  const nextPage = db.prepare(`
    SELECT rowid AS id, composite_hash, auto_tags FROM media_metadata
    WHERE rowid > ? AND auto_tags IS NOT NULL
    ORDER BY rowid
    LIMIT ${LIBRARY_BATCH_SIZE}
  `);
  const updateScore = db.prepare('UPDATE media_metadata SET rating_score = ? WHERE rowid = ?');
  const writePage = db.transaction((updates: Array<[number | null, number]>) => {
    for (const [score, id] of updates) {
      updateScore.run(score, id);
    }
  });

  let cursor = 0;
  let processed = 0;
  let successCount = 0;
  let failCount = 0;
  hooks.progress?.(0, total);
  for (;;) {
    hooks.throwIfCancelled?.();
    const rows = nextPage.all(cursor) as Array<{ id: number; composite_hash: string; auto_tags: string }>;
    if (rows.length === 0) {
      break;
    }
    cursor = rows[rows.length - 1].id;

    const updates: Array<[number | null, number]> = [];
    for (const row of rows) {
      try {
        const autoTagsData = JSON.parse(row.auto_tags);
        const ratingData = extractRatingData(autoTagsData?.rating || autoTagsData?.tagger?.rating);
        updates.push([ratingData ? RatingScoreService.scoreWithWeights(ratingData, weights).score : null, row.id]);
        successCount += 1;
      } catch (error) {
        failCount += 1;
        hooks.recordError?.(row.composite_hash, error);
      }
    }
    writePage(updates);

    processed += rows.length;
    hooks.progress?.(processed, total);
    await pageBoundary(hooks);
  }

  QueryCacheService.invalidateImageCache(undefined, true);
  maybeTruncateImagesWal('rating-score-recalculate');
  logger.info(`[RecalculateRatingScores] Completed: ${successCount} updated, ${failCount} errors`);
  return { total: processed, success_count: successCount, fail_count: failCount };
}

/**
 * Re-run the tagger over the newest `limit` media rows (every row when null), newest first. Pages walk
 * `(first_seen_date DESC, composite_hash DESC)`, the order the request used to load in one go, then the rows without
 * a first_seen_date (they sorted last there too).
 */
export async function batchTagLibrary(params: BatchTagLibraryParams, hooks: LibraryBatchHooks = {}): Promise<BatchTagLibraryResult> {
  const limit = params.limit !== null && Number.isFinite(params.limit) && params.limit > 0 ? Math.floor(params.limit) : null;
  const available = (db.prepare('SELECT COUNT(*) AS c FROM media_metadata').get() as { c: number }).c;
  const total = limit === null ? available : Math.min(limit, available);

  const firstPage = db.prepare(`
    SELECT composite_hash, first_seen_date FROM media_metadata
    WHERE first_seen_date IS NOT NULL
    ORDER BY first_seen_date DESC, composite_hash DESC
    LIMIT ?
  `);
  const nextDatedPage = db.prepare(`
    SELECT composite_hash, first_seen_date FROM media_metadata
    WHERE first_seen_date < ? OR (first_seen_date = ? AND composite_hash < ?)
    ORDER BY first_seen_date DESC, composite_hash DESC
    LIMIT ?
  `);
  const undatedPage = db.prepare(`
    SELECT composite_hash, NULL AS first_seen_date FROM media_metadata
    WHERE first_seen_date IS NULL AND composite_hash < ?
    ORDER BY composite_hash DESC
    LIMIT ?
  `);

  let processed = 0;
  let successCount = 0;
  let failCount = 0;
  let dated = true;
  let cursor: { date: string; hash: string } | null = null;
  let undatedCursor = '￿';
  hooks.progress?.(0, total);

  while (processed < total) {
    hooks.throwIfCancelled?.();
    const pageSize = Math.min(LIBRARY_BATCH_SIZE, total - processed);
    let rows: Array<{ composite_hash: string; first_seen_date: string | null }>;
    if (dated) {
      rows = (cursor ? nextDatedPage.all(cursor.date, cursor.date, cursor.hash, pageSize) : firstPage.all(pageSize)) as typeof rows;
      if (rows.length === 0) {
        dated = false;
        continue;
      }
      const last = rows[rows.length - 1];
      cursor = { date: last.first_seen_date as string, hash: last.composite_hash };
    } else {
      rows = undatedPage.all(undatedCursor, pageSize) as typeof rows;
      if (rows.length === 0) {
        break;
      }
      undatedCursor = rows[rows.length - 1].composite_hash;
    }

    for (const row of rows) {
      try {
        const result = await processHashTaggingItem(row.composite_hash, '[BatchTagAll]');
        if (result.success) {
          successCount += 1;
        } else {
          failCount += 1;
          hooks.recordError?.(row.composite_hash, result.error);
        }
      } catch (error) {
        failCount += 1;
        hooks.recordError?.(row.composite_hash, error);
      }
    }

    processed += rows.length;
    hooks.progress?.(processed, total);
    await pageBoundary(hooks);
  }

  QueryCacheService.invalidateImageCache(undefined, true);
  logger.info(`[BatchTagAll] Completed: ${successCount} success, ${failCount} failed`);
  return { total: processed, success_count: successCount, fail_count: failCount };
}
