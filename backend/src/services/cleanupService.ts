import { db } from '../database/init';
import { HistoryQueryRepository } from '../repositories/history/HistoryQueryRepository';
import type { GenerationHistoryRecord, GenerationStatus } from '../types/generationHistory';
import { HistoryCommandService } from './historyCommandService';
import { GenerationQueueModel } from '../models/GenerationQueue';
import { requestGenerationResultRetentionPrune } from './generationResultRetentionService';

export interface CleanupDetail {
  id: number;
  reason: 'failed' | 'orphaned' | 'stale' | 'no_hash';
  service_type: string;
  created_at: string;
  generation_status: GenerationStatus;
  thumbnail_path?: string;
  composite_hash?: string;
  error_message?: string;
}

export interface CleanupReport {
  deleted: number;
  updated: number;
  details: CleanupDetail[];
  summary: {
    failed_deleted: number;
    orphaned_deleted: number;
    no_hash_deleted: number;
    stale_updated: number;
  };
}

function cleanupDetailForRecord(
  record: GenerationHistoryRecord,
  reason: CleanupDetail['reason'],
  extra: Partial<CleanupDetail> = {},
): CleanupDetail {
  return {
    id: record.id!,
    reason,
    service_type: record.service_type,
    created_at: record.created_at!,
    generation_status: record.generation_status,
    ...extra,
  };
}

/**
 * CleanupService
 * Manages automatic cleanup of generation history records:
 * 1. Failed generations (status='failed')
 * 2. Orphaned records (main DB hash linkage missing)
 * 3. Stale pending/processing records (stuck for >1 hour)
 * 4. Completed records without composite_hash (data corruption)
 */
export class CleanupService {
  private static periodicCleanupTimer: NodeJS.Timeout | null = null;
  private static cleanupInProgress = false;

  /** Compact old completed/failed/cancelled queue payloads without deleting queue rows. */
  private static pruneOldGenerationQueuePayloads(): number {
    const report = GenerationQueueModel.pruneTerminalRequestPayloads();

    if (report.pruned > 0) {
      console.log(`🧹 Generation queue payload cleanup: ${report.pruned} old terminal payloads compacted, ${report.retainRecentTerminalJobs} recent terminal jobs retained`);
    }

    return report.pruned;
  }

  /**
   * Find failed generation records older than specified hours
   * These records never completed and should be cleaned up
   */
  static findFailedRecords(olderThanHours: number = 24): GenerationHistoryRecord[] {
    const cutoffTime = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();

    return HistoryQueryRepository.findByStatus('failed', cutoffTime);
  }

  /**
   * Find orphaned records - completed with hash but no active main-DB file linkage.
   * History should follow the main image DB through composite_hash, not raw stored paths.
   */
  static async findOrphanedRecords(): Promise<GenerationHistoryRecord[]> {
    const allRecords = HistoryQueryRepository.findAll({
      generation_status: 'completed'
    }).filter(record => record.composite_hash);

    if (allRecords.length === 0) {
      return [];
    }

    // 히스토리는 apiGenDb, image_files는 메인 DB라 단일 NOT EXISTS 쿼리가
    // 불가능 → 해시를 청크 IN 조회로 일괄 확인 (per-row 쿼리 N+1 제거)
    const uniqueHashes = Array.from(new Set(allRecords.map(record => record.composite_hash!)));
    const activeHashes = this.findHashesWithActiveFiles(uniqueHashes);

    return allRecords.filter(record => !activeHashes.has(record.composite_hash!));
  }

  /** Resolve which of the given hashes still have active main-DB files, in chunked IN lookups. */
  private static findHashesWithActiveFiles(hashes: string[]): Set<string> {
    const CHUNK_SIZE = 500;
    const active = new Set<string>();

    for (let i = 0; i < hashes.length; i += CHUNK_SIZE) {
      const chunk = hashes.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT DISTINCT composite_hash
         FROM image_files
         WHERE file_status = 'active'
           AND composite_hash IN (${placeholders})`
      ).all(...chunk) as Array<{ composite_hash: string }>;

      for (const row of rows) {
        active.add(row.composite_hash);
      }
    }

    return active;
  }

  /**
   * Find stale pending/processing records stuck for >1 hour
   * These likely indicate server crashes or network failures during generation
   */
  static findStaleRecords(olderThanHours: number = 1): GenerationHistoryRecord[] {
    const cutoffTime = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();

    return HistoryQueryRepository.findByStatuses(['pending', 'processing'], cutoffTime);
  }

  /**
   * Find completed records without composite_hash after grace period
   * These indicate incomplete processing or data corruption
   */
  static findRecordsWithoutHash(olderThanHours: number = 24): GenerationHistoryRecord[] {
    const cutoffTime = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();

    const allCompleted = HistoryQueryRepository.findAll({
      generation_status: 'completed'
    });

    return allCompleted.filter(record => {
      const isOldEnough = record.created_at && record.created_at < cutoffTime;
      const hasNoHash = !record.composite_hash;
      return isOldEnough && hasNoHash;
    });
  }

  /**
   * Execute cleanup with optional dry-run mode
   * Returns detailed report of actions taken
   */
  static async executeCleanup(options: { dryRun?: boolean } = {}): Promise<CleanupReport> {
    const { dryRun = false } = options;

    const details: CleanupDetail[] = [];
    const summary = {
      failed_deleted: 0,
      orphaned_deleted: 0,
      no_hash_deleted: 0,
      stale_updated: 0
    };

    console.log(`🧹 ${dryRun ? '[DRY RUN]' : ''} Starting generation history cleanup...`);

    // 1. Clean failed records (>24 hours old)
    const failedRecords = this.findFailedRecords(24);
    for (const record of failedRecords) {
      details.push(cleanupDetailForRecord(record, 'failed', {
        error_message: record.error_message
      }));

      if (!dryRun) {
        HistoryCommandService.delete(record.id!);
      }
      summary.failed_deleted++;
    }

    // 2. Clean orphaned records (main DB hash linkage missing)
    const orphanedRecords = await this.findOrphanedRecords();
    for (const record of orphanedRecords) {
      details.push(cleanupDetailForRecord(record, 'orphaned', {
        composite_hash: record.composite_hash
      }));

      if (!dryRun) {
        HistoryCommandService.delete(record.id!);
      }
      summary.orphaned_deleted++;
    }

    // 3. Clean completed records without hash (>24 hours old)
    const noHashRecords = this.findRecordsWithoutHash(24);
    for (const record of noHashRecords) {
      details.push(cleanupDetailForRecord(record, 'no_hash'));

      if (!dryRun) {
        HistoryCommandService.delete(record.id!);
      }
      summary.no_hash_deleted++;
    }

    // 4. Update stale pending/processing records to failed
    const staleRecords = this.findStaleRecords(1);
    for (const record of staleRecords) {
      details.push(cleanupDetailForRecord(record, 'stale'));

      if (!dryRun) {
        HistoryCommandService.recordError(
          record.id!,
          'Generation timeout - auto-cleaned by cleanup service'
        );
      }
      summary.stale_updated++;
    }

    const totalDeleted = summary.failed_deleted + summary.orphaned_deleted + summary.no_hash_deleted;
    const totalUpdated = summary.stale_updated;

    console.log(`🧹 ${dryRun ? '[DRY RUN]' : ''} Cleanup complete:`);
    console.log(`   - Failed records deleted: ${summary.failed_deleted}`);
    console.log(`   - Orphaned records deleted: ${summary.orphaned_deleted}`);
    console.log(`   - No-hash records deleted: ${summary.no_hash_deleted}`);
    console.log(`   - Stale records updated: ${summary.stale_updated}`);
    console.log(`   - Total: ${totalDeleted} deleted, ${totalUpdated} updated`);

    if (!dryRun) {
      this.pruneOldGenerationQueuePayloads();
      requestGenerationResultRetentionPrune();
    }

    return {
      deleted: totalDeleted,
      updated: totalUpdated,
      details,
      summary
    };
  }

  /**
   * Run startup cleanup - clean stale records from previous session
   * This is automatically called on server startup
   */
  static async runStartupCleanup(): Promise<void> {
    console.log('🚀 Running startup cleanup for generation history...');

    const report = await this.executeCleanup({ dryRun: false });

    if (report.deleted > 0 || report.updated > 0) {
      console.log(`✅ Startup cleanup: ${report.deleted} records deleted, ${report.updated} records updated`);
    } else {
      console.log('✅ Startup cleanup: No records to clean');
    }
  }

  /**
   * Cleanup only failed records (no age restriction)
   * Used for manual cleanup of all failed items
   */
  static async cleanupFailedOnly(options: { dryRun?: boolean } = {}): Promise<CleanupReport> {
    const { dryRun = false } = options;

    const details: CleanupDetail[] = [];
    const summary = {
      failed_deleted: 0,
      orphaned_deleted: 0,
      no_hash_deleted: 0,
      stale_updated: 0
    };

    console.log(`🧹 ${dryRun ? '[DRY RUN]' : ''} Cleaning up failed generation records...`);

    // Get ALL failed records (no time restriction)
    const failedRecords = this.findFailedRecords(0); // 0 hours = get all failed records
    for (const record of failedRecords) {
      details.push(cleanupDetailForRecord(record, 'failed', {
        error_message: record.error_message
      }));

      if (!dryRun) {
        HistoryCommandService.delete(record.id!);
      }
      summary.failed_deleted++;
    }

    console.log(`🧹 ${dryRun ? '[DRY RUN]' : ''} Failed cleanup complete: ${summary.failed_deleted} records deleted`);

    return {
      deleted: summary.failed_deleted,
      updated: 0,
      details,
      summary
    };
  }

  /**
   * Run periodic cleanup - scheduled job (every 6 hours)
   * Cleans old failed records, orphaned records, and stale records
   */
  static async runPeriodicCleanup(): Promise<void> {
    console.log('⏰ Running periodic cleanup for generation history...');

    const report = await this.executeCleanup({ dryRun: false });

    if (report.deleted > 0 || report.updated > 0) {
      console.log(`✅ Periodic cleanup: ${report.deleted} records deleted, ${report.updated} records updated`);
    } else {
      console.log('✅ Periodic cleanup: No records to clean');
    }
  }

  /** Start automatic periodic cleanup for orphaned/stale generation history rows. */
  static startPeriodicCleanup(intervalMs: number = 6 * 60 * 60 * 1000): void {
    if (this.periodicCleanupTimer) {
      return;
    }

    this.periodicCleanupTimer = setInterval(() => {
      void this.runPeriodicCleanupSafely();
    }, intervalMs);

    console.log(`🧹 Generation history cleanup scheduler ready (${Math.round(intervalMs / 1000)}s)`);
  }

  /** Stop the automatic generation history cleanup scheduler. */
  static stopPeriodicCleanup(): void {
    if (!this.periodicCleanupTimer) {
      return;
    }

    clearInterval(this.periodicCleanupTimer);
    this.periodicCleanupTimer = null;
  }

  private static async runPeriodicCleanupSafely(): Promise<void> {
    if (this.cleanupInProgress) {
      console.log('⏭️ Generation history cleanup already running; skipping this interval');
      return;
    }

    this.cleanupInProgress = true;
    try {
      await this.runPeriodicCleanup();
    } catch (error) {
      console.warn('⚠️  Failed to run periodic generation history cleanup:', error instanceof Error ? error.message : error);
    } finally {
      this.cleanupInProgress = false;
    }
  }
}
