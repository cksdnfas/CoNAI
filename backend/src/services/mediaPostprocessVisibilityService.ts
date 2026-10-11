import { db } from '../database/init';
import { AutoTagsComposeService } from './autoTagsComposeService';
import { settingsService } from './settingsService';

type PendingPostprocessRow = {
  composite_hash: string;
  auto_tags: string | null;
  metadata_extraction_status: string;
};

export type ImmediatePostprocessRequirements = {
  needsTagger: boolean;
  needsKaloscope: boolean;
  hasPendingWork: boolean;
  hasFailedWork: boolean;
};

// undefined = 아직 probe 안 함, false = probe 완료·컬럼 없음 (음성 결과도 캐시해
// 호출마다 PRAGMA table_info가 재실행되지 않도록 함)
let hasPostprocessStatusColumnCache: boolean | undefined;

function hasMediaMetadataColumn(columnName: string): boolean {
  try {
    const columns = db.prepare(`PRAGMA table_info(media_metadata)`).all() as Array<{ name: string }>;
    return columns.some((column) => column.name === columnName);
  } catch {
    return false;
  }
}

function hasPostprocessStatusColumn(): boolean {
  if (hasPostprocessStatusColumnCache === undefined) {
    hasPostprocessStatusColumnCache = hasMediaMetadataColumn('postprocess_status');
  }

  return hasPostprocessStatusColumnCache;
}

function assertSafeSqlAlias(alias: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error(`Unsafe SQL alias: ${alias}`);
  }
}

export class MediaPostprocessVisibilityService {
  private static scheduleGalleryCacheInvalidation(): void {
    try {
      const { QueryCacheService } = require('./QueryCacheService') as typeof import('./QueryCacheService');
      QueryCacheService.scheduleGalleryCacheInvalidation();
    } catch (error) {
      console.warn('⚠️ Postprocess visibility gallery invalidation failed:', error instanceof Error ? error.message : error);
    }
  }

  /** Notify authorized history lists and open details after background metadata changes. */
  static publishLinkedGenerationHistoryEvents(compositeHashes: string[]): void {
    try {
      const { HistoryCommandService } = require('./historyCommandService') as typeof import('./historyCommandService');
      HistoryCommandService.publishStatusEventsByCompositeHashes(compositeHashes);
    } catch (error) {
      console.warn('⚠️ Postprocess visibility history event publish failed:', error instanceof Error ? error.message : error);
    }
  }

  private static invalidateVisibilityCaches(compositeHash: string, options: { scheduleGallery?: boolean } = {}): void {
    try {
      const { QueryCacheService } = require('./QueryCacheService') as typeof import('./QueryCacheService');
      QueryCacheService.invalidateMetadataCache(compositeHash);
      QueryCacheService.invalidateThumbnailCache(compositeHash);
      if (options.scheduleGallery !== false) {
        QueryCacheService.scheduleGalleryCacheInvalidation();
      }
    } catch (error) {
      console.warn('⚠️ Postprocess visibility cache invalidation failed:', error instanceof Error ? error.message : error);
    }
  }

  static isReadyStatus(status: string | null | undefined): boolean {
    return status === undefined || status === null || status === 'ready';
  }

  static isReadyRecord(record: { postprocess_status?: string | null } | null | undefined): boolean {
    return !!record && this.isReadyStatus(record.postprocess_status);
  }

  static buildReadyCondition(alias: string): string {
    if (!hasPostprocessStatusColumn()) {
      return '1 = 1';
    }

    assertSafeSqlAlias(alias);
    return `COALESCE(${alias}.postprocess_status, 'ready') = 'ready'`;
  }

  static getImmediatePostprocessRequirements(autoTagsJson: string | null | undefined): ImmediatePostprocessRequirements {
    const settings = settingsService.loadSettings();
    const needsTagger = Boolean(
      settings.tagger.enabled &&
      settings.tagger.autoTagOnUpload &&
      !AutoTagsComposeService.hasTagger(autoTagsJson)
    );
    const needsKaloscope = Boolean(
      settings.kaloscope.enabled &&
      settings.kaloscope.autoTagOnUpload &&
      !AutoTagsComposeService.hasKaloscope(autoTagsJson)
    );
    const parsed = AutoTagsComposeService.parse(autoTagsJson);
    const hasFailedWork = (
      settings.tagger.enabled && settings.tagger.autoTagOnUpload &&
      (parsed.tagger as { status?: string } | undefined)?.status === 'failed'
    ) || (
      settings.kaloscope.enabled && settings.kaloscope.autoTagOnUpload &&
      (parsed.kaloscope as { status?: string } | undefined)?.status === 'failed'
    );

    return {
      needsTagger,
      needsKaloscope,
      hasPendingWork: needsTagger || needsKaloscope,
      hasFailedWork: Boolean(hasFailedWork),
    };
  }

  static markPending(compositeHash: string): void {
    if (!hasPostprocessStatusColumn()) {
      return;
    }

    db.prepare(`
      UPDATE media_metadata
      SET postprocess_status = 'pending',
          postprocess_completed_at = NULL,
          metadata_updated_date = CURRENT_TIMESTAMP
      WHERE composite_hash = ?
    `).run(compositeHash);
    this.invalidateVisibilityCaches(compositeHash);
  }

  static markReady(compositeHash: string): void {
    if (!hasPostprocessStatusColumn()) {
      return;
    }

    db.prepare(`
      UPDATE media_metadata
      SET postprocess_status = 'ready',
          postprocess_completed_at = CURRENT_TIMESTAMP,
          metadata_updated_date = CURRENT_TIMESTAMP
      WHERE composite_hash = ?
    `).run(compositeHash);
    this.invalidateVisibilityCaches(compositeHash);
    this.publishLinkedGenerationHistoryEvents([compositeHash]);
  }

  static markReadyIfNoPendingImmediateWork(compositeHash: string): boolean {
    if (!hasPostprocessStatusColumn()) {
      return true;
    }

    const row = db.prepare(`
      SELECT auto_tags, metadata_extraction_status
      FROM media_metadata
      WHERE composite_hash = ?
    `).get(compositeHash) as PendingPostprocessRow | undefined;

    if (!row) {
      return false;
    }

    const requirements = this.getImmediatePostprocessRequirements(row.auto_tags);
    if (requirements.hasFailedWork) {
      this.markFailed(compositeHash);
      return false;
    }
    if (row.metadata_extraction_status !== 'completed' || requirements.hasPendingWork) {
      return false;
    }

    this.markReady(compositeHash);
    return true;
  }

  static markReadyRowsWithoutPendingImmediateWork(): number {
    if (!hasPostprocessStatusColumn()) {
      return 0;
    }

    // Indexed pending/failed rows can be released when requirements finish or are disabled.
    const rows = db.prepare(`
      SELECT composite_hash, auto_tags, metadata_extraction_status
      FROM media_metadata
      WHERE postprocess_status IN ('pending', 'failed')
    `).all() as PendingPostprocessRow[];

    const releasedHashes: string[] = [];
    for (const row of rows) {
      const requirements = this.getImmediatePostprocessRequirements(row.auto_tags);
      if (requirements.hasFailedWork) {
        this.markFailed(row.composite_hash);
      } else if (row.metadata_extraction_status === 'completed' && !requirements.hasPendingWork) {
        releasedHashes.push(row.composite_hash);
      }
    }

    if (releasedHashes.length === 0) {
      return 0;
    }

    const markReady = db.prepare(`
      UPDATE media_metadata
      SET postprocess_status = 'ready',
          postprocess_completed_at = CURRENT_TIMESTAMP,
          metadata_updated_date = CURRENT_TIMESTAMP
      WHERE composite_hash = ?
    `);
    const markReadyBatch = db.transaction((hashes: string[]) => {
      for (const hash of hashes) {
        markReady.run(hash);
      }
    });

    markReadyBatch(releasedHashes);
    for (const hash of releasedHashes) {
      this.invalidateVisibilityCaches(hash, { scheduleGallery: false });
    }
    this.scheduleGalleryCacheInvalidation();
    this.publishLinkedGenerationHistoryEvents(releasedHashes);

    return releasedHashes.length;
  }

  private static markFailed(compositeHash: string): void {
    const result = db.prepare(`UPDATE media_metadata SET postprocess_status = 'failed', postprocess_completed_at = NULL,
      metadata_updated_date = CURRENT_TIMESTAMP WHERE composite_hash = ? AND postprocess_status <> 'failed'`).run(compositeHash);
    if (result.changes) {
      this.invalidateVisibilityCaches(compositeHash);
      this.publishLinkedGenerationHistoryEvents([compositeHash]);
    }
  }

  static finishMetadataExtraction(compositeHash: string, status: 'completed' | 'failed'): void {
    db.prepare(`UPDATE media_metadata SET metadata_extraction_status = ?,
      postprocess_status = CASE WHEN ? = 'failed' THEN 'failed'
        WHEN postprocess_status = 'failed' THEN 'pending' ELSE postprocess_status END,
      postprocess_completed_at = NULL,
      metadata_updated_date = CURRENT_TIMESTAMP
      WHERE composite_hash = ?`).run(status, status, compositeHash);
    this.invalidateVisibilityCaches(compositeHash);
    this.publishLinkedGenerationHistoryEvents([compositeHash]);
  }
}
