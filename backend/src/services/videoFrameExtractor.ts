import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { VideoProcessor } from './videoProcessor';
import crypto from 'crypto';

/**
 * VideoFrameExtractor - Extract frames from videos for auto-tagging
 * Extracts 7 uniformly distributed frames for comprehensive video analysis
 */
export class VideoFrameExtractor {
  private static readonly FRAME_COUNT = 7;
  private static readonly TEMP_FRAMES_DIR = 'uploads/temp/video_frames';

  /**
   * Ensure temp frames directory exists
   */
  private static async ensureTempDir(): Promise<string> {
    const tempDir = path.resolve(this.TEMP_FRAMES_DIR);
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
   * Extract a single frame at specific timestamp
   * @param videoPath Path to video file
   * @param timestamp Time in seconds
   * @param outputPath Output frame path
   */
  private static extractSingleFrame(
    videoPath: string,
    timestamp: number,
    outputPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpegCmd = VideoProcessor['getFFmpegPath']();
      const seekTime = this.formatTime(timestamp);

      const ffmpeg = spawn(ffmpegCmd, [
        '-ss', seekTime,              // Seek to timestamp
        '-i', videoPath,              // Input video
        '-vframes', '1',              // Extract 1 frame
        '-f', 'image2',               // Force image format
        '-y',                         // Overwrite output
        outputPath
      ]);

      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`FFmpeg frame extraction failed (code ${code}): ${stderr}`));
          return;
        }
        resolve();
      });

      ffmpeg.on('error', (error) => {
        reject(new Error(`Failed to spawn FFmpeg: ${error.message}`));
      });
    });
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
