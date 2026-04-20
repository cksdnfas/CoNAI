import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import type { VideoOptimizationSettings } from '../types/settings';

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

  private static getFFmpegPath() {
    return ffmpegPath || 'ffmpeg';
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

    const tempOutputPath = this.buildEncodingOutputPath(outputPath);
    await fs.promises.unlink(tempOutputPath).catch(() => undefined);

    try {
      const args = [
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

      await new Promise<void>((resolve, reject) => {
        const ffmpeg = spawn(this.getFFmpegPath(), args);
        let stderr = '';

        ffmpeg.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ffmpeg.on('error', (error) => {
          reject(new Error(`Failed to spawn FFmpeg: ${error.message}`));
        });

        ffmpeg.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`FFmpeg exited with code ${code}${stderr ? `: ${stderr}` : ''}`));
            return;
          }
          resolve();
        });
      });

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
