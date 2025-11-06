import { v4 as uuidv4 } from 'uuid';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface JobProgress {
  total: number;
  completed: number;
  failed: number;
  percentage: number;
}

export interface JobInfo {
  jobId: string;
  status: JobStatus;
  progress: JobProgress;
  historyIds: number[];
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

/**
 * JobTracker Service
 * Tracks generation jobs with progress before DB records are created
 * Provides temporary jobIds that map to historyIds after completion
 *
 * Features:
 * - Progress tracking (total, completed, failed)
 * - Automatic TTL (1 hour expiration)
 * - Thread-safe updates
 * - Batch image generation support
 */
export class JobTracker {
  private static jobs = new Map<string, JobInfo>();
  private static readonly TTL_MS = 60 * 60 * 1000; // 1 hour
  private static cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize job tracker with periodic cleanup
   */
  static initialize(): void {
    // Cleanup expired jobs every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredJobs();
    }, 5 * 60 * 1000);

    console.log('✅ JobTracker initialized with 1-hour TTL');
  }

  /**
   * Stop cleanup interval (for graceful shutdown)
   */
  static shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('✅ JobTracker shutdown complete');
    }
  }

  /**
   * Create a new job with initial progress
   */
  static createJob(totalImages: number = 1): string {
    const jobId = uuidv4();
    const now = new Date();

    this.jobs.set(jobId, {
      jobId,
      status: 'pending',
      progress: {
        total: totalImages,
        completed: 0,
        failed: 0,
        percentage: 0
      },
      historyIds: [],
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + this.TTL_MS)
    });

    console.log(`📋 Job created: ${jobId} (${totalImages} images)`);
    return jobId;
  }

  /**
   * Update job status
   */
  static updateStatus(jobId: string, status: JobStatus): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      console.warn(`⚠️ Job not found: ${jobId}`);
      return;
    }

    job.status = status;
    job.updatedAt = new Date();

    console.log(`📋 Job ${jobId} status updated: ${status}`);
  }

  /**
   * Increment completed count and update progress
   */
  static incrementCompleted(jobId: string, historyId: number): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      console.warn(`⚠️ Job not found: ${jobId}`);
      return;
    }

    job.progress.completed++;
    job.progress.percentage = Math.round((job.progress.completed / job.progress.total) * 100);
    job.historyIds.push(historyId);
    job.updatedAt = new Date();

    // Auto-update status to processing
    if (job.status === 'pending') {
      job.status = 'processing';
    }

    // Auto-update status to completed when all done
    if (job.progress.completed + job.progress.failed === job.progress.total) {
      job.status = job.progress.failed > 0 ? 'failed' : 'completed';
    }

    console.log(`📋 Job ${jobId} progress: ${job.progress.completed}/${job.progress.total} (${job.progress.percentage}%)`);
  }

  /**
   * Increment failed count and update progress
   */
  static incrementFailed(jobId: string, error?: string): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      console.warn(`⚠️ Job not found: ${jobId}`);
      return;
    }

    job.progress.failed++;
    job.progress.percentage = Math.round(((job.progress.completed + job.progress.failed) / job.progress.total) * 100);
    job.updatedAt = new Date();

    if (error && !job.error) {
      job.error = error;
    }

    // Auto-update status to processing
    if (job.status === 'pending') {
      job.status = 'processing';
    }

    // Auto-update status to failed/completed when all done
    if (job.progress.completed + job.progress.failed === job.progress.total) {
      job.status = job.progress.failed > 0 ? 'failed' : 'completed';
    }

    console.log(`📋 Job ${jobId} failed count: ${job.progress.failed}/${job.progress.total}`);
  }

  /**
   * Record error message
   */
  static recordError(jobId: string, error: string): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      console.warn(`⚠️ Job not found: ${jobId}`);
      return;
    }

    job.error = error;
    job.status = 'failed';
    job.updatedAt = new Date();

    console.log(`📋 Job ${jobId} error recorded: ${error}`);
  }

  /**
   * Get job info by jobId
   */
  static getJob(jobId: string): JobInfo | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Check if job exists
   */
  static hasJob(jobId: string): boolean {
    return this.jobs.has(jobId);
  }

  /**
   * Delete job (cleanup)
   */
  static deleteJob(jobId: string): void {
    if (this.jobs.delete(jobId)) {
      console.log(`📋 Job deleted: ${jobId}`);
    }
  }

  /**
   * Cleanup expired jobs
   */
  private static cleanupExpiredJobs(): void {
    const now = new Date();
    let deletedCount = 0;

    for (const [jobId, job] of this.jobs.entries()) {
      if (job.expiresAt < now) {
        this.jobs.delete(jobId);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(`🧹 JobTracker cleanup: ${deletedCount} expired jobs removed`);
    }
  }

  /**
   * Get all active jobs (for debugging)
   */
  static getAllJobs(): JobInfo[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get job statistics
   */
  static getStatistics(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  } {
    const jobs = Array.from(this.jobs.values());

    return {
      total: jobs.length,
      pending: jobs.filter(j => j.status === 'pending').length,
      processing: jobs.filter(j => j.status === 'processing').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length
    };
  }
}
