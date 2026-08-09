import os from 'os';
import path from 'path';
import pLimit from 'p-limit';
import { db } from '../database/init';
import { maybeTruncateImagesWal } from '../database/walMaintenance';
import { SystemMaintenanceLockService } from './systemMaintenanceLockService';
import { processMediaFile } from './background-media/mediaFileProcessor';
import { MediaProcessingDiagnostics } from './background-media/mediaProcessingDiagnostics';
import { MediaPostprocessCoordinator } from './background-media/mediaPostprocessCoordinator';
import { SavedMediaOrchestrator } from './background-media/savedMediaOrchestrator';
import {
  getMediaProcessingResultFromError,
  throwIfRetryableMediaFailure,
  type BackgroundProcessorOptions,
  type MediaFileProcessingResult,
  type ProcessingResult,
  type SavedMediaProcessingOptions,
  type SavedMediaProcessingResult,
  type UnhashedMediaFile,
} from './background-media/mediaProcessingTypes';

export type {
  BackgroundProcessorOptions,
  ProcessingResult,
  SavedMediaProcessingOptions,
  SavedMediaProcessingResult,
} from './background-media/mediaProcessingTypes';

export function resolveBackgroundMediaConcurrency(
  configuredValue = process.env.CONAI_BACKGROUND_MEDIA_CONCURRENCY,
  cpuCount = os.cpus().length,
): number {
  const configured = Number.parseInt(configuredValue ?? '', 10);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(configured, 8);
  }

  // This is one Node process: CPU is plentiful, but the event loop is not.
  return Math.max(1, Math.min(2, Math.floor(cpuCount / 2) || 1));
}

export function resolveFailedBatchDelayMs(
  consecutiveFailedBatches: number,
  baseDelayMs = 1_000,
  maxDelayMs = 60_000,
): number {
  if (consecutiveFailedBatches === 0) {
    return baseDelayMs;
  }
  return Math.min(baseDelayMs * Math.pow(2, consecutiveFailedBatches), maxDelayMs);
}

function yieldToHttpRequests(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Batch lifecycle and backward-compatible public facade for media processing. */
export class BackgroundProcessorService {
  private static processing = false;
  private static lockRetryScheduled = false;
  private static consecutiveFailedBatches = 0;
  private static readonly BATCH_SIZE = 50;
  private static readonly CONCURRENCY = resolveBackgroundMediaConcurrency();
  private static readonly LOCK_RETRY_DELAY_MS = 5000;
  private static readonly NEXT_BATCH_DELAY_MS = 1000;
  private static readonly MAX_FAILED_BATCH_BACKOFF_MS = 60_000;

  /** Register and immediately process media saved by an upload/generation route. */
  static async processSavedMediaFile(
    filePath: string,
    options: SavedMediaProcessingOptions = {},
  ): Promise<SavedMediaProcessingResult> {
    return SavedMediaOrchestrator.process(filePath, options);
  }

  /** Process one bounded batch and reschedule without blocking request handling. */
  static async processUnhashedImages(options: BackgroundProcessorOptions = {}): Promise<ProcessingResult> {
    if (SystemMaintenanceLockService.isExclusiveActive()) {
      if (this.hasUnprocessedFiles()) {
        this.scheduleHashGenerationAfterMaintenanceLock(options);
      }
      if (!options.quietIfIdle) {
        console.log('⏸️  Background processor paused by system maintenance lock');
      }
      return { processed: 0, duplicates: 0, errors: 0, unique: 0 };
    }

    if (this.processing) {
      if (!options.quietIfIdle) {
        console.log('⏭️  Background processor already running, skipping...');
      }
      return { processed: 0, duplicates: 0, errors: 0, unique: 0 };
    }

    this.processing = true;
    MediaProcessingDiagnostics.startBatch();
    const result: ProcessingResult = { processed: 0, duplicates: 0, errors: 0, unique: 0 };

    try {
      const unhashedFiles = db.prepare(`
        SELECT id, original_file_path, folder_id, mime_type, file_type
        FROM image_files
        WHERE composite_hash IS NULL
          AND file_status = 'active'
        ORDER BY scan_date ASC
        LIMIT ?
      `).all(this.BATCH_SIZE) as UnhashedMediaFile[];

      if (unhashedFiles.length === 0) {
        if (!options.quietIfIdle) {
          console.log('✅ No unhashed images to process');
        }
        this.processing = false;
        return result;
      }

      console.log(`🔨 Processing batch of ${unhashedFiles.length} unhashed images...`);
      const limit = pLimit(this.CONCURRENCY);
      const batchCounts = { images: 0, videos: 0 };

      const tasks = unhashedFiles.map((file) => limit(async () => {
        try {
          if (SystemMaintenanceLockService.isExclusiveActive()) {
            return;
          }
          await yieldToHttpRequests();
          const fileResult = await processMediaFile(file);
          MediaProcessingDiagnostics.recordBatch(fileResult);
          if (fileResult.status === 'failed' && !fileResult.retryable && fileResult.compositeHash) {
            console.error(
              `  ❌ Failed to process: ${path.basename(file.original_file_path)}`,
              fileResult.error,
              `(stage=${fileResult.stage}, retryable=false, partial=true)`,
            );
            result.errors += 1;
            return;
          }
          throwIfRetryableMediaFailure(fileResult);
          await yieldToHttpRequests();

          // Preserve the former accounting: missing, empty, and unsupported files
          // resolve normally and therefore count as processed, not errors.
          result.processed += 1;
          if (file.file_type === 'video' || file.file_type === 'animated') {
            batchCounts.videos += 1;
          } else {
            batchCounts.images += 1;
          }
        } catch (error) {
          const stageResult = getMediaProcessingResultFromError(error);
          console.error(
            `  ❌ Failed to process: ${path.basename(file.original_file_path)}`,
            error instanceof Error ? error.message : error,
            stageResult ? `(stage=${stageResult.stage}, retryable=${stageResult.retryable})` : '',
          );
          result.errors += 1;
        }
      }));

      await Promise.all(tasks);

      if (batchCounts.images > 0) {
        maybeTruncateImagesWal('background-image-processed');
      }
      if (batchCounts.videos > 0) {
        maybeTruncateImagesWal('background-video-processed');
      }

      if (SystemMaintenanceLockService.isExclusiveActive() && this.hasUnprocessedFiles()) {
        this.scheduleHashGenerationAfterMaintenanceLock(options);
        this.processing = false;
        if (!options.quietIfIdle) {
          console.log('⏸️  Background processor retry scheduled after system maintenance lock');
        }
        return result;
      }

      const madeNoProgress = result.processed === 0 && result.errors === unhashedFiles.length;
      this.consecutiveFailedBatches = madeNoProgress ? this.consecutiveFailedBatches + 1 : 0;
      console.log(`✅ Batch complete: ${result.processed} processed, ${result.errors} errors`);

      if (unhashedFiles.length === this.BATCH_SIZE) {
        const nextBatchDelay = this.getNextBatchDelayMs();
        if (nextBatchDelay > this.NEXT_BATCH_DELAY_MS) {
          console.warn(
            `⏳ Batch made no progress (${this.consecutiveFailedBatches} in a row), backing off ${nextBatchDelay}ms before retry...`,
          );
        } else {
          console.log('📋 More images to process, scheduling next batch...');
        }

        setTimeout(() => {
          this.processing = false;
          void this.processUnhashedImages(options);
        }, nextBatchDelay);
      } else {
        this.processing = false;
      }

      return result;
    } catch (error) {
      console.error('❌ Background processor error:', error);
      this.processing = false;
      throw error;
    }
  }

  private static getNextBatchDelayMs(): number {
    return resolveFailedBatchDelayMs(
      this.consecutiveFailedBatches,
      this.NEXT_BATCH_DELAY_MS,
      this.MAX_FAILED_BATCH_BACKOFF_MS,
    );
  }

  static triggerHashGeneration(options: BackgroundProcessorOptions = {}): void {
    if (SystemMaintenanceLockService.isExclusiveActive()) {
      if (this.hasUnprocessedFiles()) {
        this.scheduleHashGenerationAfterMaintenanceLock(options);
      }
      return;
    }

    if (!this.processing) {
      if (!this.hasUnprocessedFiles() && options.quietIfIdle) {
        return;
      }

      console.log('🚀 Triggering background hash generation...');
      setTimeout(() => {
        void this.processUnhashedImages(options);
      }, 2000);
    }
  }

  private static scheduleHashGenerationAfterMaintenanceLock(options: BackgroundProcessorOptions = {}): void {
    if (this.lockRetryScheduled) {
      return;
    }

    this.lockRetryScheduled = true;
    setTimeout(() => {
      this.lockRetryScheduled = false;
      this.triggerHashGeneration({ ...options, quietIfIdle: true });
    }, this.LOCK_RETRY_DELAY_MS);
  }

  static getUnprocessedCount(): number {
    const result = db.prepare(`
      SELECT COUNT(*) as count
      FROM image_files
      WHERE composite_hash IS NULL
        AND file_status = 'active'
    `).get() as { count: number };
    return result.count;
  }

  /** Existence-only gate for per-second scheduling — O(1) where COUNT scales with backlog size. */
  static hasUnprocessedFiles(): boolean {
    const row = db.prepare(`
      SELECT 1 AS present
      FROM image_files
      WHERE composite_hash IS NULL
        AND file_status = 'active'
      LIMIT 1
    `).get() as { present: number } | undefined;
    return row !== undefined;
  }

  static isProcessing(): boolean {
    return this.processing;
  }

  /** Preserve the legacy debug behavior: flip the flag without cancelling active tasks. */
  static forceStop(): void {
    this.processing = false;
    console.log('⏹️  Background processor stopped');
  }

  static getLastProcessingStageResult(): MediaFileProcessingResult | null {
    return MediaProcessingDiagnostics.getLastResult();
  }

  static getLastBatchStageResults(): readonly MediaFileProcessingResult[] {
    return MediaProcessingDiagnostics.getLastBatchResults();
  }

  static async processApiGenerationGroupAssignmentForHash(compositeHash: string): Promise<void> {
    await MediaPostprocessCoordinator.processApiGenerationGroupAssignment(compositeHash);
  }
}
