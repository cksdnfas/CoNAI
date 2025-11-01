/**
 * APIImageIntegrationService
 * Handles integration between API generation history and image processing pipeline
 * - Monitors unprocessed generation history records
 * - Retries failed processing
 * - Ensures all API-generated images are properly processed with thumbnails and metadata
 */

import { GenerationHistoryModel, GenerationHistoryRecord } from '../models/GenerationHistory';
import { SingleFileProcessor } from './singleFileProcessor';
import { WatchedFolderService } from './watchedFolderService';
import path from 'path';
import fs from 'fs';

export class APIImageIntegrationService {
  private static readonly MAX_RETRY_ATTEMPTS = 3;
  private static readonly RETRY_DELAY_MS = 5000; // 5 seconds between retries

  /**
   * Process unprocessed generation history records
   * Finds records with status 'processing' but no composite_hash
   */
  static async processUnprocessedRecords(): Promise<{
    total: number;
    processed: number;
    failed: number;
  }> {
    const stats = {
      total: 0,
      processed: 0,
      failed: 0
    };

    try {
      // Get all processing records without composite_hash
      const { db } = await import('../database/init');
      const unprocessedRecords = db.prepare(`
        SELECT * FROM api_generation_history
        WHERE generation_status = 'processing'
          AND (composite_hash IS NULL OR composite_hash = '')
          AND original_path IS NOT NULL
          AND original_path != ''
        ORDER BY created_date ASC
      `).all() as GenerationHistoryRecord[];

      stats.total = unprocessedRecords.length;

      if (stats.total === 0) {
        console.log('✅ No unprocessed generation history records found');
        return stats;
      }

      console.log(`🔄 Found ${stats.total} unprocessed generation history records`);

      // Get API images watched folder
      const folders = await WatchedFolderService.listFolders();
      const apiFolder = folders.find(f => f.folder_path.includes('API') && f.folder_path.includes('images'));

      if (!apiFolder) {
        console.error('❌ API images folder not registered as watched folder');
        return stats;
      }

      // Process each record
      for (const record of unprocessedRecords) {
        try {
          await this.processRecord(record, apiFolder.id);
          stats.processed++;
        } catch (error) {
          console.error(`❌ Failed to process record ${record.id}:`, error);
          stats.failed++;
        }
      }

      console.log(`✅ Processing complete: ${stats.processed} processed, ${stats.failed} failed`);
      return stats;
    } catch (error) {
      console.error('❌ Error in processUnprocessedRecords:', error);
      return stats;
    }
  }

  /**
   * Process a single generation history record with retry logic
   */
  private static async processRecord(
    record: GenerationHistoryRecord,
    folderId: number,
    retryAttempt: number = 0
  ): Promise<void> {
    if (!record.id) {
      throw new Error('Record ID is required');
    }

    const originalPath = record.original_path;

    if (!originalPath) {
      throw new Error('No original_path in record');
    }

    // Check if file exists
    if (!fs.existsSync(originalPath)) {
      throw new Error(`File not found: ${originalPath}`);
    }

    console.log(`🔄 Processing record ${record.id} (attempt ${retryAttempt + 1}/${this.MAX_RETRY_ATTEMPTS})...`);

    try {
      // Process the file
      const processingResult = await SingleFileProcessor.processFile(
        originalPath,
        folderId,
        {
          skipIfExists: false,
          updateIfModified: true,
          generateThumbnail: true
        }
      );

      if (processingResult.success && processingResult.compositeHash) {
        // Update generation_history with composite_hash
        const { db } = await import('../database/init');
        db.prepare(`
          UPDATE api_generation_history
          SET composite_hash = ?
          WHERE id = ?
        `).run(processingResult.compositeHash, record.id);

        // Update status to completed
        GenerationHistoryModel.updateStatus(record.id, 'completed');

        console.log(`✅ Record ${record.id} processed successfully - composite_hash: ${processingResult.compositeHash}`);
      } else {
        throw new Error(processingResult.error || 'Processing failed without error message');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Retry logic
      if (retryAttempt < this.MAX_RETRY_ATTEMPTS - 1) {
        console.warn(`⚠️  Processing failed, retrying in ${this.RETRY_DELAY_MS / 1000}s...`);
        await this.delay(this.RETRY_DELAY_MS);
        return this.processRecord(record, folderId, retryAttempt + 1);
      } else {
        // Max retries reached - mark as failed
        GenerationHistoryModel.recordError(record.id, `Processing failed after ${this.MAX_RETRY_ATTEMPTS} attempts: ${errorMessage}`);
        GenerationHistoryModel.updateStatus(record.id, 'failed');
        throw error;
      }
    }
  }

  /**
   * Process a specific generation history record by ID
   */
  static async processRecordById(historyId: number): Promise<boolean> {
    try {
      const record = GenerationHistoryModel.findById(historyId);
      if (!record) {
        throw new Error(`Record ${historyId} not found`);
      }

      const folders = await WatchedFolderService.listFolders();
      const apiFolder = folders.find(f => f.folder_path.includes('API') && f.folder_path.includes('images'));

      if (!apiFolder) {
        throw new Error('API images folder not registered as watched folder');
      }

      await this.processRecord(record, apiFolder.id);
      return true;
    } catch (error) {
      console.error(`❌ Failed to process record ${historyId}:`, error);
      return false;
    }
  }

  /**
   * Get statistics on processing status
   */
  static async getProcessingStatistics(): Promise<{
    total: number;
    completed: number;
    processing: number;
    processingWithHash: number;
    processingWithoutHash: number;
    failed: number;
    pending: number;
  }> {
    const { db } = await import('../database/init');

    const total = db.prepare('SELECT COUNT(*) as count FROM api_generation_history').get() as { count: number } | undefined;
    const completed = db.prepare('SELECT COUNT(*) as count FROM api_generation_history WHERE generation_status = "completed"').get() as { count: number } | undefined;
    const processing = db.prepare('SELECT COUNT(*) as count FROM api_generation_history WHERE generation_status = "processing"').get() as { count: number } | undefined;
    const processingWithHash = db.prepare('SELECT COUNT(*) as count FROM api_generation_history WHERE generation_status = "processing" AND composite_hash IS NOT NULL AND composite_hash != ""').get() as { count: number } | undefined;
    const processingWithoutHash = db.prepare('SELECT COUNT(*) as count FROM api_generation_history WHERE generation_status = "processing" AND (composite_hash IS NULL OR composite_hash = "")').get() as { count: number } | undefined;
    const failed = db.prepare('SELECT COUNT(*) as count FROM api_generation_history WHERE generation_status = "failed"').get() as { count: number } | undefined;
    const pending = db.prepare('SELECT COUNT(*) as count FROM api_generation_history WHERE generation_status = "pending"').get() as { count: number } | undefined;

    return {
      total: total?.count ?? 0,
      completed: completed?.count ?? 0,
      processing: processing?.count ?? 0,
      processingWithHash: processingWithHash?.count ?? 0,
      processingWithoutHash: processingWithoutHash?.count ?? 0,
      failed: failed?.count ?? 0,
      pending: pending?.count ?? 0
    };
  }

  /**
   * Utility function to delay execution
   */
  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Verify JOIN query results for a specific record
   * Returns whether the record has successfully joined with image_files and image_metadata
   */
  static async verifyRecordProcessing(historyId: number): Promise<{
    hasCompositeHash: boolean;
    hasImageFile: boolean;
    hasMetadata: boolean;
    hasThumbnail: boolean;
  }> {
    const { db } = await import('../database/init');

    const result = db.prepare(`
      SELECT
        gh.composite_hash,
        if.id as image_file_id,
        im.id as metadata_id,
        im.thumbnail_path
      FROM api_generation_history gh
      LEFT JOIN main_db.image_files if ON if.original_file_path = gh.original_path
      LEFT JOIN main_db.image_metadata im ON im.composite_hash = if.composite_hash
      WHERE gh.id = ?
    `).get(historyId) as any;

    return {
      hasCompositeHash: !!result?.composite_hash,
      hasImageFile: !!result?.image_file_id,
      hasMetadata: !!result?.metadata_id,
      hasThumbnail: !!result?.thumbnail_path
    };
  }
}
