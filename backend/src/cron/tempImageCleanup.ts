import * as cron from 'node-cron';
import { TempImageService } from '../services/tempImageService';

/**
 * Cron job for cleaning up expired temporary images
 * Runs every 30 minutes
 */
export class TempImageCleanupScheduler {
  private static job: cron.ScheduledTask | null = null;
  private static isRunning = false;

  /**
   * Start the cleanup scheduler
   */
  static start(): void {
    if (this.job) {
      return;
    }

    // Run every 30 minutes
    this.job = cron.schedule('*/30 * * * *', async () => {
      if (this.isRunning) {
        return;
      }

      try {
        this.isRunning = true;

        const result = await TempImageService.cleanupExpired();

        if (result.deleted > 0 || result.errors > 0) {
          console.log(`🧹 Temp cleanup: ${result.deleted} files deleted, ${result.errors} errors`);
        }
      } catch (error) {
        console.error('❌ Error during temp image cleanup:', error);
      } finally {
        this.isRunning = false;
      }
    });

    console.log('🧹 Temp cleanup scheduler ready (every 30 minutes)');
  }

  /**
   * Stop the cleanup scheduler
   */
  static stop(): void {
    if (this.job) {
      this.job.stop();
      this.job = null;
    }
  }

  /**
   * Run cleanup immediately (for manual trigger)
   */
  static async runNow(): Promise<{ deleted: number; errors: number }> {
    console.log('🧹 Manual temp image cleanup triggered...');
    const result = await TempImageService.cleanupExpired();
    console.log(`✅ Manual cleanup complete: ${result.deleted} files deleted, ${result.errors} errors`);
    return result;
  }
}
