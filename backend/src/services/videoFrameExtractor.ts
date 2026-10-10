import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { VideoProcessor } from './videoProcessor';
import crypto from 'crypto';
import { runtimePaths } from '../config/runtimePaths';
import { ThumbnailGenerator } from '../utils/thumbnailGenerator';

/**
 * VideoFrameExtractor - Extract frames from videos for auto-tagging
 * Extracts 7 uniformly distributed frames for comprehensive video analysis
 */
export class VideoFrameExtractor {
  private static readonly FRAME_COUNT = 7;
  /**
   * Poster frame position, as a fraction of the running time.
   *
   * Video intros are frequently black or a title card, so frame 0 makes a poor
   * gallery cell. A fifth of the way in is past that for typical clips.
   */
  private static readonly POSTER_POSITION_RATIO = 0.2;
  /** Never seek deeper than this: on long videos a far seek costs real time. */
  private static readonly POSTER_MAX_SEEK_SECONDS = 10;

  /**
   * Ensure temp frames directory exists
   */
  private static async ensureTempDir(): Promise<string> {
    const tempDir = path.join(runtimePaths.tempDir, 'video_frames');
    await fs.promises.mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  /**
   * Extract 7 uniformly distributed frames from video
   * @param videoPath Absolute path to video file
   * @returns Array of temporary frame file paths
   */
  static async extractFramesForTagging(videoPath: string): Promise<string[]> {
    try {
      console.log(`[FrameExtractor] Extracting ${this.FRAME_COUNT} frames from: ${videoPath}`);

      // Validate video file exists
      if (!fs.existsSync(videoPath)) {
        throw new Error(`Video file not found: ${videoPath}`);
      }

      // Get video metadata for duration
      const metadata = await VideoProcessor.extractMetadata(videoPath);
      const duration = metadata.duration;

      if (duration <= 0) {
        throw new Error(`Invalid video duration: ${duration}s`);
      }

      console.log(`[FrameExtractor] Video duration: ${duration}s`);

      // Create unique temp directory for this video (using crypto.randomUUID)
      const tempBaseDir = await this.ensureTempDir();
      const videoTempDir = path.join(tempBaseDir, crypto.randomUUID());
      await fs.promises.mkdir(videoTempDir, { recursive: true });

      console.log(`[FrameExtractor] Temp directory: ${videoTempDir}`);

      // Calculate frame timestamps (uniformly distributed)
      // Use positions: 1/8, 2/8, 3/8, 4/8, 5/8, 6/8, 7/8 of duration
      const framePaths: string[] = [];
      const extractionPromises: Promise<void>[] = [];

      for (let i = 1; i <= this.FRAME_COUNT; i++) {
        const timestamp = (duration / (this.FRAME_COUNT + 1)) * i;
        const framePath = path.join(videoTempDir, `frame_${String(i).padStart(3, '0')}.png`);

        framePaths.push(framePath);
        extractionPromises.push(this.extractSingleFrame(videoPath, timestamp, framePath));
      }

      // Extract all frames in parallel
      await Promise.all(extractionPromises);

      // Verify all frames were created
      for (const framePath of framePaths) {
        if (!fs.existsSync(framePath)) {
          throw new Error(`Failed to extract frame: ${framePath}`);
        }
      }

      console.log(`[FrameExtractor] Successfully extracted ${framePaths.length} frames`);
      return framePaths;

    } catch (error) {
      console.error('[FrameExtractor] Frame extraction failed:', error);
      throw error instanceof Error
        ? error
        : new Error('Unknown error during frame extraction');
    }
  }

  /**
   * Build the webp poster frame that stands in for a video in list/thumbnail views.
   *
   * Gallery cells used to be served the **original video file** because video rows
   * carry no `thumbnail_path`, so one page of video results streamed hundreds of MB.
   * The poster lands in the normal thumbnail location (`thumbnails/<date>/<hash>.webp`)
   * and is written to `media_metadata.thumbnail_path`, so every existing thumbnail
   * consumer picks it up with no special casing.
   *
   * @param videoPath Absolute path to the source video
   * @param compositeHash Media hash — also the poster file name
   * @returns DB-relative thumbnail path (temp-dir relative), the same shape images use
   */
  static async generatePosterThumbnail(videoPath: string, compositeHash: string): Promise<string> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    let duration = 0;
    try {
      duration = (await VideoProcessor.extractMetadata(videoPath)).duration;
    } catch {
      // Unreadable metadata is not fatal: seek to the first frame instead.
      duration = 0;
    }

    const timestamp = Number.isFinite(duration) && duration > 0
      ? Math.min(duration * this.POSTER_POSITION_RATIO, this.POSTER_MAX_SEEK_SECONDS)
      : 0;

    const tempBaseDir = await this.ensureTempDir();
    const framePath = path.join(tempBaseDir, `poster_${compositeHash}_${crypto.randomUUID()}.png`);

    try {
      await this.extractSingleFrame(videoPath, timestamp, framePath);
      if (!fs.existsSync(framePath)) {
        throw new Error(`Poster frame was not written: ${framePath}`);
      }

      // Reuse the shared generator so posters honour the user's thumbnail size and
      // quality settings and land in the same date-partitioned directory as images.
      return await ThumbnailGenerator.generateThumbnail(framePath, compositeHash);
    } finally {
      await fs.promises.rm(framePath, { force: true }).catch(() => undefined);
    }
  }

  /**
   * Extract a single frame at specific timestamp
   * @param videoPath Path to video file
   * @param timestamp Time in seconds
   * @param outputPath Output frame path
   */
  private static async extractSingleFrame(
    videoPath: string,
    timestamp: number,
    outputPath: string,
    mode: 'full' | 'preview' | 'analysis' = 'full'
  ): Promise<void> {
    const seekTime = this.formatTime(timestamp);
    const errors: string[] = [];
    // Previews and analysis frames read files users put in, so they get the hardened, time-limited run.
    const hardened = mode !== 'full';

    for (const ffmpegCmd of VideoProcessor.listFFmpegPaths()) {
      try {
        await new Promise<void>((resolve, reject) => {
          const ffmpeg = spawn(ffmpegCmd, [
            ...(hardened ? ['-nostdin', '-protocol_whitelist', 'file,pipe', '-threads', '1'] : []),
            '-ss', seekTime,              // Seek to timestamp
            '-i', videoPath,              // Input video
            '-vframes', '1',              // Extract 1 frame
            ...(mode === 'preview' ? ['-vf', 'scale=320:320:force_original_aspect_ratio=decrease', '-c:v', 'libwebp', '-quality', '78', '-threads', '1'] : []),
            ...(mode === 'analysis' ? ['-vf', "scale='min(1024,iw)':'min(1024,ih)':force_original_aspect_ratio=decrease"] : []),
            '-f', 'image2',               // Force image format
            '-y',                         // Overwrite output
            outputPath
          ]);

          let stderr = '';
          const timer = hardened ? setTimeout(() => { ffmpeg.kill(); reject(new Error('Frame extraction timed out')); }, mode === 'preview' ? 20_000 : 30_000) : undefined;

          ffmpeg.stderr.on('data', (data) => {
            stderr = (stderr + data.toString()).slice(-8000);
          });

          ffmpeg.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) {
              reject(new Error(`FFmpeg frame extraction failed (code ${code}): ${stderr}`));
              return;
            }
            resolve();
          });

          ffmpeg.on('error', (error) => {
            clearTimeout(timer);
            reject(new Error(`Failed to spawn FFmpeg: ${error.message}`));
          });
        });
        return;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        await fs.promises.rm(outputPath, { force: true }).catch(() => undefined);
      }
    }

    throw new Error(`FFmpeg frame extraction failed for all candidates: ${errors.join(' | ')}`);
  }

  /** Private-file thumbnail at one second, falling back to frame zero for sub-second clips. */
  static async extractPreviewFrame(videoPath: string, outputPath: string): Promise<void> {
    for (const timestamp of [1, 0]) {
      await this.extractSingleFrame(videoPath, timestamp, outputPath, 'preview');
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return;
    }
    throw new Error('No video frame');
  }

  /** Running time in seconds, probed the hardened way (files users put in) and given up on after 30 seconds. */
  static async probeDuration(videoPath: string): Promise<number> {
    const stdout = await new Promise<string>((resolve, reject) => {
      const ffprobe = spawn(VideoProcessor.getFFprobePath(), ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoPath], { windowsHide: true });
      let out = '';
      const timer = setTimeout(() => { ffprobe.kill(); reject(new Error('Video probe timed out')); }, 30_000);
      ffprobe.stdout.on('data', (data) => { out = (out + data.toString()).slice(-1000); });
      ffprobe.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(out); else reject(new Error(`FFprobe failed (code ${code})`)); });
      ffprobe.on('error', (error) => { clearTimeout(timer); reject(new Error(`Failed to spawn FFprobe: ${error.message}`)); });
    });
    const duration = Number.parseFloat(stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not read the video duration');
    return duration;
  }

  /**
   * Frames at `timestamps` (seconds) for a model to look at, each fit inside 1024px, three ffmpeg runs at a time.
   * Returns temp PNG paths in the same order; the caller removes them with cleanupTempFrames.
   */
  static async extractAnalysisFrames(videoPath: string, timestamps: number[]): Promise<string[]> {
    const videoTempDir = path.join(await this.ensureTempDir(), crypto.randomUUID());
    await fs.promises.mkdir(videoTempDir, { recursive: true });
    const framePaths = timestamps.map((_, index) => path.join(videoTempDir, `frame_${String(index + 1).padStart(3, '0')}.png`));
    try {
      for (let start = 0; start < timestamps.length; start += 3) {
        await Promise.all(timestamps.slice(start, start + 3).map((timestamp, offset) => this.extractSingleFrame(videoPath, timestamp, framePaths[start + offset], 'analysis')));
      }
      for (const framePath of framePaths) {
        if (!fs.existsSync(framePath)) throw new Error('Failed to extract a video frame');
      }
      return framePaths;
    } catch (error) {
      await fs.promises.rm(videoTempDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Format seconds to HH:MM:SS.mmm
   */
  private static formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
  }

  /**
   * Clean up temporary frame files
   * @param framePaths Array of frame paths to delete
   */
  static async cleanupTempFrames(framePaths: string[]): Promise<void> {
    if (!framePaths || framePaths.length === 0) {
      return;
    }

    try {
      console.log(`[FrameExtractor] Cleaning up ${framePaths.length} temporary frames`);

      // Get the parent directory (all frames should be in same dir)
      const tempDir = path.dirname(framePaths[0]);

      // Delete the entire temp directory (faster than individual files)
      if (fs.existsSync(tempDir)) {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        console.log(`[FrameExtractor] Cleaned up temp directory: ${tempDir}`);
      }

    } catch (error) {
      // Log warning but don't throw - cleanup failure shouldn't break the main operation
      console.warn('[FrameExtractor] Failed to cleanup temp frames (non-critical):', error);
    }
  }

  /**
   * Check if a file is a video based on file path
   * @param filePath Path to file
   * @returns true if video, false otherwise
   */
  static isVideoFile(filePath: string): boolean {
    const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv', '.wmv', '.m4v'];
    const ext = path.extname(filePath).toLowerCase();
    return videoExtensions.includes(ext);
  }
}
