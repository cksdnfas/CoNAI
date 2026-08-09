import path from 'path';
import { autoTagScheduler } from '../autoTagScheduler';
import { BackgroundQueueService } from '../backgroundQueue';
import { MediaPostprocessVisibilityService } from '../mediaPostprocessVisibilityService';
import { QueryCacheService } from '../QueryCacheService';
import {
  completedStage,
  deferredStage,
  failedStage,
  scheduledStage,
  skippedStage,
  type MediaProcessingStageResult,
  type ProcessFileOptions,
  type SavedMediaProcessingOptions,
} from './mediaProcessingTypes';

/** Cross-media post-hash hooks shared by image/video processors and saved-media registration. */
export class MediaPostprocessCoordinator {
  static releaseVisibilityIfReady(compositeHash: string): MediaProcessingStageResult {
    const released = MediaPostprocessVisibilityService.markReadyIfNoPendingImmediateWork(compositeHash);
    if (released) {
      QueryCacheService.scheduleGalleryCacheInvalidation();
      return completedStage('visibility');
    }
    return deferredStage('visibility', 'immediate postprocess work remains');
  }

  static triggerAutoTagProcessing(
    compositeHash: string,
    filePath: string,
    options: SavedMediaProcessingOptions,
  ): MediaProcessingStageResult {
    if (options.triggerAutoTag === false) {
      return skippedStage('auto-tag', 'disabled by caller');
    }

    try {
      setTimeout(() => {
        autoTagScheduler.triggerManualProcessing(compositeHash).catch((error) => {
          console.warn(
            `  ⚠️  Immediate auto-tag trigger failed for ${path.basename(filePath)} (${compositeHash.substring(0, 16)}...):`,
            error instanceof Error ? error.message : error,
          );
        });
      }, 0);
      return scheduledStage('auto-tag');
    } catch (error) {
      return failedStage('auto-tag', error, false);
    }
  }

  private static queueMetadataExtraction(
    filePath: string,
    compositeHash: string,
    logLabel: string,
  ): MediaProcessingStageResult {
    try {
      BackgroundQueueService.addMetadataExtractionTask(filePath, compositeHash);
      console.log(`  🧠 Metadata extraction queued: ${logLabel}`);
      return completedStage('metadata-extraction');
    } catch (queueError) {
      console.warn(
        `  ⚠️  Failed to queue metadata extraction for ${logLabel}:`,
        queueError instanceof Error ? queueError.message : queueError,
      );
      this.releaseVisibilityIfReady(compositeHash);
      return failedStage('metadata-extraction', queueError, false);
    }
  }

  private static async extractMetadataNowOrQueue(
    filePath: string,
    compositeHash: string,
    logLabel: string,
  ): Promise<MediaProcessingStageResult> {
    try {
      await BackgroundQueueService.extractAndPersistMetadata(filePath, compositeHash);
      console.log(`  🧠 Metadata extracted: ${logLabel}`);
      return completedStage('metadata-extraction');
    } catch (error) {
      console.warn(
        `  ⚠️  Immediate metadata extraction failed for ${logLabel}; queued retry:`,
        error instanceof Error ? error.message : error,
      );
      const queued = this.queueMetadataExtraction(filePath, compositeHash, logLabel);
      return queued.status === 'completed'
        ? failedStage('metadata-extraction', error, true)
        : queued;
    }
  }

  static async extractMetadataForProcessedMedia(
    filePath: string,
    compositeHash: string,
    logLabel: string,
    options: ProcessFileOptions = {},
  ): Promise<MediaProcessingStageResult> {
    if (options.metadataMode === 'background') {
      return this.queueMetadataExtraction(filePath, compositeHash, logLabel);
    }

    return this.extractMetadataNowOrQueue(filePath, compositeHash, logLabel);
  }

  /**
   * Assign generated media after its image_files/media_metadata rows and history
   * composite hash are both available. Failures remain non-critical.
   */
  static async processApiGenerationGroupAssignment(compositeHash: string): Promise<MediaProcessingStageResult> {
    try {
      const { apiGenDb } = await import('../../database/apiGenerationDb');
      const { ImageGroupModel } = await import('../../models/Group');
      const pendingAssignments = apiGenDb.prepare(`
        SELECT DISTINCT assigned_group_id
        FROM api_generation_history
        WHERE composite_hash = ?
          AND assigned_group_id IS NOT NULL
          AND generation_status IN ('processing', 'completed')
      `).all(compositeHash) as Array<{ assigned_group_id: number }>;

      for (const pendingAssignment of pendingAssignments) {
        const added = await ImageGroupModel.addImageToGroup(
          pendingAssignment.assigned_group_id,
          compositeHash,
          'manual',
          0,
        );

        if (added) {
          console.log(`  📁 API generation image assigned to group ${pendingAssignment.assigned_group_id}`);
        } else {
          console.log(`  ℹ️  Image already in group ${pendingAssignment.assigned_group_id}`);
        }
      }
      return completedStage('group-assignment');
    } catch (error) {
      console.warn(
        '  ⚠️  API generation group assignment failed (non-critical):',
        error instanceof Error ? error.message : error,
      );
      return failedStage('group-assignment', error, false);
    }
  }
}
