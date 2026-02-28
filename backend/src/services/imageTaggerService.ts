import { taggerDaemon, TaggerResult, TaggerServerStatus } from './taggerDaemon';
import { logger } from '../utils/logger';
import { TaggerDevice, TaggerModel } from '../types/settings';
import { VideoFrameExtractor } from './videoFrameExtractor';
import { TagMergeService } from './tagMergeService';
import path from 'path';

// Re-export types from taggerDaemon
export type { TaggerResult, TaggerServerStatus } from './taggerDaemon';

/**
 * ImageTaggerService - High-level interface for image and video tagging
 * Uses daemon for persistent model loading and efficient batch processing
 * Supports video tagging via frame extraction and tag merging
 */
export class ImageTaggerService {
  /**
   * Tag a single image using daemon
   */
  async tagImage(imagePath: string): Promise<TaggerResult> {
    try {
      logger.debug(`[ImageTagger] Tagging image via daemon: ${imagePath}`);
      const result = await taggerDaemon.tagImage(imagePath);

      if (result.success) {
        logger.debug('[ImageTagger] Tagging succeeded');
      } else {
        logger.error('[ImageTagger] Tagging failed:', {
          error: result.error,
          error_type: result.error_type
        });
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      logger.error('[ImageTagger] Tagging exception:', message);
      if (stack) logger.error('[ImageTagger] Stack:', stack);

      return {
        success: false,
        error: message,
        error_type: 'DaemonError'
      };
    }
  }

  /**
   * Tag a video by extracting frames and merging results
   * Extracts 7 uniformly distributed frames, tags each, and merges with conservative rating
   */
  async tagVideo(videoPath: string): Promise<TaggerResult> {
    let framePaths: string[] = [];

    try {
      logger.debug(`[ImageTagger] Tagging video: ${videoPath}`);

      // 1. Extract 7 frames from video
      logger.debug('[ImageTagger] Extracting frames from video...');
      framePaths = await VideoFrameExtractor.extractFramesForTagging(videoPath);
      logger.debug(`[ImageTagger] Extracted ${framePaths.length} frames`);

      // 2. Tag each frame
      logger.debug('[ImageTagger] Tagging extracted frames...');
      const frameResults: TaggerResult[] = [];

      for (let i = 0; i < framePaths.length; i++) {
        const framePath = framePaths[i];
        logger.debug(`[ImageTagger] Tagging frame ${i + 1}/${framePaths.length}`);

        try {
          const result = await this.tagImage(framePath);
          frameResults.push(result);

          if (!result.success) {
            logger.warn(`[ImageTagger] Frame ${i + 1} tagging failed:`, result.error);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          logger.error(`[ImageTagger] Frame ${i + 1} tagging exception:`, message);
          frameResults.push({
            success: false,
            error: message,
            error_type: 'FrameTagError'
          });
        }
      }

      // 3. Merge frame results
      logger.debug('[ImageTagger] Merging frame results...');
      const mergedResult = TagMergeService.mergeVideoTagResults(frameResults);

      const stats = TagMergeService.getMergeStatistics(frameResults);
      logger.debug(`[ImageTagger] Video tagging complete: ${stats.successful}/${stats.total} frames successful`);

      return mergedResult;

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      logger.error('[ImageTagger] Video tagging exception:', message);
      if (stack) logger.error('[ImageTagger] Stack:', stack);

      return {
        success: false,
        error: message,
        error_type: 'VideoTagError'
      };

    } finally {
      // 4. Always cleanup temporary frames
      if (framePaths.length > 0) {
        try {
          await VideoFrameExtractor.cleanupTempFrames(framePaths);
        } catch (cleanupError) {
          logger.warn('[ImageTagger] Frame cleanup failed (non-critical):', cleanupError);
        }
      }
    }
  }

  /**
   * Tag multiple images in batch
   * Processes sequentially through daemon for optimal performance
   */
  async tagImageBatch(imagePaths: string[]): Promise<TaggerResult[]> {
    const results: TaggerResult[] = [];

    logger.debug(`[ImageTagger] Batch tagging ${imagePaths.length} images`);

    // Process sequentially through daemon
    // Daemon keeps model loaded, so this is fast
    for (const imagePath of imagePaths) {
      try {
        const result = await this.tagImage(imagePath);
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[ImageTagger] Batch error for ${imagePath}:`, message);
        results.push({
          success: false,
          error: message,
          error_type: 'BatchError'
        });
      }
    }

    console.log(`[ImageTagger] Batch complete: ${results.filter(r => r.success).length}/${imagePaths.length} succeeded`);

    return results;
  }

  /**
   * Check if a file is a video based on MIME type or file extension
   */
  static isVideoFile(filePath: string, mimeType?: string): boolean {
    // Check MIME type first if provided
    if (mimeType && mimeType.startsWith('video/')) {
      return true;
    }

    // Fallback to file extension check
    return VideoFrameExtractor.isVideoFile(filePath);
  }

  /**
   * Check if Python and required packages are available
   * Uses daemon to verify dependencies
   */
  async checkPythonDependencies(): Promise<{ available: boolean; message: string }> {
    try {
      logger.debug('[ImageTagger] Checking Python dependencies via daemon...');

      // Try to start daemon - if it starts, dependencies are OK
      await taggerDaemon.start();

      // Get status to confirm
      const status = await taggerDaemon.getStatus();

      if (status.isRunning) {
        return {
          available: true,
          message: 'All Python dependencies are available'
        };
      } else {
        return {
          available: false,
          message: 'Daemon failed to start - check Python dependencies'
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[ImageTagger] Dependency check failed:', message);
      return {
        available: false,
        message: `Python dependencies check failed: ${message}`
      };
    }
  }

  /**
   * Get daemon status
   */
  async getStatus(): Promise<TaggerServerStatus> {
    return await taggerDaemon.getStatus();
  }

  /**
   * Load model manually
   */
  async loadModel(model?: TaggerModel, device?: TaggerDevice): Promise<void> {
    logger.info('[ImageTagger] Loading model manually:', model || 'default', 'device:', device || 'default');
    await taggerDaemon.loadModel(model, device);
  }

  /**
   * Unload model manually
   */
  async unloadModel(): Promise<void> {
    logger.info('[ImageTagger] Unloading model manually');
    await taggerDaemon.unloadModel();
  }

  /**
   * Start daemon
   */
  async startDaemon(): Promise<void> {
    logger.info('[ImageTagger] Starting daemon');
    await taggerDaemon.start();
  }

  /**
   * Stop daemon
   */
  async stopDaemon(): Promise<void> {
    logger.info('[ImageTagger] Stopping daemon');
    await taggerDaemon.stop();
  }

  /**
   * Reload configuration
   * Restarts daemon with new settings
   */
  async reloadConfig(): Promise<void> {
    logger.info('[ImageTagger] Reloading configuration...');

    // Stop existing daemon
    if (taggerDaemon.isRunning()) {
      await taggerDaemon.stop();
    }

    // Daemon will be restarted on next use with new settings
    logger.info('[ImageTagger] Configuration reloaded - daemon will restart on next use');
  }

  /**
   * Convert TaggerResult to database-compatible format
   */
  static formatForDatabase(result: TaggerResult): string | null {
    if (!result.success) {
      return null;
    }

    const formatted = {
      caption: result.caption || '',
      taglist: result.taglist || '',
      rating: result.rating || {},
      general: result.general || {},
      character: result.character || {},
      model: result.model || 'unknown',
      thresholds: result.thresholds || { general: 0.35, character: 0.75 },
      tagged_at: new Date().toISOString()
    };

    return JSON.stringify(formatted);
  }
}

// Export singleton instance
export const imageTaggerService = new ImageTaggerService();
