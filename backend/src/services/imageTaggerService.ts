import { taggerDaemon, type TaggerResult } from './taggerDaemon';
import { logger } from '../utils/logger';
import type { TaggerDevice, TaggerModel, TaggerServerStatus } from '@conai/shared';
import { VideoFrameExtractor } from './videoFrameExtractor';
import { analyzeMedia, checkAiDependencies, type VisionResult, type VisionTasks } from './aiWorker/aiVisionService';
import type { AiWorkerPriority } from './aiWorker/aiWorkerClient';

// Re-export the daemon result and canonical wire status contracts.
export type { TaggerResult } from './taggerDaemon';
export type { TaggerServerStatus } from '@conai/shared';

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
   * Tagger and/or Kaloscope over one image or video in a single worker request (see analyzeMedia)
   */
  async analyze(
    filePath: string,
    isVideo: boolean,
    tasks: VisionTasks,
    options: { priority?: AiWorkerPriority; compositeHash?: string } = {},
  ): Promise<VisionResult> {
    return analyzeMedia(filePath, isVideo, tasks, options);
  }

  /**
   * Tag a video: frames are extracted once and tagged in one worker request, then merged with conservative rating
   */
  async tagVideo(videoPath: string): Promise<TaggerResult> {
    logger.debug(`[ImageTagger] Tagging video: ${videoPath}`);
    const result = await this.analyze(videoPath, true, { tagger: true });
    return result.tagger ?? { success: false, error: 'Tagger returned nothing', error_type: 'VideoTagError' };
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
   * Check if the AI Python and its packages are available (cached probe; does not start the worker)
   */
  async checkPythonDependencies(): Promise<{ available: boolean; message: string }> {
    const status = await checkAiDependencies();
    return { available: status.available, message: status.message };
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
