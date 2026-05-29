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
import { autoTagScheduler } from './autoTagScheduler';
import { FileDiscoveryService } from './folderScan/fileDiscoveryService';
import { WatchedFolderService } from './watchedFolderService';
import { checkFileAccess } from '../utils/fileAccess';
import { SystemMaintenanceLockService } from './systemMaintenanceLockService';
import { MediaPostprocessVisibilityService } from './mediaPostprocessVisibilityService';
import { QueryCacheService } from './QueryCacheService';
import { MetadataExtractionError } from '../types/errors';
import type { FileType } from '../types/image';
import { toWindowsLongPathIfNeeded } from '../utils/pathResolver';

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

interface ExistingMediaMetadataSummary {
  composite_hash: string;
  ai_tool: string | null;
  model_name: string | null;
  lora_models: string | null;
  model_references: string | null;
  steps: number | null;
  cfg_scale: number | null;
  sampler: string | null;
  seed: number | null;
  scheduler: string | null;
  prompt: string | null;
  negative_prompt: string | null;
  character_prompt_text: string | null;
  raw_nai_parameters: string | null;
}

interface BackgroundProcessorOptions {
  quietIfIdle?: boolean;
}

interface SavedMediaProcessingOptions {
  folderId?: number;
  mimeType?: string;
  triggerAutoTag?: boolean;
  metadataMode?: 'inline' | 'background';
  quiet?: boolean;
}

interface SavedMediaProcessingResult {
  fileId: number;
  compositeHash: string | null;
  fileType: FileType;
  status: 'processed' | 'already_processed';
}

interface ProcessFileOptions {
  metadataMode?: 'inline' | 'background';
}

interface ImageFileProcessingRecord extends UnhashedFile {
  file_type: string;
  composite_hash: string | null;
}

function hasMeaningfulMetadataValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 && normalized.toLowerCase() !== 'unknown';
  }

  return true;
}

/**
 * Perceptual-hash duplicates share one media_metadata row. If that row was
 * created before metadata extraction/backfill, a later duplicate can be the
 * first file whose embedded AI metadata is readable. In that case, queue a
 * backfill instead of leaving the shared row permanently empty.
 */
function shouldBackfillDuplicateMetadata(existing: ExistingMediaMetadataSummary): boolean {
  return ![
    existing.ai_tool,
    existing.model_name,
    existing.lora_models,
    existing.model_references,
    existing.steps,
    existing.cfg_scale,
    existing.sampler,
    existing.seed,
    existing.scheduler,
    existing.prompt,
    existing.negative_prompt,
    existing.character_prompt_text,
    existing.raw_nai_parameters,
  ].some(hasMeaningfulMetadataValue);
}

function findExistingMediaMetadataSummary(compositeHash: string): ExistingMediaMetadataSummary | undefined {
  return db
    .prepare(
      `
        SELECT
          composite_hash, ai_tool, model_name, lora_models, model_references,
          steps, cfg_scale, sampler, seed, scheduler,
          prompt, negative_prompt, character_prompt_text, raw_nai_parameters
        FROM media_metadata
        WHERE composite_hash = ?
      `
    )
    .get(compositeHash) as ExistingMediaMetadataSummary | undefined;
}

function linkImageFileToHash(fileId: number, compositeHash: string): void {
  db.prepare(`UPDATE image_files SET composite_hash = ? WHERE id = ?`).run(
    compositeHash,
    fileId
  );
}

function determineFileType(mimeType: string, filePath: string): FileType {
  if (mimeType.startsWith('video/')) {
    return 'video';
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.gif' || ext === '.apng') {
    return 'animated';
  }

  return 'image';
}

function resolveBackgroundMediaConcurrency(): number {
  const configured = Number.parseInt(process.env.CONAI_BACKGROUND_MEDIA_CONCURRENCY ?? '', 10);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(configured, 8);
  }

  // This is one Node process: CPU is plentiful, but the event loop is not.
  // Keep background media work modest so thumbnail/API requests get turns.
  return Math.max(1, Math.min(2, Math.floor(os.cpus().length / 2) || 1));
}

function yieldToHttpRequests(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
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
  private static readonly CONCURRENCY = resolveBackgroundMediaConcurrency();

  /**
   * Register and process a media file that this backend just saved.
   *
   * Watched-folder scans remain as the fallback for files dropped directly into
   * folders, but upload/generation routes should call this so thumbnails,
   * hashes, metadata extraction, auto-collection, and auto-tag/artist work are
   * triggered immediately instead of waiting for the next scan tick.
   */
  static async processSavedMediaFile(
    filePath: string,
    options: SavedMediaProcessingOptions = {}
  ): Promise<SavedMediaProcessingResult> {
    const resolvedPath = path.resolve(filePath);
    const stats = await fs.promises.stat(resolvedPath);
    const mimeType = options.mimeType || FileDiscoveryService.getMimeType(resolvedPath);
    const fileType = determineFileType(mimeType, resolvedPath);
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
        now
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
      await this.processApiGenerationGroupAssignment(record.composite_hash);
      const releasedForVisibility = MediaPostprocessVisibilityService.markReadyIfNoPendingImmediateWork(record.composite_hash);
      if (releasedForVisibility) {
        QueryCacheService.scheduleGalleryCacheInvalidation();
      }
      this.triggerAutoTagProcessing(record.composite_hash, resolvedPath, options);
      return {
        fileId: record.id,
        compositeHash: record.composite_hash,
        fileType,
        status: 'already_processed',
      };
    }

    await this.processFile({
      id: record.id,
      original_file_path: resolvedPath,
      folder_id: folderId,
      mime_type: mimeType,
      file_type: fileType,
    }, {
      metadataMode: options.metadataMode,
    });

    const processedRecord = db.prepare(`
      SELECT id, composite_hash
      FROM image_files
      WHERE id = ?
    `).get(record.id) as { id: number; composite_hash: string | null } | undefined;

    const compositeHash = processedRecord?.composite_hash ?? null;
    if (compositeHash) {
      await this.processApiGenerationGroupAssignment(compositeHash);
      this.triggerAutoTagProcessing(compositeHash, resolvedPath, options);
    }

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

  private static triggerAutoTagProcessing(compositeHash: string, filePath: string, options: SavedMediaProcessingOptions): void {
    if (options.triggerAutoTag === false) {
      return;
    }

    setTimeout(() => {
      autoTagScheduler.triggerManualProcessing().catch((error) => {
        console.warn(
          `  ⚠️  Immediate auto-tag trigger failed for ${path.basename(filePath)} (${compositeHash.substring(0, 16)}...):`,
          error instanceof Error ? error.message : error
        );
      });
    }, 0);
  }

  private static queueMetadataExtraction(filePath: string, compositeHash: string, logLabel: string): void {
    try {
      BackgroundQueueService.addMetadataExtractionTask(filePath, compositeHash);
      console.log(`  🧠 Metadata extraction queued: ${logLabel}`);
    } catch (queueError) {
      console.warn(
        `  ⚠️  Failed to queue metadata extraction for ${logLabel}:`,
        queueError instanceof Error ? queueError.message : queueError
      );
      const releasedForVisibility = MediaPostprocessVisibilityService.markReadyIfNoPendingImmediateWork(compositeHash);
      if (releasedForVisibility) {
        QueryCacheService.scheduleGalleryCacheInvalidation();
      }
    }
  }

  private static async extractMetadataNowOrQueue(filePath: string, compositeHash: string, logLabel: string): Promise<void> {
    try {
      await BackgroundQueueService.extractAndPersistMetadata(filePath, compositeHash);
      console.log(`  🧠 Metadata extracted: ${logLabel}`);
    } catch (error) {
      console.warn(
        `  ⚠️  Immediate metadata extraction failed for ${logLabel}; queued retry:`,
        error instanceof Error ? error.message : error
      );

      this.queueMetadataExtraction(filePath, compositeHash, logLabel);
    }
  }

  private static async extractMetadataForProcessedMedia(
    filePath: string,
    compositeHash: string,
    logLabel: string,
    options: ProcessFileOptions = {},
  ): Promise<void> {
    if (options.metadataMode === 'background') {
      this.queueMetadataExtraction(filePath, compositeHash, logLabel);
      return;
    }

    await this.extractMetadataNowOrQueue(filePath, compositeHash, logLabel);
  }

  /**
   * Process all images that don't have composite_hash yet
   * Runs recursively in batches until all images are processed
   */
  static async processUnhashedImages(options: BackgroundProcessorOptions = {}): Promise<ProcessingResult> {
    if (SystemMaintenanceLockService.isExclusiveActive()) {
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
        if (!options.quietIfIdle) {
          console.log('✅ No unhashed images to process');
        }
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
            if (SystemMaintenanceLockService.isExclusiveActive()) {
              return;
            }
            await yieldToHttpRequests();
            await this.processFile(file);
            await yieldToHttpRequests();
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
          this.processUnhashedImages(options);
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
  private static async processFile(file: UnhashedFile & { file_type: string }, options: ProcessFileOptions = {}): Promise<void> {
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
    await this.processImageFile(file, options);
  }

  /**
   * Process image file: generate hash, check duplicates, create thumbnail
   */
  private static async processImageFile(file: UnhashedFile, options: ProcessFileOptions = {}): Promise<void> {
    const fileName = path.basename(file.original_file_path);

    // Generate hashes and color histogram
    const { hashes, colorHistogram } =
      await ImageSimilarityService.generateHashAndHistogram(
        file.original_file_path
      );

    // Check if this hash already exists (duplicate detection)
    const existing = findExistingMediaMetadataSummary(hashes.compositeHash);

    if (existing) {
      // Duplicate found - link to existing hash without creating new metadata
      linkImageFileToHash(file.id, hashes.compositeHash);

      if (shouldBackfillDuplicateMetadata(existing)) {
        await this.extractMetadataForProcessedMedia(
          file.original_file_path,
          hashes.compositeHash,
          `duplicate backfill ${fileName}`,
          options,
        );
      } else {
        const releasedForVisibility = MediaPostprocessVisibilityService.markReadyIfNoPendingImmediateWork(hashes.compositeHash);
        if (releasedForVisibility) {
          QueryCacheService.scheduleGalleryCacheInvalidation();
        }
      }

      await this.processApiGenerationGroupAssignment(hashes.compositeHash);

      console.log(`  ♻️  Duplicate detected: ${fileName}`);
      return;
    }

    // Unique image - create full metadata record
    const sharpInputPath = toWindowsLongPathIfNeeded(file.original_file_path);
    const imageInfo = await sharp(sharpInputPath).metadata();

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
        color_histogram, width, height, thumbnail_path,
        postprocess_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
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

    MediaPostprocessVisibilityService.markPending(hashes.compositeHash);

    // Update image_files record with composite_hash
    linkImageFileToHash(file.id, hashes.compositeHash);

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

    // Extract AI metadata through the selected scheduling mode so upload and
    // background scans can stay inline while generated-media completion can
    // hand the heavier work to the background queue.
    await this.extractMetadataForProcessedMedia(
      file.original_file_path,
      hashes.compositeHash,
      fileName,
      options,
    );

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
      linkImageFileToHash(file.id, fileHash);
      await this.processApiGenerationGroupAssignment(fileHash);
      const releasedForVisibility = MediaPostprocessVisibilityService.markReadyIfNoPendingImmediateWork(fileHash);
      if (releasedForVisibility) {
        QueryCacheService.scheduleGalleryCacheInvalidation();
      }
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
        composite_hash, duration, fps, width, height, video_codec, audio_codec, bitrate, first_seen_date,
        postprocess_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'pending')
    `
    ).run(fileHash, duration, fps, width, height, videoCodec, audioCodec, bitrate);

    // Update image_files record with composite_hash (MD5 해시 값)
    linkImageFileToHash(file.id, fileHash);

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

    const releasedForVisibility = MediaPostprocessVisibilityService.markReadyIfNoPendingImmediateWork(fileHash);
    if (releasedForVisibility) {
      QueryCacheService.scheduleGalleryCacheInvalidation();
    }

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
  static triggerHashGeneration(options: BackgroundProcessorOptions = {}): void {
    if (SystemMaintenanceLockService.isExclusiveActive()) {
      return;
    }

    if (!this.processing) {
      const pendingCount = this.getUnprocessedCount();

      if (pendingCount === 0 && options.quietIfIdle) {
        return;
      }

      console.log('🚀 Triggering background hash generation...');
      setTimeout(() => {
        this.processUnhashedImages(options);
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
   * Process pending API generation group assignments after generated media has
   * both a media_metadata/image_files record and a linked generation-history row.
   */
  static async processApiGenerationGroupAssignmentForHash(compositeHash: string): Promise<void> {
    await this.processApiGenerationGroupAssignment(compositeHash);
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

      // Assign once the history row is linked to saved media; completed status
      // can be written immediately after this handoff.
      const pendingAssignments = apiGenDb.prepare(`
        SELECT DISTINCT assigned_group_id
        FROM api_generation_history
        WHERE composite_hash = ?
          AND assigned_group_id IS NOT NULL
          AND generation_status IN ('processing', 'completed')
      `).all(compositeHash) as Array<{ assigned_group_id: number }>;

      for (const pendingAssignment of pendingAssignments) {
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
