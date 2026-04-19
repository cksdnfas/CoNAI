import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { ImageProcessor } from './imageProcessor';
import { FileSaver, type GeneratedImageSaveOptions } from '../utils/fileSaver';
import { runtimePaths } from '../config/runtimePaths';

export class APIImageProcessor {
  private static readonly THUMBNAIL_SIZE = 1080;
  private static readonly THUMBNAIL_QUALITY = 80;
  private static readonly OPTIMIZED_QUALITY = 95;

  /**
   * Get base upload path for API images
   */
  private static getBaseUploadPath(): string {
    return path.join(runtimePaths.uploadsDir, 'API');
  }

  static async createUploadFolders(): Promise<{
    dateFolder: string;
    originFolder: string;
  }> {
    const baseUploadPath = this.getBaseUploadPath();
    const dateFolder = ImageProcessor.getDateFolder();
    const imagesPath = path.join(baseUploadPath, 'images');
    const dateFolderPath = path.join(imagesPath, dateFolder);

    const originFolder = dateFolderPath;

    // Create directories
    await fs.promises.mkdir(originFolder, { recursive: true });

    return {
      dateFolder: path.join('API', 'images', dateFolder),
      originFolder
    };
  }

  /**
   * Generate unique filename
   */
  private static generateUniqueFilename(extension: string = '.png'): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    const uuid = uuidv4().split('-')[0]; // First segment of UUID

    return `${year}_${month}_${day}_${hour}${minute}${second}_${uuid}${extension}`;
  }

  /**
   * Process generated image from buffer - SIMPLIFIED VERSION
   * Saves ONLY original file to uploads/API/images/YYYY-MM-DD/
   * Thumbnail version will be created by background scan
   *
   * @param imageBuffer - Image buffer from API response
   * @param serviceType - 'comfyui' or 'novelai'
   * @returns Original image path and metadata
   */
  static async processGeneratedImage(
    imageBuffer: Buffer,
    serviceType: 'comfyui' | 'novelai',
    saveOptions?: GeneratedImageSaveOptions,
  ): Promise<{
    originalPath: string;
    fileSize: number;
    width: number;
    height: number;
    compositeHash: string;
    mimeType?: string;
  }> {
    try {
      // Use FileSaver to save original file only
      // Background scan will handle thumbnail/optimization
      return await FileSaver.saveGeneratedImage(imageBuffer, serviceType, saveOptions);
    } catch (error) {
      console.error('API Image processing failed:', error);
      throw new Error(`Failed to process ${serviceType} generated image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Process generated output file from an already-downloaded Comfy result.
   * Static images keep the existing image pipeline, while videos/animated outputs
   * are preserved as original media files.
   */
  static async processGeneratedFile(
    sourceFilePath: string,
    serviceType: 'comfyui' | 'novelai',
    saveOptions?: GeneratedImageSaveOptions,
  ): Promise<{
    originalPath: string;
    fileSize: number;
    width: number;
    height: number;
    compositeHash: string;
    mimeType?: string;
  }> {
    try {
      return await FileSaver.saveGeneratedFile(sourceFilePath, serviceType, saveOptions);
    } catch (error) {
      console.error('API generated file processing failed:', error);
      throw new Error(`Failed to process ${serviceType} generated output: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete generated images
   *
   * @deprecated Use DeletionService.deleteGeneratedImages() instead
   */
  static async deleteGeneratedImages(paths: {
    originalPath: string;
    thumbnailPath?: string;
  }): Promise<void> {
    // DeletionService로 위임
    const { DeletionService } = await import('./deletionService');
    await DeletionService.deleteGeneratedImages(paths);
  }

  /**
   * Extract metadata from generated image buffer (ComfyUI only)
   * Uses existing ImageProcessor.extractMetadata() logic
   *
   * @param imageBuffer - Image buffer from ComfyUI
   * @param serviceType - 'comfyui' or 'novelai'
   * @returns Extracted metadata (prompt, negative_prompt, width, height, etc.)
   */
  static async extractMetadataFromBuffer(
    imageBuffer: Buffer,
    serviceType: 'comfyui' | 'novelai'
  ): Promise<{
    positive_prompt?: string;
    negative_prompt?: string;
    width?: number;
    height?: number;
    metadata: any;
  }> {
    // NovelAI history is now kept minimal, so skip history-side metadata extraction here.
    if (serviceType === 'novelai') {
      return { metadata: {} };
    }

    let tempPath: string | null = null;

    try {
      // 1. Buffer를 임시 파일로 저장
      const tempDir = runtimePaths.tempDir;
      await fs.promises.mkdir(tempDir, { recursive: true });

      tempPath = path.join(tempDir, `metadata_extract_${Date.now()}.png`);
      await fs.promises.writeFile(tempPath, imageBuffer);

      // 2. ImageProcessor.extractMetadata() 호출
      const extractedMetadata = await ImageProcessor.extractMetadata(tempPath);

      // 3. Sharp로 이미지 크기 추출
      const image = sharp(imageBuffer);
      const imageMetadata = await image.metadata();

      // 4. 필요한 필드 추출
      const aiInfo: any = extractedMetadata.ai_info || {};

      return {
        positive_prompt: aiInfo.prompt || aiInfo.positive_prompt,
        negative_prompt: aiInfo.negative_prompt,
        width: imageMetadata.width || aiInfo.width,
        height: imageMetadata.height || aiInfo.height,
        metadata: {
          ...aiInfo,
          extractedAt: extractedMetadata.extractedAt
        }
      };
    } catch (error) {
      console.error('Failed to extract metadata from buffer:', error);
      return {
        metadata: {
          error: 'Metadata extraction failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    } finally {
      // 4. 임시 파일 삭제
      if (tempPath && fs.existsSync(tempPath)) {
        try {
          await fs.promises.unlink(tempPath);
        } catch (cleanupError) {
          console.warn('Failed to cleanup temp metadata file:', tempPath, cleanupError);
        }
      }
    }
  }

  /**
   * Ensure API upload directories exist
   * Called on server startup
   */
  static async ensureDirectories(): Promise<void> {
    const baseUploadPath = this.getBaseUploadPath();
    const imagesPath = path.join(baseUploadPath, 'images');
    const videosPath = path.join(runtimePaths.uploadsDir, 'videos', 'API');

    await fs.promises.mkdir(imagesPath, { recursive: true });
    await fs.promises.mkdir(videosPath, { recursive: true });
  }
}
