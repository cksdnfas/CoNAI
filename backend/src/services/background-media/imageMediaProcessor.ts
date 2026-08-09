import path from 'path';
import { db } from '../../database/init';
import { ThumbnailGenerator } from '../../utils/thumbnailGenerator';
import { AutoCollectionService } from '../autoCollectionService';
import { ImageSimilarityService } from '../imageSimilarity';
import { MediaPostprocessVisibilityService } from '../mediaPostprocessVisibilityService';
import { MediaPostprocessCoordinator } from './mediaPostprocessCoordinator';
import {
  findExistingMediaMetadataSummary,
  isUnsupportedImageFormatError,
  linkMediaFileToHash,
  markFileAsProcessingFailed,
  shouldBackfillDuplicateMetadata,
} from './mediaProcessingSupport';
import {
  completedFileProcessing,
  completedStage,
  failedStage,
  stoppedFileProcessing,
  type MediaFileProcessingResult,
  type MediaProcessingStageResult,
  type ProcessFileOptions,
  type UnhashedMediaFile,
} from './mediaProcessingTypes';

/** File-level image hash, dedupe, metadata-row, thumbnail, and postprocess pipeline. */
export class ImageMediaProcessor {
  static async process(
    file: UnhashedMediaFile,
    options: ProcessFileOptions = {},
    fileSize?: number,
  ): Promise<MediaFileProcessingResult> {
    const fileName = path.basename(file.original_file_path);
    const stages: MediaProcessingStageResult[] = [];

    let generated: Awaited<ReturnType<typeof ImageSimilarityService.generateHashAndHistogram>>;
    let sourceImage: Awaited<ReturnType<typeof ImageSimilarityService.createSharedSourceImage>>;
    try {
      sourceImage = await ImageSimilarityService.createSharedSourceImage(
        file.original_file_path,
        fileSize,
      );
    } catch (error) {
      return stoppedFileProcessing(failedStage('image-hash', error, true), stages, { cause: error });
    }

    try {
      generated = await ImageSimilarityService.generateHashAndHistogram(
        file.original_file_path,
        sourceImage,
      );
      stages.push(completedStage('image-hash'));
    } catch (error) {
      if (isUnsupportedImageFormatError(error)) {
        markFileAsProcessingFailed(file.id, file.original_file_path, 'unsupported image format');
        return stoppedFileProcessing(
          failedStage('image-hash', 'unsupported image format', false),
          stages,
          { cause: error },
        );
      }

      return stoppedFileProcessing(failedStage('image-hash', error, true), stages, { cause: error });
    }

    const { hashes, colorHistogram, metadata: imageInfo } = generated;
    let existing;
    try {
      existing = findExistingMediaMetadataSummary(hashes.compositeHash);
    } catch (error) {
      return stoppedFileProcessing(failedStage('duplicate-link', error, true), stages, {
        compositeHash: hashes.compositeHash,
        cause: error,
      });
    }

    if (existing) {
      try {
        linkMediaFileToHash(file.id, hashes.compositeHash);
        stages.push(completedStage('duplicate-link'));
      } catch (error) {
        return stoppedFileProcessing(failedStage('duplicate-link', error, true), stages, {
          compositeHash: hashes.compositeHash,
          duplicate: true,
          cause: error,
        });
      }

      if (shouldBackfillDuplicateMetadata(existing)) {
        stages.push(await MediaPostprocessCoordinator.extractMetadataForProcessedMedia(
          file.original_file_path,
          hashes.compositeHash,
          `duplicate backfill ${fileName}`,
          options,
        ));
      } else {
        try {
          stages.push(MediaPostprocessCoordinator.releaseVisibilityIfReady(hashes.compositeHash));
        } catch (error) {
          // The duplicate row is already linked, so the composite_hash NULL batch
          // cannot retry this stage. Preserve the partial result as terminal detail.
          return stoppedFileProcessing(failedStage('visibility', error, false), stages, {
            compositeHash: hashes.compositeHash,
            duplicate: true,
            cause: error,
          });
        }
      }

      stages.push(await MediaPostprocessCoordinator.processApiGenerationGroupAssignment(hashes.compositeHash));
      console.log(`  ♻️  Duplicate detected: ${fileName}`);
      return completedFileProcessing(hashes.compositeHash, true, stages);
    }

    let thumbnailPath: string;
    try {
      thumbnailPath = await ThumbnailGenerator.generateThumbnail(
        file.original_file_path,
        hashes.compositeHash,
        sourceImage,
      );
      stages.push(completedStage('thumbnail'));
    } catch (error) {
      return stoppedFileProcessing(failedStage('thumbnail', error, true), stages, {
        compositeHash: hashes.compositeHash,
        cause: error,
      });
    }

    try {
      db.prepare(`
        INSERT INTO media_metadata (
          composite_hash, perceptual_hash, dhash, ahash,
          color_histogram, width, height, thumbnail_path,
          postprocess_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(
        hashes.compositeHash,
        hashes.perceptualHash,
        hashes.dHash,
        hashes.aHash,
        JSON.stringify(colorHistogram),
        imageInfo.width,
        imageInfo.height,
        thumbnailPath,
      );
      stages.push(completedStage('metadata-row'));
    } catch (error) {
      return stoppedFileProcessing(failedStage('metadata-row', error, true), stages, {
        compositeHash: hashes.compositeHash,
        cause: error,
      });
    }

    try {
      MediaPostprocessVisibilityService.markPending(hashes.compositeHash);
      stages.push(completedStage('visibility'));
    } catch (error) {
      return stoppedFileProcessing(failedStage('visibility', error, true), stages, {
        compositeHash: hashes.compositeHash,
        cause: error,
      });
    }

    try {
      linkMediaFileToHash(file.id, hashes.compositeHash);
      stages.push(completedStage('file-link'));
    } catch (error) {
      return stoppedFileProcessing(failedStage('file-link', error, true), stages, {
        compositeHash: hashes.compositeHash,
        cause: error,
      });
    }

    try {
      console.log('  🔍 Running auto-collection (after hash generation)...');
      const autoCollectResults = await AutoCollectionService.runAutoCollectionForNewImage(
        hashes.compositeHash,
      );
      if (autoCollectResults.length > 0) {
        console.log(`  ✅ Auto-assigned to ${autoCollectResults.length} group(s)`);
      }
      stages.push(completedStage('auto-collection'));
    } catch (autoCollectError) {
      console.warn(
        `  ⚠️  Auto-collection failed (non-critical) for ${fileName}:`,
        autoCollectError instanceof Error ? autoCollectError.message : autoCollectError,
      );
      stages.push(failedStage('auto-collection', autoCollectError, false));
    }

    stages.push(await MediaPostprocessCoordinator.processApiGenerationGroupAssignment(hashes.compositeHash));
    stages.push(await MediaPostprocessCoordinator.extractMetadataForProcessedMedia(
      file.original_file_path,
      hashes.compositeHash,
      fileName,
      options,
    ));

    console.log(`  ✨ Processed image: ${fileName}`);
    return completedFileProcessing(hashes.compositeHash, false, stages);
  }
}
