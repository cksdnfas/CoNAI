import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { VideoOptimizationSettings } from '@conai/shared';
import { copyToAvailablePath, writeToAvailablePath } from '../utils/availableFilePath';
import { moveFileWithoutReplacing } from '../utils/recycleBin';
import { MediaProcessError, MediaRenderSlots, runMediaProcess } from '../utils/mediaProcess';
import { VideoProcessor } from './videoProcessor';

export type VideoOptimizationRunOptions = Pick<VideoOptimizationSettings, 'crf' | 'audioBitrateKbps'> & {
  logLabel?: string;
  signal?: AbortSignal;
};

export type VideoOptimizationPersistResult = {
  outputPath: string;
  fileSize: number;
  mimeType: string;
  optimized: boolean;
  fallbackReason?: 'larger-than-original' | 'transcode-failed';
};

/** Shared H.264 MP4 transcoding helper used by upload, generated-output, and backup-import flows. */
export class VideoOptimizationService {
  static readonly OUTPUT_EXTENSION = '.mp4';
  private static readonly encoderSlots = new MediaRenderSlots(() => this.getEncoderConcurrency());

  private static getEncoderConcurrency() {
    const configured = Number.parseInt(process.env.CONAI_VIDEO_ENCODER_CONCURRENCY ?? '', 10);
    return Number.isInteger(configured) && configured > 0 ? Math.min(configured, 8) : 1;
  }

  /** Wait for one process-wide FFmpeg encoder slot. */
  private static acquireEncoderSlot(signal?: AbortSignal): Promise<() => void> {
    return this.encoderSlots.acquire(signal);
  }

  static isOptimizableVideoExtension(extension: string) {
    const normalized = extension.toLowerCase();
    return normalized === '.mp4' || normalized === '.webm' || normalized === '.mov' || normalized === '.avi';
  }

  private static normalizeExtension(extension: string) {
    if (!extension) {
      return '';
    }
    return extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  }

  private static resolveMimeTypeForExtension(extension: string) {
    switch (this.normalizeExtension(extension)) {
      case '.mp4':
        return 'video/mp4';
      case '.webm':
        return 'video/webm';
      case '.mov':
        return 'video/quicktime';
      case '.mkv':
        return 'video/x-matroska';
      case '.avi':
        return 'video/x-msvideo';
      default:
        return 'application/octet-stream';
    }
  }

  static outputPaths(targetBasePath: string, originalExtension: string) {
    const ext = this.normalizeExtension(originalExtension) || this.OUTPUT_EXTENSION;
    return { optimized: `${targetBasePath}${this.OUTPUT_EXTENSION}`, original: `${targetBasePath}${ext}` };
  }

  static async transcodeToMp4(inputPath: string, outputPath: string, options: VideoOptimizationRunOptions) {
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    const releaseEncoderSlot = await this.acquireEncoderSlot(options.signal);

    // A watcher must see only a finished video; a different encoder must never own this staging file.
    const tempOutputPath = path.join(path.dirname(outputPath), `.conai-${randomUUID()}.part`);

    try {
      const args = [
        '-loglevel', 'error',
        '-i', inputPath,
        '-map', '0:v:0',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', String(options.crf),
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-c:a', 'aac',
        '-b:a', `${options.audioBitrateKbps}k`,
        '-f', 'mp4',
        '-y',
        tempOutputPath,
      ];

      // The bundled build decodes AV1 only with libaom, which rejects some streams (e.g. NVENC AV1),
      // so the system FFmpeg is tried next, in the same order frame extraction uses.
      const errors: string[] = [];
      let transcoded = false;
      for (const ffmpegCmd of VideoProcessor.listFFmpegPaths()) {
        options.signal?.throwIfAborted();
        try {
          await runMediaProcess([ffmpegCmd], args, { timeoutMs: null, signal: options.signal, captureStdout: false, stderrTailBytes: 4000 });
          transcoded = true;
          break;
        } catch (error) {
          options.signal?.throwIfAborted();
          const reason = error instanceof MediaProcessError && error.reason === 'exit'
            ? `FFmpeg exited with code ${error.exitCode}: ${error.stderr.trim().split(/\r?\n/).slice(-3).join(' / ')}`
            : error instanceof Error ? error.message : String(error);
          errors.push(`${ffmpegCmd}: ${reason}`);
          await fs.promises.unlink(tempOutputPath).catch(() => undefined);
        }
      }
      if (!transcoded) {
        throw new Error(errors.join(' | '));
      }

      options.signal?.throwIfAborted();
      await fs.promises.rename(tempOutputPath, outputPath);

      const stats = await fs.promises.stat(outputPath);
      if (options.logLabel) {
        console.log(`🎞️ Video optimized (${options.logLabel}): ${path.basename(outputPath)} (${Math.round(stats.size / 1024)}KB)`);
      }

      return {
        outputPath,
        fileSize: stats.size,
        mimeType: 'video/mp4',
      };
    } catch (error) {
      await fs.promises.unlink(tempOutputPath).catch(() => undefined);
      throw error;
    } finally {
      releaseEncoderSlot();
    }
  }

  static async persistWithFallback(
    inputPath: string,
    targetBasePath: string,
    originalExtension: string,
    options: VideoOptimizationRunOptions,
  ): Promise<VideoOptimizationPersistResult> {
    const requested = this.outputPaths(targetBasePath, originalExtension || path.extname(inputPath));
    const staging = path.join(path.dirname(targetBasePath), `.conai-${randomUUID()}.part`);
    const sourceStats = await fs.promises.stat(inputPath);
    try {
      let encoded: Awaited<ReturnType<typeof this.transcodeToMp4>> | undefined;
      try {
        encoded = await this.transcodeToMp4(inputPath, staging, { ...options, logLabel: undefined });
      } catch (error) {
        options.signal?.throwIfAborted();
        console.warn(`⚠️ Video optimization fallback${options.logLabel ? ` (${options.logLabel})` : ''}:`, error);
      }
      options.signal?.throwIfAborted();
      if (encoded && encoded.fileSize < sourceStats.size) {
        const outputPath = await writeToAvailablePath(requested.optimized, candidate => moveFileWithoutReplacing(staging, candidate));
        if (options.logLabel) console.log(`🎞️ Video optimized (${options.logLabel}): ${path.basename(outputPath)} (${Math.round(encoded.fileSize / 1024)}KB)`);
        return { ...encoded, outputPath, optimized: true };
      }
      if (encoded && options.logLabel) {
        console.log(`↩️ Video optimization skipped (${options.logLabel}): kept original because encoded file was not smaller.`);
      }
      const outputPath = await copyToAvailablePath(inputPath, requested.original);
      return {
        outputPath,
        fileSize: (await fs.promises.stat(outputPath)).size,
        mimeType: this.resolveMimeTypeForExtension(path.extname(requested.original)),
        optimized: false,
        fallbackReason: encoded ? 'larger-than-original' : 'transcode-failed',
      };
    } finally {
      await fs.promises.rm(staging, { force: true });
    }
  }
}
