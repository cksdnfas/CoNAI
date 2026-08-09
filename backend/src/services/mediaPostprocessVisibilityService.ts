import { db } from '../database/init';
import { AutoTagsComposeService } from './autoTagsComposeService';
import { settingsService } from './settingsService';

type PendingPostprocessRow = {
  composite_hash: string;
  auto_tags: string | null;
};

export type ImmediatePostprocessRequirements = {
  needsTagger: boolean;
  needsKaloscope: boolean;
  hasPendingWork: boolean;
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

  /**
   * ready 전환을 연결된 생성 히스토리 행에 알린다.
   *
   * 히스토리 목록은 이 서비스의 ready 조건이 참이 될 때까지 완료 행을 '후처리 중' 으로
   * 그린다. 전환 시점에 히스토리 테이블 쓰기가 없어 자체 이벤트가 나가지 않으므로,
   * 여기서 알리지 않으면 SSE-live 클라이언트(폴링 꺼짐)는 목록을 영영 갱신하지 못한다.
   * GenerationHistory 가 이 서비스를 import 하므로 순환을 피해 lazy require 로 접근한다.
   */
  private static publishLinkedGenerationHistoryEvents(compositeHashes: string[]): void {
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

    return {
      needsTagger,
      needsKaloscope,
      hasPendingWork: needsTagger || needsKaloscope,
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
      SELECT auto_tags
      FROM media_metadata
      WHERE composite_hash = ?
    `).get(compositeHash) as { auto_tags: string | null } | undefined;

    if (!row) {
      return false;
    }

    if (this.getImmediatePostprocessRequirements(row.auto_tags).hasPendingWork) {
      return false;
    }

    this.markReady(compositeHash);
    return true;
  }

  static markReadyRowsWithoutPendingImmediateWork(): number {
    if (!hasPostprocessStatusColumn()) {
      return 0;
    }

    const rows = db.prepare(`
      SELECT composite_hash, auto_tags
      FROM media_metadata
      WHERE COALESCE(postprocess_status, 'ready') = 'pending'
    `).all() as PendingPostprocessRow[];

    const releasedHashes: string[] = [];
    for (const row of rows) {
      if (!this.getImmediatePostprocessRequirements(row.auto_tags).hasPendingWork) {
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
}
