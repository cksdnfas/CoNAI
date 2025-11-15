import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { runtimePaths } from '../config/runtimePaths';

export interface TempImageInfo {
  id: string;
  originalImageId: number;
  tempPath: string;
  tempMaskPath?: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface EditOptions {
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  resize?: {
    width: number;
    height: number;
  };
  mask?: {
    data: Buffer; // PNG buffer for mask image
  };
}

/**
 * Temporary image file management service
 * - Creates temporary edited images for API transmission
 * - Auto-cleanup after expiration (default: 30 minutes)
 * - Never modifies original images
 */
export class TempImageService {
  private static tempDir = path.join(runtimePaths.tempDir, 'canvas');
  private static canvasDir = path.join(runtimePaths.tempDir, 'canvas');
  private static DEFAULT_EXPIRATION_MINUTES = 30;

  // In-memory storage for temp file metadata
  private static tempFiles = new Map<string, TempImageInfo>();

  /**
   * Initialize temp directory and subdirectories
   */
  static async initialize(): Promise<void> {
    try {
      // Create main temp directory
      await fs.promises.mkdir(this.tempDir, { recursive: true });
      console.log(`✅ Temp image directory initialized: ${this.tempDir}`);

      // Create canvas subdirectory for edited images
      await fs.promises.mkdir(this.canvasDir, { recursive: true });
      console.log(`✅ Canvas directory initialized: ${this.canvasDir}`);

      // Cleanup any existing temp files on startup
      await this.cleanupAll();
    } catch (error) {
      console.error('Failed to initialize temp directory:', error);
      throw error;
    }
  }

  /**
   * Create temporary image ID
   */
  static createTempId(): string {
    return `temp_${uuidv4()}`;
  }

  /**
   * Get temp file path
   * Edited images are saved to canvas subdirectory
   */
  static getTempFilePath(tempId: string, type: 'image' | 'mask' = 'image'): string {
    const suffix = type === 'mask' ? '_mask.png' : '.png';
    // Save edited images to canvas directory
    return path.join(this.canvasDir, `${tempId}${suffix}`);
  }

  /**
   * Register temporary file
   */
  static registerTempFile(
    tempId: string,
    originalImageId: number,
    tempPath: string,
    tempMaskPath?: string,
    expirationMinutes: number = this.DEFAULT_EXPIRATION_MINUTES
  ): TempImageInfo {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expirationMinutes * 60 * 1000);

    const tempInfo: TempImageInfo = {
      id: tempId,
      originalImageId,
      tempPath,
      tempMaskPath,
      expiresAt,
      createdAt: now
    };

    this.tempFiles.set(tempId, tempInfo);
    return tempInfo;
  }

  /**
   * Get temporary file info
   */
  static getTempFileInfo(tempId: string): TempImageInfo | undefined {
    return this.tempFiles.get(tempId);
  }

  /**
   * Check if temp file exists
   */
  static async exists(tempPath: string): Promise<boolean> {
    try {
      await fs.promises.access(tempPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete temporary file(s)
   */
  static async deleteTempFile(tempId: string): Promise<void> {
    const tempInfo = this.tempFiles.get(tempId);

    if (!tempInfo) {
      console.warn(`Temp file not found in registry: ${tempId}`);
      return;
    }

    // DeletionService를 사용하여 파일 삭제
    const { DeletionService } = await import('./deletionService');

    const filesToDelete = [tempInfo.tempPath];
    if (tempInfo.tempMaskPath) {
      filesToDelete.push(tempInfo.tempMaskPath);
    }

    for (const filePath of filesToDelete) {
      try {
        await DeletionService.deleteTempFile(filePath);
        console.log(`✅ Deleted temp file: ${path.basename(filePath)}`);
      } catch (error) {
        console.error(`Failed to delete temp file: ${filePath}`, error);
      }
    }

    // Remove from registry
    this.tempFiles.delete(tempId);
  }

  /**
   * Cleanup expired temporary files
   */
  static async cleanupExpired(): Promise<{ deleted: number; errors: number }> {
    const now = new Date();
    let deleted = 0;
    let errors = 0;

    console.log(`🧹 Starting temp file cleanup...`);

    for (const [tempId, tempInfo] of this.tempFiles.entries()) {
      if (tempInfo.expiresAt <= now) {
        try {
          await this.deleteTempFile(tempId);
          deleted++;
        } catch (error) {
          console.error(`Failed to cleanup expired temp file: ${tempId}`, error);
          errors++;
        }
      }
    }

    console.log(`✅ Temp file cleanup complete: ${deleted} deleted, ${errors} errors`);
    return { deleted, errors };
  }

  /**
   * Cleanup all temporary files (for startup/shutdown)
   * @param skipCanvas - If true, skip cleaning canvas directory (default: false)
   */
  static async cleanupAll(skipCanvas: boolean = false): Promise<void> {
    try {
      // Clean main temp directory
      const files = await fs.promises.readdir(this.tempDir);

      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        try {
          const stat = await fs.promises.stat(filePath);
          if (stat.isDirectory()) {
            // Skip subdirectories (like canvas)
            continue;
          }
          await fs.promises.unlink(filePath);
        } catch (error) {
          console.error(`Failed to delete temp file: ${file}`, error);
        }
      }

      // Clean canvas subdirectory (unless skipCanvas is true)
      if (!skipCanvas) {
        try {
          const canvasFiles = await fs.promises.readdir(this.canvasDir);
          for (const file of canvasFiles) {
            const filePath = path.join(this.canvasDir, file);
            try {
              await fs.promises.unlink(filePath);
            } catch (error) {
              console.error(`Failed to delete canvas file: ${file}`, error);
            }
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.error('Failed to cleanup canvas directory:', error);
          }
        }
      } else {
        console.log('⏭️  Skipping canvas directory cleanup (user setting)');
      }

      // Clear registry
      this.tempFiles.clear();
      console.log(`✅ All temp files cleaned up${skipCanvas ? ' (canvas folder preserved)' : ''}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Failed to cleanup temp directory:', error);
      }
    }
  }

  /**
   * Get all temporary file info (for debugging)
   */
  static getAllTempFiles(): TempImageInfo[] {
    return Array.from(this.tempFiles.values());
  }

  /**
   * Get statistics
   */
  static getStats(): {
    total: number;
    expired: number;
    active: number;
  } {
    const now = new Date();
    const all = Array.from(this.tempFiles.values());
    const expired = all.filter(t => t.expiresAt <= now).length;

    return {
      total: all.length,
      expired,
      active: all.length - expired
    };
  }
}
