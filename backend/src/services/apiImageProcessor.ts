import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { ImageProcessor } from './imageProcessor';

/**
 * API Image Processor
 * Reuses existing ImageProcessor logic but stores images in uploads/API/images/
 * Used exclusively for API generation history (ComfyUI, NovelAI)
 */
export class APIImageProcessor {
  private static readonly THUMBNAIL_SIZE = 1080;
  private static readonly THUMBNAIL_QUALITY = 80;
  private static readonly OPTIMIZED_QUALITY = 95;

  /**
   * Get base upload path for API images
   */
  private static getBaseUploadPath(): string {
    return path.join(process.cwd(), 'uploads', 'API');
  }

  /**
   * Create folder structure for API images
   * Path: uploads/API/images/YYYY-MM-DD/origin|thumbnails|optimized/
   */
  static async createUploadFolders(): Promise<{
    dateFolder: string;
    originFolder: string;
    thumbnailFolder: string;
    optimizedFolder: string;
  }> {
    const baseUploadPath = this.getBaseUploadPath();
    const dateFolder = ImageProcessor.getDateFolder();
    const imagesPath = path.join(baseUploadPath, 'images');
    const dateFolderPath = path.join(imagesPath, dateFolder);

    const originFolder = path.join(dateFolderPath, 'origin');
    const thumbnailFolder = path.join(dateFolderPath, 'thumbnails');
    const optimizedFolder = path.join(dateFolderPath, 'optimized');

    // Create directories
    await fs.promises.mkdir(originFolder, { recursive: true });
    await fs.promises.mkdir(thumbnailFolder, { recursive: true });
    await fs.promises.mkdir(optimizedFolder, { recursive: true });

    return {
      dateFolder: path.join('API', 'images', dateFolder),
      originFolder,
      thumbnailFolder,
      optimizedFolder
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
   * Process generated image from buffer
   * Creates: original, thumbnail, optimized versions
   *
   * @param imageBuffer - Image buffer from API response
   * @param serviceType - 'comfyui' or 'novelai'
   * @returns Image paths and file size
   */
  static async processGeneratedImage(
    imageBuffer: Buffer,
    serviceType: 'comfyui' | 'novelai'
  ): Promise<{
    originalPath: string;
    thumbnailPath: string;
    optimizedPath: string;
    fileSize: number;
    width: number;
    height: number;
  }> {
    try {
      // Create folder structure
      const folders = await this.createUploadFolders();

      // Get image metadata
      const image = sharp(imageBuffer);
      const metadata = await image.metadata();
      const width = metadata.width || 0;
      const height = metadata.height || 0;

      // Generate unique filename
      const filename = this.generateUniqueFilename('.png');

      // Define paths
      const originalPath = path.join(folders.originFolder, filename);
      const thumbnailFilename = filename.replace('.png', '.webp');
      const thumbnailPath = path.join(folders.thumbnailFolder, thumbnailFilename);
      const optimizedPath = path.join(folders.optimizedFolder, filename.replace('.png', '.webp'));

      // Save original image
      await fs.promises.writeFile(originalPath, imageBuffer);

      // Generate thumbnail (max 1080px, maintaining aspect ratio)
      await sharp(imageBuffer)
        .resize(this.THUMBNAIL_SIZE, this.THUMBNAIL_SIZE, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .webp({ quality: this.THUMBNAIL_QUALITY, effort: 4 })
        .toFile(thumbnailPath);

      // Generate optimized WebP version
      await sharp(imageBuffer)
        .webp({ quality: this.OPTIMIZED_QUALITY })
        .toFile(optimizedPath);

      // Get file size
      const stats = await fs.promises.stat(originalPath);
      const fileSize = stats.size;

      // Return normalized paths relative to uploads directory
      const uploadsBase = path.join(process.cwd(), 'uploads');

      return {
        originalPath: path.relative(uploadsBase, originalPath).replace(/\\/g, '/'),
        thumbnailPath: path.relative(uploadsBase, thumbnailPath).replace(/\\/g, '/'),
        optimizedPath: path.relative(uploadsBase, optimizedPath).replace(/\\/g, '/'),
        fileSize,
        width,
        height
      };
    } catch (error) {
      console.error('API Image processing failed:', error);
      throw new Error(`Failed to process ${serviceType} generated image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete generated images (all versions)
   */
  static async deleteGeneratedImages(paths: {
    originalPath: string;
    thumbnailPath: string;
    optimizedPath: string;
  }): Promise<void> {
    const uploadsBase = path.join(process.cwd(), 'uploads');

    const deleteFile = async (relativePath: string) => {
      try {
        const fullPath = path.join(uploadsBase, relativePath);
        if (fs.existsSync(fullPath)) {
          await fs.promises.unlink(fullPath);
        }
      } catch (error) {
        console.warn(`Failed to delete file: ${relativePath}`, error);
      }
    };

    await Promise.all([
      deleteFile(paths.originalPath),
      deleteFile(paths.thumbnailPath),
      deleteFile(paths.optimizedPath)
    ]);
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
    // NovelAI는 이미 createNAIHistory()에서 메타데이터 저장됨
    if (serviceType === 'novelai') {
      return { metadata: {} };
    }

    let tempPath: string | null = null;

    try {
      // 1. Buffer를 임시 파일로 저장
      const tempDir = path.join(process.cwd(), 'temp');
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

    await fs.promises.mkdir(imagesPath, { recursive: true });
    console.log('✓ API upload directories ready');
  }
}
