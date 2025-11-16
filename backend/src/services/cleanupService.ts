import { GenerationHistoryModel, GenerationHistoryRecord, GenerationStatus } from '../models/GenerationHistory';
import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';

export interface CleanupDetail {
  id: number;
  reason: 'failed' | 'orphaned' | 'stale' | 'no_hash';
  service_type: string;
  created_at: string;
  generation_status: GenerationStatus;
  original_path?: string;
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

/**
 * CleanupService
 * Manages automatic cleanup of generation history records:
 * 1. Failed generations (status='failed')
 * 2. Orphaned records (files missing from disk)
 * 3. Stale pending/processing records (stuck for >1 hour)
 * 4. Completed records without composite_hash (data corruption)
 */
export class CleanupService {
  private static uploadsDir = runtimePaths.uploadsDir;

  /**
   * Check if file exists on disk
   */
  private static async checkFileExists(relativePath: string | null | undefined): Promise<boolean> {
    if (!relativePath) return false;

    const fullPath = path.join(this.uploadsDir, relativePath);

    try {
      await fs.promises.access(fullPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find failed generation records older than specified hours
   * These records never completed and should be cleaned up
   */
  static findFailedRecords(olderThanHours: number = 24): GenerationHistoryRecord[] {
    const cutoffTime = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();

    return GenerationHistoryModel.findByStatus('failed', cutoffTime);
  }

  /**
   * Find orphaned records - completed with hash but files missing from disk
   * These records have database entries but the actual image files were deleted
   */
  static async findOrphanedRecords(): Promise<GenerationHistoryRecord[]> {
    // Get all completed records with composite_hash
    const allRecords = GenerationHistoryModel.findAll({
      generation_status: 'completed'
    }).filter(record => record.composite_hash); // Must have hash (proof files were created)

    const orphaned: GenerationHistoryRecord[] = [];

    for (const record of allRecords) {
      // Check if original file is missing
      const originalExists = await this.checkFileExists(record.original_path);

      // If composite_hash exists but original file is missing → orphaned
      if (record.composite_hash && !originalExists) {
        orphaned.push(record);
      }
    }

    return orphaned;
  }

  /**
   * Find stale pending/processing records stuck for >1 hour
   * These likely indicate server crashes or network failures during generation
   */
  static findStaleRecords(olderThanHours: number = 1): GenerationHistoryRecord[] {
    const cutoffTime = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();

    return GenerationHistoryModel.findByStatuses(['pending', 'processing'], cutoffTime);
  }

  /**
   * Find completed records without composite_hash after grace period
   * These indicate incomplete processing or data corruption
   */
  static findRecordsWithoutHash(olderThanHours: number = 24): GenerationHistoryRecord[] {
    const cutoffTime = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();

    const allCompleted = GenerationHistoryModel.findAll({
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
      details.push({
        id: record.id!,
        reason: 'failed',
        service_type: record.service_type,
        created_at: record.created_at!,
        generation_status: record.generation_status,
        error_message: record.error_message
      });

      if (!dryRun) {
        GenerationHistoryModel.delete(record.id!);
      }
      summary.failed_deleted++;
    }

    // 2. Clean orphaned records (files missing from disk)
    const orphanedRecords = await this.findOrphanedRecords();
    for (const record of orphanedRecords) {
      details.push({
        id: record.id!,
        reason: 'orphaned',
        service_type: record.service_type,
        created_at: record.created_at!,
        generation_status: record.generation_status,
        original_path: record.original_path,
        composite_hash: record.composite_hash
      });

      if (!dryRun) {
        GenerationHistoryModel.delete(record.id!);
      }
      summary.orphaned_deleted++;
    }

    // 3. Clean completed records without hash (>24 hours old)
    const noHashRecords = this.findRecordsWithoutHash(24);
    for (const record of noHashRecords) {
      details.push({
        id: record.id!,
        reason: 'no_hash',
        service_type: record.service_type,
        created_at: record.created_at!,
        generation_status: record.generation_status,
        original_path: record.original_path
      });

      if (!dryRun) {
        GenerationHistoryModel.delete(record.id!);
      }
      summary.no_hash_deleted++;
    }

    // 4. Update stale pending/processing records to failed
    const staleRecords = this.findStaleRecords(1);
    for (const record of staleRecords) {
      details.push({
        id: record.id!,
        reason: 'stale',
        service_type: record.service_type,
        created_at: record.created_at!,
        generation_status: record.generation_status
      });

      if (!dryRun) {
        GenerationHistoryModel.recordError(
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
      details.push({
        id: record.id!,
        reason: 'failed',
        service_type: record.service_type,
        created_at: record.created_at!,
        generation_status: record.generation_status,
        error_message: record.error_message
      });

      if (!dryRun) {
        GenerationHistoryModel.delete(record.id!);
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
}
