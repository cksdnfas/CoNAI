import fs from 'fs';
import path from 'path';
import { db } from '../database/init';
import { runtimePaths } from '../config/runtimePaths';
import { settingsService } from './settingsService';
import { VideoOptimizationService } from './videoOptimizationService';
import { MediaPostprocessVisibilityService } from './mediaPostprocessVisibilityService';
import { SystemMaintenanceLockService } from './systemMaintenanceLockService';

type OptimizationJob = {
  composite_hash: string;
  source_path: string;
  source_size: number;
  source_mtime: number;
  crf: number;
  audio_bitrate: number;
  attempts: number;
};

/** Originals remain canonical. A durable, leased job builds an optional playback copy. */
export class GeneratedVideoOptimizationService {
  private static running = false;
  private static timer: ReturnType<typeof setInterval> | undefined;
  private static readonly LEASE_MS = 5 * 60_000;

  static start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.kick(), 5_000);
    this.timer.unref();
    this.kick();
  }

  static async enqueue(compositeHash: string, sourcePath: string): Promise<void> {
    const settings = settingsService.loadSettings().videoOptimization;
    if (!settings.enabled || !settings.applyToGeneratedOutputs) return;
    const stat = await fs.promises.stat(sourcePath);
    db.prepare(`INSERT OR IGNORE INTO generated_video_optimizations
      (composite_hash, source_path, source_size, source_mtime, crf, audio_bitrate)
      VALUES (?, ?, ?, ?, ?, ?)`).run(compositeHash, sourcePath, stat.size, stat.mtimeMs, settings.crf, settings.audioBitrateKbps);
    // Yield until registration/history publication has returned to the caller.
    setImmediate(() => this.kick());
  }

  private static kick(): void {
    void this.drain().catch((error) => console.warn('Generated video optimization worker failed:', error));
  }

  /** Only called after the caller has checked the media's access and active original file. */
  static getPlaybackPath(compositeHash: string): string | null {
    const row = db.prepare(`SELECT output_path FROM generated_video_optimizations
      WHERE composite_hash = ? AND status = 'completed'`).get(compositeHash) as { output_path: string | null } | undefined;
    return row?.output_path && fs.existsSync(row.output_path) ? row.output_path : null;
  }

  static playbackUrl(compositeHash: string, originalUrl: string): string {
    return this.getPlaybackPath(compositeHash)
      ? `${originalUrl}${originalUrl.includes('?') ? '&' : '?'}variant=optimized`
      : originalUrl;
  }

  private static async drain(): Promise<void> {
    if (this.running || SystemMaintenanceLockService.isExclusiveActive()) return;
    this.running = true;
    try {
      while (!SystemMaintenanceLockService.isExclusiveActive()) {
        const now = Date.now();
        db.prepare(`UPDATE generated_video_optimizations SET status = 'failed', last_error = 'Worker interrupted after final attempt'
          WHERE status = 'processing' AND lease_until <= ? AND attempts >= 3`).run(now);
        const job = db.prepare(`UPDATE generated_video_optimizations
          SET status = 'processing', attempts = attempts + 1, lease_until = ?
          WHERE composite_hash = (
            SELECT composite_hash FROM generated_video_optimizations
            WHERE status IN ('pending', 'processing') AND lease_until <= ? AND attempts < 3
            ORDER BY lease_until LIMIT 1
          ) RETURNING *`).get(now + this.LEASE_MS, now) as OptimizationJob | undefined;
        if (!job) break;
        await this.process(job);
      }
    } finally {
      this.running = false;
    }
  }

  private static async process(job: OptimizationJob): Promise<void> {
    // Hashes are internal media identities; never use a supplied request path here.
    if (!/^[a-f0-9]+$/i.test(job.composite_hash)) {
      db.prepare("UPDATE generated_video_optimizations SET status = 'failed', last_error = 'Invalid media identity' WHERE composite_hash = ?").run(job.composite_hash);
      return;
    }
    // An expired worker must never overwrite/delete a newer worker's successful rendition.
    const outputPath = path.join(runtimePaths.basePath, 'cache', 'generated-videos', `${job.composite_hash}.${job.attempts}.mp4`);
    const heartbeat = setInterval(() => {
      try {
        db.prepare("UPDATE generated_video_optimizations SET lease_until = ? WHERE composite_hash = ? AND status = 'processing' AND attempts = ?")
          .run(Date.now() + this.LEASE_MS, job.composite_hash, job.attempts);
      } catch (error) {
        console.warn('Generated video optimization heartbeat failed:', error);
      }
    }, 30_000);
    heartbeat.unref();
    try {
      const isCurrent = async () => {
        const active = db.prepare(`SELECT 1 FROM image_files WHERE composite_hash = ?
          AND original_file_path = ? AND file_status = 'active' LIMIT 1`).get(job.composite_hash, job.source_path);
        const stat = await fs.promises.stat(job.source_path);
        return Boolean(active) && stat.size === job.source_size && stat.mtimeMs === job.source_mtime;
      };
      if (!await isCurrent()) throw new Error('Original media changed or was removed');
      const result = await VideoOptimizationService.transcodeToMp4(job.source_path, outputPath, {
        crf: job.crf, audioBitrateKbps: job.audio_bitrate, logLabel: 'generated background copy',
      });
      if (!await isCurrent()) throw new Error('Original media changed during optimization');
      if (result.fileSize >= job.source_size) {
        await fs.promises.unlink(outputPath);
        db.prepare("UPDATE generated_video_optimizations SET status = 'skipped', lease_until = 0 WHERE composite_hash = ? AND attempts = ?").run(job.composite_hash, job.attempts);
        return;
      }
      const written = db.prepare(`UPDATE generated_video_optimizations SET status = 'completed', output_path = ?, lease_until = 0, last_error = NULL
        WHERE composite_hash = ? AND status = 'processing' AND attempts = ?`).run(outputPath, job.composite_hash, job.attempts);
      if (!written.changes) await fs.promises.unlink(outputPath).catch(() => undefined);
      MediaPostprocessVisibilityService.publishLinkedGenerationHistoryEvents([job.composite_hash]);
    } catch (error) {
      await fs.promises.unlink(outputPath).catch(() => undefined);
      db.prepare(`UPDATE generated_video_optimizations SET status = ?, lease_until = ?, last_error = ? WHERE composite_hash = ? AND attempts = ?`)
        .run(job.attempts >= 3 ? 'failed' : 'pending', Date.now() + 30_000,
          (error instanceof Error ? error.message : String(error)).slice(0, 1000), job.composite_hash, job.attempts);
      console.warn('Generated video optimization failed; original remains available:', error);
    } finally {
      clearInterval(heartbeat);
    }
  }
}
