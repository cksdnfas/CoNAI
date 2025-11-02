import path from 'path';
import fs from 'fs';
import os from 'os';
import pLimit from 'p-limit';
import sharp from 'sharp';
import { db } from '../database/init';
import { ImageSimilarityService } from './imageSimilarity';
import { BackgroundQueueService } from './backgroundQueue';
import { generateFileHash } from '../utils/fileHash';
import { isVideoExtension } from '../constants/supportedExtensions';
import { runtimePaths } from '../config/runtimePaths';

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
      // Query for files needing processing (images or videos)
      // Static images need composite_hash, videos and animated images (GIF/WebP) need file_hash
      const unhashedFiles = db
        .prepare(
          `
        SELECT id, original_file_path, folder_id, mime_type
        FROM image_files
        WHERE (
          (mime_type LIKE 'image/%' AND mime_type NOT IN ('image/gif', 'image/webp') AND composite_hash IS NULL) OR
          (mime_type LIKE 'video/%' AND file_hash IS NULL) OR
          (mime_type IN ('image/gif', 'image/webp') AND file_hash IS NULL)
        )
          AND file_status = 'active'
        ORDER BY scan_date ASC
        LIMIT ?
      `
        )
        .all(this.BATCH_SIZE) as UnhashedFile[];

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
  private static async processFile(file: UnhashedFile): Promise<void> {
    const fileName = path.basename(file.original_file_path);
    const ext = path.extname(file.original_file_path);

    // Check if file still exists
    if (!fs.existsSync(file.original_file_path)) {
      console.log(`  ⚠️  File not found, marking as deleted: ${fileName}`);
      db.prepare(
        `UPDATE image_files SET file_status = 'deleted' WHERE id = ?`
      ).run(file.id);
      return;
    }

    // 비디오 파일 처리
    if (file.mime_type.startsWith('video/') || isVideoExtension(ext)) {
      await this.processVideoFile(file);
      return;
    }

    // 이미지 파일 처리
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
        `SELECT composite_hash FROM image_metadata WHERE composite_hash = ?`
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

    // Insert image_metadata record
    db.prepare(
      `
      INSERT INTO image_metadata (
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
   * Process video file: generate MD5 hash, create video_metadata
   */
  private static async processVideoFile(file: UnhashedFile): Promise<void> {
    const fileName = path.basename(file.original_file_path);

    // Generate MD5 file hash
    const fileHash = await generateFileHash(file.original_file_path);

    // Check if this hash already exists (duplicate detection - optional for videos)
    const existing = db
      .prepare(`SELECT file_hash FROM video_metadata WHERE file_hash = ?`)
      .get(fileHash) as { file_hash: string } | undefined;

    if (existing) {
      // Video metadata already exists - just link file
      db.prepare(`UPDATE image_files SET file_hash = ? WHERE id = ?`).run(
        fileHash,
        file.id
      );

      console.log(`  ♻️  Video already processed: ${fileName}`);
      return;
    }

    // Create basic video_metadata record (FFprobe extraction happens in metadata extraction task)
    db.prepare(
      `
      INSERT INTO video_metadata (file_hash)
      VALUES (?)
    `
    ).run(fileHash);

    // Update image_files record with file_hash
    db.prepare(`UPDATE image_files SET file_hash = ? WHERE id = ?`).run(
      fileHash,
      file.id
    );

    // Queue metadata extraction task (video metadata via FFprobe)
    try {
      BackgroundQueueService.addMetadataExtractionTask(
        file.original_file_path,
        fileHash
      );
    } catch (error) {
      // Non-critical error - continue processing
      console.warn(
        `  ⚠️  Failed to queue metadata extraction for ${fileName}:`,
        error instanceof Error ? error.message : error
      );
    }

    console.log(`  ✨ Processed video: ${fileName}`);
  }

  /**
   * Generate thumbnail for an image
   * Returns relative path to the thumbnail file
   */
  private static async generateThumbnail(
    inputPath: string,
    compositeHash: string
  ): Promise<string> {
    // Create date-based directory structure
    const dateStr = new Date().toISOString().split('T')[0];
    // 절대 경로로 디렉토리 생성 (uploads 폴더 내부)
    const tempDir = path.join(runtimePaths.uploadsDir, 'temp', 'images', dateStr, 'thumbnails');

    // Ensure directory exists
    await fs.promises.mkdir(tempDir, { recursive: true });

    // DB 저장용 상대 경로 (uploads 제외)
    const thumbnailPath = path.join('temp', 'images', dateStr, 'thumbnails', `${compositeHash}.webp`);
    // 파일 시스템용 절대 경로
    const absoluteThumbnailPath = path.join(runtimePaths.uploadsDir, thumbnailPath);

    // Skip if thumbnail already exists
    if (fs.existsSync(absoluteThumbnailPath)) {
      return thumbnailPath;
    }

    // Generate thumbnail with Sharp
    await sharp(inputPath)
      .resize(1080, 1080, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 90 })
      .toFile(absoluteThumbnailPath);

    return thumbnailPath;
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
}
