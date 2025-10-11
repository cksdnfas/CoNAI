import { taggerDaemon, TaggerResult, TaggerServerStatus } from './taggerDaemon';
import { TaggerModel } from '../types/settings';

// Re-export types from taggerDaemon
export type { TaggerResult, TaggerServerStatus } from './taggerDaemon';

/**
 * ImageTaggerService - High-level interface for image tagging
 * Uses daemon for persistent model loading and efficient batch processing
 */
export class ImageTaggerService {
  /**
   * Tag a single image using daemon
   */
  async tagImage(imagePath: string): Promise<TaggerResult> {
    try {
      console.log(`[ImageTagger] Tagging image via daemon: ${imagePath}`);
      const result = await taggerDaemon.tagImage(imagePath);

      if (result.success) {
        console.log('[ImageTagger] Tagging succeeded');
      } else {
        console.error('[ImageTagger] Tagging failed:', {
          error: result.error,
          error_type: result.error_type
        });
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      console.error('[ImageTagger] Tagging exception:', message);
      if (stack) console.error('[ImageTagger] Stack:', stack);

      return {
        success: false,
        error: message,
        error_type: 'DaemonError'
      };
    }
  }

  /**
   * Tag multiple images in batch
   * Processes sequentially through daemon for optimal performance
   */
  async tagImageBatch(imagePaths: string[]): Promise<TaggerResult[]> {
    const results: TaggerResult[] = [];

    console.log(`[ImageTagger] Batch tagging ${imagePaths.length} images`);

    // Process sequentially through daemon
    // Daemon keeps model loaded, so this is fast
    for (const imagePath of imagePaths) {
      try {
        const result = await this.tagImage(imagePath);
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[ImageTagger] Batch error for ${imagePath}:`, message);
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
   * Check if Python and required packages are available
   * Uses daemon to verify dependencies
   */
  async checkPythonDependencies(): Promise<{ available: boolean; message: string }> {
    try {
      console.log('[ImageTagger] Checking Python dependencies via daemon...');

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
      console.error('[ImageTagger] Dependency check failed:', message);
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
  async loadModel(model?: TaggerModel): Promise<void> {
    console.log('[ImageTagger] Loading model manually:', model || 'default');
    await taggerDaemon.loadModel(model);
  }

  /**
   * Unload model manually
   */
  async unloadModel(): Promise<void> {
    console.log('[ImageTagger] Unloading model manually');
    await taggerDaemon.unloadModel();
  }

  /**
   * Start daemon
   */
  async startDaemon(): Promise<void> {
    console.log('[ImageTagger] Starting daemon');
    await taggerDaemon.start();
  }

  /**
   * Stop daemon
   */
  async stopDaemon(): Promise<void> {
    console.log('[ImageTagger] Stopping daemon');
    await taggerDaemon.stop();
  }

  /**
   * Reload configuration
   * Restarts daemon with new settings
   */
  async reloadConfig(): Promise<void> {
    console.log('[ImageTagger] Reloading configuration...');

    // Stop existing daemon
    if (taggerDaemon.isRunning()) {
      await taggerDaemon.stop();
    }

    // Daemon will be restarted on next use with new settings
    console.log('[ImageTagger] Configuration reloaded - daemon will restart on next use');
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
