import fs from 'fs';
import path from 'path';
import { db } from '../../database/init';
import { maybeTruncateImagesWal } from '../../database/walMaintenance';
import { FileDiscoveryService } from '../folderScan/fileDiscoveryService';
import { WatchedFolderService } from '../watchedFolderService';
import { processMediaFile } from './mediaFileProcessor';
import { MediaPostprocessCoordinator } from './mediaPostprocessCoordinator';
import { MediaProcessingDiagnostics } from './mediaProcessingDiagnostics';
import { determineMediaFileType } from './mediaProcessingSupport';
import {
  completedFileProcessing,
  failedStage,
  stoppedFileProcessing,
  throwIfRetryableMediaFailure,
  throwMediaProcessingFailure,
  type ImageFileProcessingRecord,
  type MediaProcessingStageResult,
  type SavedMediaProcessingOptions,
  type SavedMediaProcessingResult,
} from './mediaProcessingTypes';

/** Registration and immediate postprocess flow for one newly saved media file. */
export class SavedMediaOrchestrator {
  static async process(
    filePath: string,
    options: SavedMediaProcessingOptions = {},
  ): Promise<SavedMediaProcessingResult> {
    const resolvedPath = path.resolve(filePath);
    const stats = await fs.promises.stat(resolvedPath);
    const mimeType = options.mimeType || FileDiscoveryService.getMimeType(resolvedPath);
    const fileType = determineMediaFileType(mimeType, resolvedPath);
    const folderId = options.folderId ?? (await WatchedFolderService.reconcileDefaultUploadFolder()).id;
    const now = new Date().toISOString();

    let record = db.prepare(`
      SELECT id, original_file_path, folder_id, mime_type, file_type, composite_hash
      FROM image_files
      WHERE original_file_path = ?
    `).get(resolvedPath) as ImageFileProcessingRecord | undefined;

    if (!record) {
      db.prepare(`
        INSERT OR IGNORE INTO image_files (
          composite_hash, file_type, original_file_path, folder_id,
          file_status, file_size, mime_type, file_modified_date,
          scan_date, last_verified_date
        ) VALUES (NULL, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
      `).run(
        fileType,
        resolvedPath,
        folderId,
        stats.size,
        mimeType,
        stats.mtime.toISOString(),
        now,
        now,
      );

      record = db.prepare(`
        SELECT id, original_file_path, folder_id, mime_type, file_type, composite_hash
        FROM image_files
        WHERE original_file_path = ?
      `).get(resolvedPath) as ImageFileProcessingRecord | undefined;
    } else {
      db.prepare(`
        UPDATE image_files
        SET file_status = 'active',
            folder_id = ?,
            file_size = ?,
            mime_type = ?,
            file_modified_date = ?,
            last_verified_date = ?
        WHERE id = ?
      `).run(folderId, stats.size, mimeType, stats.mtime.toISOString(), now, record.id);
    }

    if (!record) {
      throw new Error(`Failed to register saved media file: ${resolvedPath}`);
    }

    if (record.composite_hash) {
      const stages: MediaProcessingStageResult[] = [];
      stages.push(await MediaPostprocessCoordinator.processApiGenerationGroupAssignment(record.composite_hash));
      try {
        stages.push(MediaPostprocessCoordinator.releaseVisibilityIfReady(record.composite_hash));
      } catch (error) {
        const failed = stoppedFileProcessing(failedStage('visibility', error, false), stages, {
          compositeHash: record.composite_hash,
          duplicate: true,
          cause: error,
        });
        MediaProcessingDiagnostics.record(failed);
        throwMediaProcessingFailure(failed);
      }
      stages.push(MediaPostprocessCoordinator.triggerAutoTagProcessing(
        record.composite_hash,
        resolvedPath,
        options,
      ));
      MediaProcessingDiagnostics.record(completedFileProcessing(record.composite_hash, true, stages));
      return {
        fileId: record.id,
        compositeHash: record.composite_hash,
        fileType,
        status: 'already_processed',
      };
    }

    const processingResult = await processMediaFile({
      id: record.id,
      original_file_path: resolvedPath,
      folder_id: folderId,
      mime_type: mimeType,
      file_type: fileType,
    }, {
      metadataMode: options.metadataMode,
    });
    if (processingResult.status === 'failed' && processingResult.compositeHash) {
      MediaProcessingDiagnostics.record(processingResult);
      throwMediaProcessingFailure(processingResult);
    }
    try {
      throwIfRetryableMediaFailure(processingResult);
    } catch (error) {
      MediaProcessingDiagnostics.record(processingResult);
      throw error;
    }

    const processedRecord = db.prepare(`
      SELECT id, composite_hash
      FROM image_files
      WHERE id = ?
    `).get(record.id) as { id: number; composite_hash: string | null } | undefined;

    const compositeHash = processedRecord?.composite_hash ?? null;
    if (compositeHash) {
      processingResult.stages.push(MediaPostprocessCoordinator.triggerAutoTagProcessing(
        compositeHash,
        resolvedPath,
        options,
      ));
    }
    MediaProcessingDiagnostics.record(processingResult);

    // Preserve the pre-refactor immediate path: one gated image WAL check even for video.
    maybeTruncateImagesWal('background-image-processed');

    if (!options.quiet) {
      console.log(`  ⚡ Immediate media processing complete: ${path.basename(resolvedPath)}`);
    }

    return {
      fileId: record.id,
      compositeHash,
      fileType,
      status: 'processed',
    };
  }
}
