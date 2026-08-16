import path from 'path';
import { db } from '../database/init';
import { taggerDaemon } from './taggerDaemon';
import { settingsService } from './settingsService';
import { imageTaggerService } from './imageTaggerService';
import { SystemSettingsService } from './systemSettingsService';
import { RatingScoreService } from './ratingScoreService';
import { PromptCollectionService } from './promptCollectionService';
import { AutoTagsComposeService } from './autoTagsComposeService';
import { AutoTagIndexService } from './autoTagIndexService';
import { AutoTagStateService } from './autoTagStateService';
import { AutoCollectionService } from './autoCollectionService';
import { kaloscopeTaggerService } from './kaloscopeTaggerService';
import { SystemMaintenanceLockService } from './systemMaintenanceLockService';
import { MediaPostprocessVisibilityService } from './mediaPostprocessVisibilityService';
import { QueryCacheService } from './QueryCacheService';
import { ImageStatsModel } from '../models/Image/ImageStatsModel';
import { RatingData } from '../types/autoTag';

interface PendingAutoTagMedia {
  composite_hash: string;
  auto_tags: string | null;
  original_file_path: string;
  media_type: string;
}

interface AutoTagCapabilities {
  taggerAutoEnabled: boolean;
  kaloscopeAutoEnabled: boolean;
}

/**
 * "this metadata row still has a taggable file" — as a correlated subquery, never a join.
 *
 * The pending lookups used to express this as an outer join against `image_files` plus
 * `WHERE if_.original_file_path IS NOT NULL AND if_.file_status = 'active'`. That is an
 * inner join in disguise, so SQLite may reorder the two tables, and on a real library it
 * does: with ~200k active `image_files`, the migration-000 partial index `idx_files_status`
 * and no `sqlite_stat1`, the planner drives from `image_files` and probes
 * `idx_media_metadata_auto_tag_pending` once per active file — an 18ms idle poll instead of
 * the sub-millisecond index SEARCH migration 028 was built for. `ANALYZE` flips it back, but
 * nothing in this project ever runs `ANALYZE`, and the statistics can disappear again.
 *
 * A correlated `EXISTS` cannot be reordered: `media_metadata` is structurally the driving
 * table, so the partial pending index is always the outer SEARCH regardless of planner
 * statistics. Same fix HOME applied to the gallery count in `MediaMetadataFileQueries`.
 *
 * The predicate itself is term for term the eligibility filter migration 028 and
 * `AutoTagStateService` use to maintain `auto_tag_state`, so the stored state stays a superset of what this
 * selects and the chosen rows are the set the join produced (one row per metadata row now;
 * see `taggableFileColumn` below).
 */
const TAGGABLE_FILE_MATCH = `taggable.composite_hash = mm.composite_hash
        AND taggable.original_file_path IS NOT NULL
        AND taggable.file_status = 'active'`;

const TAGGABLE_FILE_EXISTS = `EXISTS (
        SELECT 1 FROM image_files taggable
        WHERE ${TAGGABLE_FILE_MATCH}
      )`;

/**
 * Pull one file column for the row the `EXISTS` guard just proved present.
 *
 * Identical predicate, so it can never return NULL for a row that passed the guard. The
 * join form emitted one output row per matching file, which made a media row with two
 * active files consume two batch slots and get tagged twice from the same snapshot; the
 * correlated form returns exactly one row per pending `media_metadata` row, which is what
 * `tagSingleMedia` (keyed by composite_hash) actually processes.
 */
function taggableFileColumn(column: 'original_file_path' | 'file_type'): string {
  return `(
        SELECT taggable.${column} FROM image_files taggable
        WHERE ${TAGGABLE_FILE_MATCH}
        LIMIT 1
      )`;
}

/**
 * 자동 태깅 스케줄러
 * - media_metadata 테이블에서 auto_tags가 NULL이거나 일부 결과가 비어있는 항목 검색
 * - 발견된 이미지들을 순차적으로 태깅 처리
 * - 주기적으로 반복 실행
 */
class AutoTagScheduler {
  private isRunning = false;
  private isProcessing = false;
  private rerunRequested = false;
  private lockRetryScheduled = false;
  private pollingTimer: NodeJS.Timeout | null = null;
  private readonly PROCESSING_DELAY_MS = 1000;
  private readonly LOCK_RETRY_DELAY_MS = 5000;

  private getPollingIntervalMs(): number {
    return SystemSettingsService.getAutoTagPollingInterval() * 1000;
  }

  private getBatchSize(): number {
    return SystemSettingsService.getAutoTagBatchSize();
  }

  private getCapabilities(): AutoTagCapabilities {
    const settings = settingsService.loadSettings();
    return {
      taggerAutoEnabled: settings.tagger.enabled && settings.tagger.autoTagOnUpload,
      kaloscopeAutoEnabled: settings.kaloscope.enabled && settings.kaloscope.autoTagOnUpload,
    };
  }

  private hasEnabledProcessor(capabilities: AutoTagCapabilities): boolean {
    return capabilities.taggerAutoEnabled || capabilities.kaloscopeAutoEnabled;
  }

  private releaseRowsWithoutRequiredWork(): void {
    const releasedCount = MediaPostprocessVisibilityService.markReadyRowsWithoutPendingImmediateWork();
    if (releasedCount > 0) {
      QueryCacheService.scheduleGalleryCacheInvalidation();
      console.log(`[AutoTagScheduler] Released ${releasedCount} media item(s) with no remaining auto post-processing requirement`);
    }
  }

  start(): boolean {
    if (this.isRunning) {
      return true;
    }

    this.releaseRowsWithoutRequiredWork();

    const capabilities = this.getCapabilities();
    AutoTagStateService.syncCapabilityState(capabilities);

    if (!this.hasEnabledProcessor(capabilities)) {
      return false;
    }

    const pollingIntervalMs = this.getPollingIntervalMs();
    const batchSize = this.getBatchSize();

    console.log(`[AutoTagScheduler] Ready (${pollingIntervalMs / 1000}s interval, batch ${batchSize})`);

    this.isRunning = true;
    void this.processPendingMedia();

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
    }

    this.pollingTimer = setInterval(() => {
      void this.processPendingMedia();
    }, pollingIntervalMs);

    return true;
  }

  stop(): void {
    this.isRunning = false;

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private extractRatingData(raw: unknown): RatingData | null {
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

  /**
   * `auto_tag_state = 'pending'` (migration 028) narrows the scan to the partial
   * index; the original json_extract chain stays as the residual filter so the
   * selected rows keep their exact tagger/kaloscope meaning even if a state row is
   * momentarily stale (the state is always a superset of the condition).
   */
  private getPendingMedia(capabilities: AutoTagCapabilities, batchSize: number): PendingAutoTagMedia[] {
    AutoTagStateService.syncCapabilityState(capabilities);

    return db.prepare(`
      SELECT
        mm.composite_hash,
        mm.auto_tags,
        ${taggableFileColumn('original_file_path')} as original_file_path,
        ${taggableFileColumn('file_type')} as media_type
      FROM media_metadata mm
      WHERE ${AutoTagStateService.buildPendingStatePrefix('mm')}(
        mm.auto_tags IS NULL
        OR (? = 1 AND json_extract(mm.auto_tags, '$.tagger') IS NULL)
        OR (? = 1 AND json_extract(mm.auto_tags, '$.kaloscope') IS NULL)
      )
        AND ${TAGGABLE_FILE_EXISTS}
      LIMIT ?
    `).all(capabilities.taggerAutoEnabled ? 1 : 0, capabilities.kaloscopeAutoEnabled ? 1 : 0, batchSize) as PendingAutoTagMedia[];
  }

  /**
   * Single-row lookup for media this backend just saved (no pending re-scan).
   *
   * This one keeps a join, on the same `TAGGABLE_FILE_MATCH` predicate: `composite_hash`
   * is bound to a constant on both sides, so every join order SQLite can choose is an
   * index seek and there is no plan to protect against. One probe instead of the three a
   * correlated form needs keeps this per-generation path at its measured cost.
   */
  private findPendingMediaByHash(compositeHash: string, capabilities: AutoTagCapabilities): PendingAutoTagMedia | undefined {
    return db.prepare(`
      SELECT
        mm.composite_hash,
        mm.auto_tags,
        taggable.original_file_path,
        taggable.file_type as media_type
      FROM media_metadata mm
      JOIN image_files taggable ON ${TAGGABLE_FILE_MATCH}
      WHERE mm.composite_hash = ?
        AND (
          mm.auto_tags IS NULL
          OR (? = 1 AND json_extract(mm.auto_tags, '$.tagger') IS NULL)
          OR (? = 1 AND json_extract(mm.auto_tags, '$.kaloscope') IS NULL)
        )
      LIMIT 1
    `).get(
      compositeHash,
      capabilities.taggerAutoEnabled ? 1 : 0,
      capabilities.kaloscopeAutoEnabled ? 1 : 0,
    ) as PendingAutoTagMedia | undefined;
  }

  /**
   * Untagged media count for the status surface. Counts pending `media_metadata` rows,
   * i.e. the same rows `getPendingMedia()` hands to the tagger — the join form counted
   * one row per active file, so a media row with two files was counted twice.
   */
  private countPendingMedia(capabilities: AutoTagCapabilities): number {
    AutoTagStateService.syncCapabilityState(capabilities);

    const result = db.prepare(`
      SELECT COUNT(*) as count
      FROM media_metadata mm
      WHERE ${AutoTagStateService.buildPendingStatePrefix('mm')}(
        mm.auto_tags IS NULL
        OR (? = 1 AND json_extract(mm.auto_tags, '$.tagger') IS NULL)
        OR (? = 1 AND json_extract(mm.auto_tags, '$.kaloscope') IS NULL)
      )
        AND ${TAGGABLE_FILE_EXISTS}
    `).get(capabilities.taggerAutoEnabled ? 1 : 0, capabilities.kaloscopeAutoEnabled ? 1 : 0) as { count: number };

    return result.count;
  }

  private async processPendingMedia(): Promise<void> {
    if (SystemMaintenanceLockService.isExclusiveActive()) {
      this.scheduleProcessPendingAfterMaintenanceLock();
      return;
    }

    if (this.isProcessing) {
      this.rerunRequested = true;
      return;
    }

    const capabilities = this.getCapabilities();
    if (!this.hasEnabledProcessor(capabilities)) {
      return;
    }

    this.isProcessing = true;

    try {
      const pendingMedia = this.getPendingMedia(capabilities, this.getBatchSize());
      if (pendingMedia.length === 0) {
        // Rows whose media file vanished would otherwise stay in the pending index
        // and get re-scanned on every poll.
        AutoTagStateService.pruneIneligiblePending();
        return;
      }

      for (let index = 0; index < pendingMedia.length; index += 1) {
        if (!this.isRunning) {
          break;
        }

        if (SystemMaintenanceLockService.isExclusiveActive()) {
          this.scheduleProcessPendingAfterMaintenanceLock();
          break;
        }

        const media = pendingMedia[index];

        try {
          await this.tagSingleMedia(media, capabilities);

          if (index < pendingMedia.length - 1) {
            await this.delay(this.PROCESSING_DELAY_MS);
          }
        } catch (error) {
          console.error(
            `[AutoTagScheduler] Failed to tag media: ${path.basename(media.original_file_path)}`,
            error instanceof Error ? error.message : error,
          );
        }
      }

      console.log(`[AutoTagScheduler] Batch processing completed (${pendingMedia.length} items)`);
    } catch (error) {
      console.error('[AutoTagScheduler] Error in processPendingMedia:', error);
    } finally {
      this.isProcessing = false;

      if (this.rerunRequested) {
        this.rerunRequested = false;
        setTimeout(() => {
          void this.processPendingMedia();
        }, this.PROCESSING_DELAY_MS);
      }
    }
  }

  private async tagSingleMedia(media: PendingAutoTagMedia, capabilities: AutoTagCapabilities): Promise<void> {
    const { composite_hash: compositeHash, original_file_path: filePath, media_type: mediaType, auto_tags: existingAutoTags } = media;
    const isVideo = mediaType === 'video';

    console.log(`[AutoTagScheduler] Tagging (${mediaType}): ${path.basename(filePath)}`);

    const needsTagger = capabilities.taggerAutoEnabled && !AutoTagsComposeService.hasTagger(existingAutoTags);
    const needsKaloscope = capabilities.kaloscopeAutoEnabled && !AutoTagsComposeService.hasKaloscope(existingAutoTags);

    if (!needsTagger && !needsKaloscope) {
      return;
    }

    let autoTags = existingAutoTags;
    let taggerTaglist = '';
    let ratingData: RatingData | null = null;

    if (needsTagger) {
      const taggerResult = isVideo
        ? await imageTaggerService.tagVideo(filePath)
        : await taggerDaemon.tagImage(filePath);

      if (taggerResult.success) {
        autoTags = AutoTagsComposeService.mergeTagger(autoTags, taggerResult);
        taggerTaglist = taggerResult.taglist || '';
        ratingData = this.extractRatingData(taggerResult.rating);
      } else {
        const errorMessage = taggerResult.error || 'Unknown tagging error';
        console.warn('[AutoTagScheduler] Tagger failed:', errorMessage);
        autoTags = AutoTagsComposeService.mergeTaggerFailure(autoTags, errorMessage);
      }
    }

    if (needsKaloscope) {
      const kaloscopeResult = isVideo
        ? await kaloscopeTaggerService.tagVideo(filePath)
        : await kaloscopeTaggerService.tagImage(filePath);

      if (kaloscopeResult.success) {
        autoTags = AutoTagsComposeService.mergeKaloscope(autoTags, kaloscopeResult);
      } else {
        console.warn('[AutoTagScheduler] Kaloscope tagging failed:', kaloscopeResult.error || kaloscopeResult.error_type || 'unknown');
        autoTags = AutoTagsComposeService.mergeKaloscopeFailure(autoTags, kaloscopeResult.error, kaloscopeResult.error_type);
      }
    }

    if (!autoTags) {
      return;
    }

    const ratingScore = await this.calculateRatingScore(ratingData);
    await this.persistAutoTags(compositeHash, autoTags, ratingScore);
    await this.collectAutoPrompts(taggerTaglist);
  }

  private async calculateRatingScore(ratingData: RatingData | null): Promise<number | null> {
    if (!ratingData) {
      return null;
    }

    try {
      const scoreResult = await RatingScoreService.calculateScore(ratingData);
      return scoreResult.score;
    } catch (error) {
      console.error('[AutoTagScheduler] Failed to calculate rating_score:', error);
      return null;
    }
  }

  private async persistAutoTags(compositeHash: string, autoTags: string, ratingScore: number | null): Promise<void> {
    db.prepare(`
      UPDATE media_metadata
      SET auto_tags = ?, rating_score = ?, metadata_updated_date = CURRENT_TIMESTAMP
      WHERE composite_hash = ?
    `).run(autoTags, ratingScore, compositeHash);
    AutoTagIndexService.syncForHash(compositeHash, autoTags);
    // Tagging finished for this row: settle (or re-arm) its pending state.
    AutoTagStateService.refreshForHash(compositeHash);
    ImageStatsModel.invalidateAutoTagStatsCache();

    try {
      const autoCollectResults = await AutoCollectionService.runAutoCollectionForNewImage(compositeHash);
      if (autoCollectResults.length > 0) {
        QueryCacheService.scheduleGalleryCacheInvalidation();
        console.log(`[AutoTagScheduler] Auto-assigned ${compositeHash.substring(0, 12)} to ${autoCollectResults.length} group(s) after auto-tag extraction`);
      }
    } catch (error) {
      console.warn(
        `[AutoTagScheduler] Auto-collection failed after auto-tag extraction for ${compositeHash.substring(0, 12)}:`,
        error instanceof Error ? error.message : error,
      );
    }

    const releasedForVisibility = MediaPostprocessVisibilityService.markReadyIfNoPendingImmediateWork(compositeHash);
    if (releasedForVisibility) {
      QueryCacheService.scheduleGalleryCacheInvalidation();
    }
  }

  private async collectAutoPrompts(taggerTaglist: string): Promise<void> {
    if (!taggerTaglist) {
      return;
    }

    try {
      const tags = taggerTaglist
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

      if (tags.length === 0) {
        return;
      }

      await PromptCollectionService.batchAddOrIncrementAuto(tags.map((tag) => ({ prompt: tag })));
    } catch (error) {
      console.error('[AutoTagScheduler] Failed to collect auto prompts:', error);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Retry postprocess tagging promptly after an exclusive maintenance lock can clear. */
  private scheduleProcessPendingAfterMaintenanceLock(): void {
    if (this.lockRetryScheduled) {
      return;
    }

    this.lockRetryScheduled = true;
    setTimeout(() => {
      this.lockRetryScheduled = false;
      void this.processPendingMedia();
    }, this.LOCK_RETRY_DELAY_MS);
  }

  getStatus(): {
    isRunning: boolean;
    pollingIntervalSeconds: number;
    batchSize: number;
    untaggedCount: number;
  } {
    let untaggedCount = 0;

    try {
      untaggedCount = this.countPendingMedia(this.getCapabilities());
    } catch (error) {
      console.error('[AutoTagScheduler] Failed to get untagged count:', error);
    }

    return {
      isRunning: this.isRunning,
      pollingIntervalSeconds: this.getPollingIntervalMs() / 1000,
      batchSize: this.getBatchSize(),
      untaggedCount,
    };
  }

  restart(): void {
    if (this.isRunning) {
      this.stop();
    }

    setTimeout(() => this.start(), 100);
  }

  /**
   * @param compositeHash When the caller already knows which media was just saved,
   * the row is tagged directly instead of re-scanning for pending work (ATAG-3).
   */
  async triggerManualProcessing(compositeHash?: string): Promise<void> {
    if (compositeHash) {
      await this.processSavedMedia(compositeHash);
      return;
    }

    console.log('[AutoTagScheduler] Manual processing triggered');
    await this.processPendingMedia();
  }

  /** Tag one freshly saved media row without touching the pending scan path. */
  private async processSavedMedia(compositeHash: string): Promise<void> {
    if (SystemMaintenanceLockService.isExclusiveActive()) {
      this.scheduleProcessPendingAfterMaintenanceLock();
      return;
    }

    const capabilities = this.getCapabilities();
    if (!this.hasEnabledProcessor(capabilities)) {
      return;
    }

    AutoTagStateService.syncCapabilityState(capabilities);
    // New media registration point: make sure the row is indexed as pending before
    // any batch poll can observe it.
    AutoTagStateService.refreshForHash(compositeHash);

    if (this.isProcessing) {
      this.rerunRequested = true;
      return;
    }

    const media = this.findPendingMediaByHash(compositeHash, capabilities);
    if (!media) {
      return;
    }

    this.isProcessing = true;

    try {
      console.log(`[AutoTagScheduler] Direct tagging requested for ${compositeHash.substring(0, 12)}`);
      await this.tagSingleMedia(media, capabilities);
    } catch (error) {
      console.error(
        `[AutoTagScheduler] Failed to tag saved media: ${path.basename(media.original_file_path)}`,
        error instanceof Error ? error.message : error,
      );
    } finally {
      this.isProcessing = false;

      if (this.rerunRequested) {
        this.rerunRequested = false;
        setTimeout(() => {
          void this.processPendingMedia();
        }, this.PROCESSING_DELAY_MS);
      }
    }
  }
}

export const autoTagScheduler = new AutoTagScheduler();
