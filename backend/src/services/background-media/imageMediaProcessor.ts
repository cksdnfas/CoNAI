import path from 'path';
import { recordPixelHash, resolveImageIdentity } from '../imageIdentityService';
import { db } from '../../database/init';
import { ThumbnailGenerator } from '../../utils/thumbnailGenerator';
import { ImageSimilarityService } from '../imageSimilarity';
import { MediaImageFeaturesModel } from '../../models/Image/MediaImageFeaturesModel';
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

    let generated: Awaited<ReturnType<typeof ImageSimilarityService.generateImageHashes>>;
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
      // The colour histogram is only needed for a new row; a duplicate stops before it is decoded.
      generated = await ImageSimilarityService.generateImageHashes(
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

    const { metadata: imageInfo } = generated;
    // Identity is pixel-exact; the perceptual hashes stay on the row for similarity search.
    let identity: Awaited<ReturnType<typeof resolveImageIdentity>>;
    try {
      identity = await resolveImageIdentity({
        filePath: file.original_file_path,
        perceptualCompositeHash: generated.hashes.compositeHash,
        source: sourceImage,
      });
    } catch (error) {
      return stoppedFileProcessing(failedStage('image-hash', error, true), stages, { cause: error });
    }
    const hashes = { ...generated.hashes, compositeHash: identity.compositeHash };
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
        recordPixelHash(hashes.compositeHash, identity.pixelHash);
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
    let colorHistogram: Awaited<ReturnType<typeof ImageSimilarityService.generateColorHistogram>>;
    try {
      [thumbnailPath, colorHistogram] = await Promise.all([
        ThumbnailGenerator.generateThumbnail(
          file.original_file_path,
          hashes.compositeHash,
          sourceImage,
        ),
        ImageSimilarityService.generateColorHistogram(file.original_file_path, sourceImage),
      ]);
      stages.push(completedStage('thumbnail'));
    } catch (error) {
      return stoppedFileProcessing(failedStage('thumbnail', error, true), stages, {
        compositeHash: hashes.compositeHash,
        cause: error,
      });
    }

    try {
      db.transaction(() => {
        db.prepare(`
          INSERT INTO media_metadata (
            composite_hash, perceptual_hash, dhash, ahash,
            width, height, thumbnail_path,
            postprocess_status, metadata_extraction_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'pending')
        `).run(
          hashes.compositeHash,
          hashes.perceptualHash,
          hashes.dHash,
          hashes.aHash,
          imageInfo.width,
          imageInfo.height,
          thumbnailPath,
        );
        MediaImageFeaturesModel.setHistogram(hashes.compositeHash, colorHistogram);
      })();
      recordPixelHash(hashes.compositeHash, identity.pixelHash);
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

    // Auto-collection runs once, after metadata extraction (BackgroundQueueService.extractAndPersistMetadata), where
    // every condition — prompts and model included — can match; running it here as well only repeated the work.
    if (options.metadataMode !== 'background') {
      stages.push(await MediaPostprocessCoordinator.processApiGenerationGroupAssignment(hashes.compositeHash));
    }
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
