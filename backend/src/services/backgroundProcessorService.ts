import path from 'path';
import fs from 'fs';
import os from 'os';
import pLimit from 'p-limit';
import sharp from 'sharp';
import { db } from '../database/init';
import { ImageSimilarityService } from './imageSimilarity';
import { BackgroundQueueService } from './backgroundQueue';
import { generateFileHash } from '../utils/fileHash';
import { VideoProcessor } from './videoProcessor';
import { ThumbnailGenerator } from '../utils/thumbnailGenerator';
import { AutoCollectionService } from './autoCollectionService';
import { checkFileAccess } from '../utils/fileAccess';
import { MetadataExtractionError } from '../types/errors';

interface UnhashedFile {
  id: number;
  original_file_path: string;
  folder_id: number;
  mime_type: string;
}

interface ProcessingResult {
  processed: number;
  duplicates: number;
  errors: number;
  unique: number;
}

/**
 * Background Processor Service
 *
 * Phase 2 of two-phase scanning system:
 * - Processes images with NULL composite_hash
 * - Generates hashes and detects duplicates
 * - Creates thumbnails for unique images
 * - Queues metadata extraction tasks
 *
 * Runs in background without blocking user interface
 */
export class BackgroundProcessorService {
  private static processing = false;
  private static readonly BATCH_SIZE = 50;
  private static readonly CONCURRENCY = Math.max(2, os.cpus().length * 2);

  /**
   * Process all images that don't have composite_hash yet
   * Runs recursively in batches until all images are processed
   */
  static async processUnhashedImages(): Promise<ProcessingResult> {
    if (this.processing) {
      console.log('⏭️  Background processor already running, skipping...');
      return { processed: 0, duplicates: 0, errors: 0, unique: 0 };
    }

    this.processing = true;
    const result: ProcessingResult = {
      processed: 0,
      duplicates: 0,
      errors: 0,
      unique: 0,
    };

    try {
      // Query for files needing processing
      // All files need composite_hash (perceptual hash for images, MD5 hash for videos/animated)
      const unhashedFiles = db
        .prepare(
          `
        SELECT id, original_file_path, folder_id, mime_type, file_type
        FROM image_files
        WHERE composite_hash IS NULL
          AND file_status = 'active'
        ORDER BY scan_date ASC
        LIMIT ?
      `
        )
        .all(this.BATCH_SIZE) as (UnhashedFile & { file_type: string })[];

      if (unhashedFiles.length === 0) {
        console.log('✅ No unhashed images to process');
        this.processing = false;
        return result;
      }

      console.log(
        `🔨 Processing batch of ${unhashedFiles.length} unhashed images...`
      );

      // Process in parallel with concurrency limit
      const limit = pLimit(this.CONCURRENCY);

      const tasks = unhashedFiles.map((file) =>
        limit(async () => {
          try {
            await this.processFile(file);
            result.processed++;
          } catch (error) {
            console.error(
              `  ❌ Failed to process: ${path.basename(file.original_file_path)}`,
              error instanceof Error ? error.message : error
            );
            result.errors++;
          }
        })
      );

      await Promise.all(tasks);

      console.log(
        `✅ Batch complete: ${result.processed} processed, ${result.errors} errors`
      );

      // Continue processing if more images remain
      if (unhashedFiles.length === this.BATCH_SIZE) {
        console.log('📋 More images to process, scheduling next batch...');
        setTimeout(() => {
          this.processing = false;
          this.processUnhashedImages();
        }, 1000);
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

  /**
   * Process a single file: generate hash, check duplicates, create thumbnail
   */
  private static async processFile(file: UnhashedFile & { file_type: string }): Promise<void> {
    const fileName = path.basename(file.original_file_path);

    // Check if file still exists and is readable
    const access = await checkFileAccess(file.original_file_path);

    if (!access.exists) {
      console.log(`  ⚠️  File not found, deleting DB record: ${fileName}`);
      db.prepare(
        `DELETE FROM image_files WHERE id = ?`
      ).run(file.id);
      return;
    }

    if (!access.readable) {
      const errorMsg = access.errorCode === 'EACCES'
        ? `Permission denied (read): ${fileName}`
        : `Cannot read file: ${fileName}`;

      console.error(`  ❌ ${errorMsg}`);

      // 권한 오류는 재시도 가능하므로 throw (백그라운드 큐가 재시도)
      throw MetadataExtractionError.fromNodeError(
        file.original_file_path,
        { code: access.errorCode, message: access.error } as NodeJS.ErrnoException
      );
    }

    // 파일 타입에 따라 처리
    if (file.file_type === 'video' || file.file_type === 'animated') {
      // 동영상 및 애니메이션 이미지: file_hash 생성 후 composite_hash에 저장
      await this.processVideoFile(file);
      return;
    }

    // 일반 이미지: perceptual hash 생성
    await this.processImageFile(file);
  }

  /**
   * Process image file: generate hash, check duplicates, create thumbnail
   */
  private static async processImageFile(file: UnhashedFile): Promise<void> {
    const fileName = path.basename(file.original_file_path);

    // Generate hashes and color histogram
    const { hashes, colorHistogram } =
      await ImageSimilarityService.generateHashAndHistogram(
        file.original_file_path
      );

    // Check if this hash already exists (duplicate detection)
    const existing = db
      .prepare(
        `SELECT composite_hash FROM media_metadata WHERE composite_hash = ?`
      )
      .get(hashes.compositeHash) as { composite_hash: string } | undefined;

    if (existing) {
      // Duplicate found - link to existing hash without creating new metadata
      db.prepare(`UPDATE image_files SET composite_hash = ? WHERE id = ?`).run(
        hashes.compositeHash,
        file.id
      );

      console.log(`  ♻️  Duplicate detected: ${fileName}`);
      return;
    }

    // Unique image - create full metadata record
    const imageInfo = await sharp(file.original_file_path).metadata();

    // Generate thumbnail
    const thumbnailPath = await this.generateThumbnail(
      file.original_file_path,
      hashes.compositeHash
    );

    // Insert media_metadata record
    db.prepare(
      `
      INSERT INTO media_metadata (
        composite_hash, perceptual_hash, dhash, ahash,
        color_histogram, width, height, thumbnail_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      hashes.compositeHash,
      hashes.perceptualHash,
      hashes.dHash,
      hashes.aHash,
      JSON.stringify(colorHistogram),
      imageInfo.width || null,
      imageInfo.height || null,
      thumbnailPath
    );

    // Update image_files record with composite_hash
    db.prepare(`UPDATE image_files SET composite_hash = ? WHERE id = ?`).run(
      hashes.compositeHash,
      file.id
    );

    // Run auto-collection immediately after hash generation (Option A)
    try {
      console.log(`  🔍 Running auto-collection (after hash generation)...`);
      const autoCollectResults = await AutoCollectionService.runAutoCollectionForNewImage(
        hashes.compositeHash
      );
      if (autoCollectResults.length > 0) {
        console.log(`  ✅ Auto-assigned to ${autoCollectResults.length} group(s)`);
      }
    } catch (autoCollectError) {
      // Non-critical error - continue processing
      console.warn(
        `  ⚠️  Auto-collection failed (non-critical) for ${fileName}:`,
        autoCollectError instanceof Error ? autoCollectError.message : autoCollectError
      );
    }

    // Process pending API generation group assignments
    await this.processApiGenerationGroupAssignment(hashes.compositeHash);

    // Queue metadata extraction task (AI metadata, prompts, etc.)
    try {
      BackgroundQueueService.addMetadataExtractionTask(
        file.original_file_path,
        hashes.compositeHash
      );
    } catch (error) {
      // Non-critical error - continue processing
      console.warn(
        `  ⚠️  Failed to queue metadata extraction for ${fileName}:`,
        error instanceof Error ? error.message : error
      );
    }

    console.log(`  ✨ Processed image: ${fileName}`);
  }

  /**
   * Process video/animated file: generate MD5 hash, store as composite_hash, create media_metadata
   */
  private static async processVideoFile(file: UnhashedFile): Promise<void> {
    const filePath = file.original_file_path;
    const fileName = path.basename(filePath);

    // Generate MD5 file hash (동영상과 애니메이션은 파일 해시 사용)
    const fileHash = await generateFileHash(filePath);

    // Check if this hash already exists (duplicate detection)
    const existing = db
      .prepare(`SELECT composite_hash FROM media_metadata WHERE composite_hash = ?`)
      .get(fileHash) as { composite_hash: string } | undefined;

    if (existing) {
      // Metadata already exists - just link file
      db.prepare(`UPDATE image_files SET composite_hash = ? WHERE id = ?`).run(
        fileHash,
        file.id
      );
      console.log(`  ♻️  Video/Animated already processed: ${fileName}`);
      return;
    }

    // Extract video metadata immediately using FFprobe
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
    } catch (error) {
      console.warn(
        `  ⚠️  Failed to extract video metadata for ${fileName}:`,
        error instanceof Error ? error.message : error
      );
      // Continue processing even if metadata extraction fails
    }

    // Create media_metadata record with video metadata
    db.prepare(
      `
      INSERT INTO media_metadata (
        composite_hash, duration, fps, width, height, video_codec, audio_codec, bitrate, first_seen_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `
    ).run(fileHash, duration, fps, width, height, videoCodec, audioCodec, bitrate);

    // Update image_files record with composite_hash (MD5 해시 값)
    db.prepare(`UPDATE image_files SET composite_hash = ? WHERE id = ?`).run(
      fileHash,
      file.id
    );

    // Run auto-collection for video/animated files (Option A)
    try {
      console.log(`  🔍 Running auto-collection (after hash generation)...`);
      const autoCollectResults = await AutoCollectionService.runAutoCollectionForNewImage(
        fileHash
      );
      if (autoCollectResults.length > 0) {
        console.log(`  ✅ Auto-assigned to ${autoCollectResults.length} group(s)`);
      }
    } catch (autoCollectError) {
      // Non-critical error - continue processing
      console.warn(
        `  ⚠️  Auto-collection failed (non-critical) for ${fileName}:`,
        autoCollectError instanceof Error ? autoCollectError.message : autoCollectError
      );
    }

    // Process pending API generation group assignments
    await this.processApiGenerationGroupAssignment(fileHash);

    console.log(`  ✨ Processed video/animated: ${fileName} (${width}x${height})`);
  }

  /**
   * Generate thumbnail for an image
   * Returns relative path to the thumbnail file
   */
  private static async generateThumbnail(
    inputPath: string,
    compositeHash: string
  ): Promise<string> {
    return ThumbnailGenerator.generateThumbnail(inputPath, compositeHash);
  }

  /**
   * Trigger background processing (debounced)
   * Call this after Phase 1 scan completes
   */
  static triggerHashGeneration(): void {
    if (!this.processing) {
      console.log('🚀 Triggering background hash generation...');
      setTimeout(() => {
        this.processUnhashedImages();
      }, 2000); // 2 second delay to allow scan to complete
    }
  }

  /**
   * Get count of images waiting for processing
   */
  static getUnprocessedCount(): number {
    const result = db
      .prepare(
        `
      SELECT COUNT(*) as count
      FROM image_files
      WHERE composite_hash IS NULL
        AND file_status = 'active'
    `
      )
      .get() as { count: number };

    return result.count;
  }

  /**
   * Check if background processor is currently running
   */
  static isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Force stop background processing (for testing/debugging)
   */
  static forceStop(): void {
    this.processing = false;
    console.log('⏹️  Background processor stopped');
  }

  /**
   * Process pending API generation group assignments
   * Checks if this composite_hash has a pending group assignment from NAI/ComfyUI generation
   */
  private static async processApiGenerationGroupAssignment(compositeHash: string): Promise<void> {
    try {
      // Import api-generation-history database
      const { apiGenDb } = await import('../database/apiGenerationDb');
      const { ImageGroupModel } = await import('../models/Group');

      // Check if there's a pending group assignment for this hash
      const pendingAssignment = apiGenDb.prepare(`
        SELECT id, assigned_group_id
        FROM api_generation_history
        WHERE composite_hash = ?
          AND assigned_group_id IS NOT NULL
          AND generation_status = 'completed'
      `).get(compositeHash) as { id: number; assigned_group_id: number } | undefined;

      if (pendingAssignment) {
        // Add image to the assigned group
        const added = await ImageGroupModel.addImageToGroup(
          pendingAssignment.assigned_group_id,
          compositeHash,
          'manual', // User-selected group = manual collection
          0
        );

        if (added) {
          console.log(`  📁 API generation image assigned to group ${pendingAssignment.assigned_group_id}`);
        } else {
          console.log(`  ℹ️  Image already in group ${pendingAssignment.assigned_group_id}`);
        }
      }
    } catch (error) {
      // Non-critical error - continue processing
      console.warn(
        `  ⚠️  API generation group assignment failed (non-critical):`,
        error instanceof Error ? error.message : error
      );
    }
  }
}
