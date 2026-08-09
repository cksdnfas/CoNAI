import path from 'path';
import { db } from '../../database/init';
import { generateFileHash } from '../../utils/fileHash';
import { ThumbnailGenerator } from '../../utils/thumbnailGenerator';
import { AutoCollectionService } from '../autoCollectionService';
import { VideoFrameExtractor } from '../videoFrameExtractor';
import { VideoProcessor } from '../videoProcessor';
import { MediaPostprocessCoordinator } from './mediaPostprocessCoordinator';
import { linkMediaFileToHash } from './mediaProcessingSupport';
import {
  completedFileProcessing,
  completedStage,
  failedStage,
  skippedStage,
  stoppedFileProcessing,
  type MediaFileProcessingResult,
  type MediaProcessingStageResult,
  type UnhashedMediaFile,
} from './mediaProcessingTypes';

/** Generate and persist the poster that stands in for a video in list views. */
export async function generateVideoPosterFrame(
  compositeHash: string,
  filePath: string,
  fileType: string | undefined,
  options: { skipIfPresent?: boolean } = {},
): Promise<MediaProcessingStageResult> {
  try {
    if (options.skipIfPresent) {
      const existingThumbnail = db.prepare(`
        SELECT thumbnail_path FROM media_metadata WHERE composite_hash = ?
      `).get(compositeHash) as { thumbnail_path: string | null } | undefined;
      if (existingThumbnail?.thumbnail_path) {
        return skippedStage('poster', 'poster already present');
      }
    }

    const thumbnailPath = fileType === 'animated'
      ? await ThumbnailGenerator.generateThumbnail(filePath, compositeHash)
      : await VideoFrameExtractor.generatePosterThumbnail(filePath, compositeHash);

    db.prepare(`
      UPDATE media_metadata
      SET thumbnail_path = ?
      WHERE composite_hash = ?
    `).run(thumbnailPath, compositeHash);
    return completedStage('poster');
  } catch (error) {
    console.warn(
      `  ⚠️  Poster frame generation failed (non-critical) for ${path.basename(filePath)}:`,
      error instanceof Error ? error.message : error,
    );
    return failedStage('poster', error, false);
  }
}

/** File-level video/animated hash, metadata, poster, and postprocess pipeline. */
export class VideoMediaProcessor {
  static async process(file: UnhashedMediaFile): Promise<MediaFileProcessingResult> {
    const filePath = file.original_file_path;
    const fileName = path.basename(filePath);
    const stages: MediaProcessingStageResult[] = [];

    let fileHash: string;
    try {
      fileHash = await generateFileHash(filePath);
      stages.push(completedStage('video-hash'));
    } catch (error) {
      return stoppedFileProcessing(failedStage('video-hash', error, true), stages, { cause: error });
    }

    let existing: { composite_hash: string } | undefined;
    try {
      existing = db.prepare('SELECT composite_hash FROM media_metadata WHERE composite_hash = ?')
        .get(fileHash) as { composite_hash: string } | undefined;
    } catch (error) {
      return stoppedFileProcessing(failedStage('duplicate-link', error, true), stages, {
        compositeHash: fileHash,
        cause: error,
      });
    }

    if (existing) {
      try {
        linkMediaFileToHash(file.id, fileHash);
        stages.push(completedStage('duplicate-link'));
      } catch (error) {
        return stoppedFileProcessing(failedStage('duplicate-link', error, true), stages, {
          compositeHash: fileHash,
          duplicate: true,
          cause: error,
        });
      }

      stages.push(await MediaPostprocessCoordinator.processApiGenerationGroupAssignment(fileHash));
      stages.push(await generateVideoPosterFrame(fileHash, filePath, file.file_type, { skipIfPresent: true }));
      try {
        stages.push(MediaPostprocessCoordinator.releaseVisibilityIfReady(fileHash));
      } catch (error) {
        // The duplicate row is already linked and is no longer selected by the
        // unhashed batch, so retryable=true would promise a retry that cannot occur.
        return stoppedFileProcessing(failedStage('visibility', error, false), stages, {
          compositeHash: fileHash,
          duplicate: true,
          cause: error,
        });
      }

      console.log(`  ♻️  Video/Animated already processed: ${fileName}`);
      return completedFileProcessing(fileHash, true, stages);
    }

    let width = 0;
    let height = 0;
    let duration = 0;
    let fps = 0;
    let videoCodec = 'unknown';
    let audioCodec: string | null = null;
    let bitrate = 0;

    try {
      const metadata = await VideoProcessor.extractMetadata(filePath);
      width = metadata.width;
      height = metadata.height;
      duration = metadata.duration;
      fps = metadata.fps;
      videoCodec = metadata.video_codec;
      audioCodec = metadata.audio_codec;
      bitrate = metadata.bitrate;
      console.log(`  📊 Extracted metadata: ${width}x${height}, ${duration.toFixed(2)}s, ${videoCodec}`);
      stages.push(completedStage('video-metadata'));
    } catch (error) {
      console.warn(
        `  ⚠️  Failed to extract video metadata for ${fileName}:`,
        error instanceof Error ? error.message : error,
      );
      stages.push(failedStage('video-metadata', error, false));
    }

    try {
      db.prepare(`
        INSERT INTO media_metadata (
          composite_hash, duration, fps, width, height, video_codec, audio_codec, bitrate, first_seen_date,
          postprocess_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'pending')
      `).run(fileHash, duration, fps, width, height, videoCodec, audioCodec, bitrate);
      stages.push(completedStage('metadata-row'));
    } catch (error) {
      return stoppedFileProcessing(failedStage('metadata-row', error, true), stages, {
        compositeHash: fileHash,
        cause: error,
      });
    }

    try {
      linkMediaFileToHash(file.id, fileHash);
      stages.push(completedStage('file-link'));
    } catch (error) {
      return stoppedFileProcessing(failedStage('file-link', error, true), stages, {
        compositeHash: fileHash,
        cause: error,
      });
    }

    stages.push(await generateVideoPosterFrame(fileHash, filePath, file.file_type));

    try {
      console.log('  🔍 Running auto-collection (after hash generation)...');
      const autoCollectResults = await AutoCollectionService.runAutoCollectionForNewImage(fileHash);
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

    stages.push(await MediaPostprocessCoordinator.processApiGenerationGroupAssignment(fileHash));
    try {
      stages.push(MediaPostprocessCoordinator.releaseVisibilityIfReady(fileHash));
    } catch (error) {
      // Linking succeeded before visibility release, so this failure is retained
      // as non-retryable partial progress rather than a phantom unhashed retry.
      return stoppedFileProcessing(failedStage('visibility', error, false), stages, {
        compositeHash: fileHash,
        cause: error,
      });
    }

    console.log(`  ✨ Processed video/animated: ${fileName} (${width}x${height})`);
    return completedFileProcessing(fileHash, false, stages);
  }
}
