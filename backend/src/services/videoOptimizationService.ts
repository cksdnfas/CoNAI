import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { VideoOptimizationSettings } from '@conai/shared';
import { VideoProcessor } from './videoProcessor';

export type VideoOptimizationRunOptions = Pick<VideoOptimizationSettings, 'crf' | 'audioBitrateKbps'> & {
  logLabel?: string;
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
  private static activeEncoderCount = 0;
  private static readonly encoderWaiters: Array<() => void> = [];

  private static getEncoderConcurrency() {
    const configured = Number.parseInt(process.env.CONAI_VIDEO_ENCODER_CONCURRENCY ?? '', 10);
    return Number.isInteger(configured) && configured > 0 ? Math.min(configured, 8) : 1;
  }

  /** Wait for one process-wide FFmpeg encoder slot. */
  private static async acquireEncoderSlot(): Promise<() => void> {
    if (this.activeEncoderCount >= this.getEncoderConcurrency()) {
      await new Promise<void>((resolve) => this.encoderWaiters.push(resolve));
    }

    this.activeEncoderCount += 1;
    let released = false;

    return () => {
      if (released) {
        return;
      }
      released = true;
      this.activeEncoderCount -= 1;
      this.encoderWaiters.shift()?.();
    };
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

  private static buildEncodingOutputPath(outputPath: string) {
    return outputPath.toLowerCase().endsWith(this.OUTPUT_EXTENSION)
      ? outputPath.replace(/\.mp4$/i, '.encoding.mp4')
      : `${outputPath}.encoding.mp4`;
  }

  private static buildUniqueOutputPath(targetPath: string) {
    if (!fs.existsSync(targetPath)) {
      return targetPath;
    }

    const parsed = path.parse(targetPath);
    let index = 1;
    while (true) {
      const candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
      if (!fs.existsSync(candidate)) {
        return candidate;
      }
      index += 1;
    }
  }

  static async transcodeToMp4(inputPath: string, outputPath: string, options: VideoOptimizationRunOptions) {
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    const releaseEncoderSlot = await this.acquireEncoderSlot();

    const tempOutputPath = this.buildEncodingOutputPath(outputPath);
    await fs.promises.unlink(tempOutputPath).catch(() => undefined);

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
        '-y',
        tempOutputPath,
      ];

      // The bundled build decodes AV1 only with libaom, which rejects some streams (e.g. NVENC AV1),
      // so the system FFmpeg is tried next, in the same order frame extraction uses.
      const errors: string[] = [];
      let transcoded = false;
      for (const ffmpegCmd of VideoProcessor.listFFmpegPaths()) {
        try {
          await new Promise<void>((resolve, reject) => {
            const ffmpeg = spawn(ffmpegCmd, args);
            let stderr = '';

            ffmpeg.stderr.on('data', (data) => {
              stderr = (stderr + data.toString()).slice(-4000);
            });

            ffmpeg.on('error', (error) => {
              reject(new Error(`Failed to spawn FFmpeg: ${error.message}`));
            });

            ffmpeg.on('close', (code) => {
              if (code !== 0) {
                // Decoders repeat one error per packet; the last lines carry the outcome.
                const tail = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-3).join(' / ');
                reject(new Error(`FFmpeg exited with code ${code}${tail ? `: ${tail}` : ''}`));
                return;
              }
              resolve();
            });
          });
          transcoded = true;
          break;
        } catch (error) {
          errors.push(`${ffmpegCmd}: ${error instanceof Error ? error.message : String(error)}`);
          await fs.promises.unlink(tempOutputPath).catch(() => undefined);
        }
      }
      if (!transcoded) {
        throw new Error(errors.join(' | '));
      }

      await fs.promises.unlink(outputPath).catch(() => undefined);
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
    const normalizedOriginalExtension = this.normalizeExtension(originalExtension) || path.extname(inputPath).toLowerCase() || this.OUTPUT_EXTENSION;
    const requestedFallbackOutputPath = `${targetBasePath}${normalizedOriginalExtension}`;
    const requestedOptimizedOutputPath = `${targetBasePath}${this.OUTPUT_EXTENSION}`;

    const fallbackOutputPath = this.buildUniqueOutputPath(requestedFallbackOutputPath);
    const optimizedOutputPath = normalizedOriginalExtension === this.OUTPUT_EXTENSION
      ? fallbackOutputPath
      : this.buildUniqueOutputPath(requestedOptimizedOutputPath);

    const sourceStats = await fs.promises.stat(inputPath);

    try {
      const optimizedResult = await this.transcodeToMp4(inputPath, optimizedOutputPath, options);
      if (optimizedResult.fileSize < sourceStats.size) {
        return {
          ...optimizedResult,
          optimized: true,
        };
      }

      await fs.promises.unlink(optimizedOutputPath).catch(() => undefined);
      await fs.promises.copyFile(inputPath, fallbackOutputPath);
      const fallbackStats = await fs.promises.stat(fallbackOutputPath);

      if (options.logLabel) {
        console.log(`↩️ Video optimization skipped (${options.logLabel}): kept original because encoded file was not smaller.`);
      }

      return {
        outputPath: fallbackOutputPath,
        fileSize: fallbackStats.size,
        mimeType: this.resolveMimeTypeForExtension(normalizedOriginalExtension),
        optimized: false,
        fallbackReason: 'larger-than-original',
      };
    } catch (error) {
      await fs.promises.unlink(optimizedOutputPath).catch(() => undefined);
      await fs.promises.copyFile(inputPath, fallbackOutputPath);
      const fallbackStats = await fs.promises.stat(fallbackOutputPath);

      console.warn(`⚠️ Video optimization fallback${options.logLabel ? ` (${options.logLabel})` : ''}:`, error);

      return {
        outputPath: fallbackOutputPath,
        fileSize: fallbackStats.size,
        mimeType: this.resolveMimeTypeForExtension(normalizedOriginalExtension),
        optimized: false,
        fallbackReason: 'transcode-failed',
      };
    }
  }
}
