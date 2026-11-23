import sharp, { type Sharp } from 'sharp';
import path from 'path';
import fs from 'fs';
import { ImageMetadata, AITool, LoRAModel } from '../types/image';
import { ImageSimilarityService } from './imageSimilarity';
import { settingsService } from './settingsService';
import { MetadataExtractor } from './metadata';
import { logger } from '../utils/logger';
import { getDateFolder, normalizeRelativePath } from '../utils/mediaStoragePaths';
import { exclusiveWrites, writeMediaFileWithUniqueName } from '../utils/mediaFileNames';
import { toWindowsLongPathIfNeeded } from '../utils/pathResolver';

export interface ProcessedImage {
  filename: string;
  originalPath: string;
  thumbnailPath: string;
  width: number;
  height: number;
  fileSize: number;
  metadata: ImageMetadata;
  perceptualHash?: string;
  colorHistogram?: string;
}

export class ImageProcessor {
  /**
   * 날짜 기반 폴더 경로 생성
   */
  static getDateFolder(): string {
    return getDateFolder();
  }

  static async createUploadFolders(baseUploadPath: string): Promise<{
    dateFolder: string;
    targetFolder: string;
  }> {
    const dateFolder = this.getDateFolder();
    // 이미지는 images 서브폴더 사용
    const imagesPath = path.join(baseUploadPath, 'images');
    const targetFolder = path.join(imagesPath, dateFolder);

    // 폴더 생성 (Origin, thumbnails만 사용)
    await fs.promises.mkdir(targetFolder, { recursive: true });

    return {
      dateFolder: path.join('images', dateFolder),
      targetFolder
    };
  }

  /**
   * AI 생성 이미지 메타데이터 추출 (ComfyUI/NovelAI/Stable Diffusion 등)
   * Delegates to MetadataExtractor for unified extraction
   */
  static async extractMetadata(filePath: string): Promise<ImageMetadata> {
    return await MetadataExtractor.extractMetadata(filePath);
  }

  /**
   * 썸네일 생성
   * @param sourceImage 재사용할 sharp 인스턴스 (없으면 inputPath로 생성)
   */
  static async generateThumbnail(
    inputPath: string,
    outputPath: string,
    customSize?: number,
    sourceImage?: Sharp
  ): Promise<void> {
    // Load settings
    const settings = settingsService.loadSettings();
    const { size: sizeOption, quality } = settings.thumbnail;

    // Determine thumbnail size
    let targetSize: number | undefined;
    if (customSize !== undefined) {
      targetSize = customSize;
    } else if (sizeOption === 'original') {
      // For 'original', don't resize - use original dimensions
      targetSize = undefined;
    } else {
      targetSize = parseInt(sizeOption, 10);
    }

    const pipeline = sourceImage
      ? sourceImage.clone()
      : sharp(toWindowsLongPathIfNeeded(inputPath));

    // Only resize if targetSize is specified
    if (targetSize !== undefined) {
      pipeline.resize(targetSize, targetSize, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }

    // Convert to WebP with configured quality
    await pipeline
      .webp({
        quality: quality,
        effort: 4
      })
      .toFile(toWindowsLongPathIfNeeded(outputPath));
  }


  /**
   * 이미지 정보 얻기
   */
  static async getImageInfo(filePath: string): Promise<{
    width: number;
    height: number;
    format: string;
  }> {
    const sharpInputPath = toWindowsLongPathIfNeeded(filePath);
    const image = sharp(sharpInputPath);
    const metadata = await image.metadata();

    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
      format: metadata.format || 'unknown'
    };
  }

  /**
   * 메인 이미지 처리 함수 (단순화: 파일 저장만)
   * diskStorage 사용 시 file.path에서 임시 파일을 읽어 처리하고 정리함
   */
  static async processImage(
    file: Express.Multer.File,
    baseUploadPath: string
  ): Promise<ProcessedImage> {
    const startTime = Date.now();
    logger.debug(`⏱️ [ImageProcessor] Starting image upload: ${file.originalname}`);

    let tempFilePath: string | undefined;
    let storedFilePath: string | undefined;

    try {
      // 폴더 구조 생성
      const folderStart = Date.now();
      const folders = await this.createUploadFolders(baseUploadPath);
      logger.debug(`⏱️ [ImageProcessor] Folder creation: ${Date.now() - folderStart}ms`);

      // diskStorage: file.path의 임시 파일을 복사, memoryStorage(레거시): file.buffer를 저장.
      // 이름은 업로드 이름 규칙으로 폴더 안에서 겹치지 않게 정하고, 쓰기는 기존 파일을 덮지 않는다.
      const copyStart = Date.now();
      if (file.path) tempFilePath = file.path;
      else if (!file.buffer) throw new Error('No file data available (neither path nor buffer)');
      const originalPath = await writeMediaFileWithUniqueName(
        { directory: folders.targetFolder, extension: path.extname(file.originalname), kind: 'upload', originalName: file.originalname },
        file.path ? exclusiveWrites.copy(file.path) : exclusiveWrites.bytes(file.buffer),
      );
      const filename = path.basename(originalPath);
      storedFilePath = originalPath;
      logger.debug(`⏱️ [ImageProcessor] File copy: ${Date.now() - copyStart}ms`);

      // 이미지 기본 정보만 추출 (width, height)
      const infoStart = Date.now();
      const imageInfo = await this.getImageInfo(originalPath);
      logger.debug(`⏱️ [ImageProcessor] Image info extraction: ${Date.now() - infoStart}ms`);

      const relativeOriginal = normalizeRelativePath(originalPath, baseUploadPath);

      const totalTime = Date.now() - startTime;
      logger.debug(`⏱️ [ImageProcessor] ✅ Total upload time: ${totalTime}ms`);

      // 단순화된 반환값 (파일 저장 정보만)
      return {
        filename,
        originalPath: relativeOriginal,
        thumbnailPath: '', // 스캔 시 생성
        width: imageInfo.width,
        height: imageInfo.height,
        fileSize: file.size,
        metadata: { ai_info: {} } as ImageMetadata, // 스캔 시 추출
        perceptualHash: undefined, // 스캔 시 생성
        colorHistogram: undefined // 스캔 시 생성
      };
    } catch (error) {
      logger.error(`⏱️ [ImageProcessor] ❌ Failed after ${Date.now() - startTime}ms:`, error);
      if (storedFilePath) {
        try {
          await fs.promises.unlink(storedFilePath);
        } catch (cleanupError) {
          if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
            logger.warn('Failed to cleanup invalid stored image:', storedFilePath, cleanupError);
          }
        }
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Image upload failed: ${message}`);
    } finally {
      // 임시 파일 정리 (diskStorage 사용 시)
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          await fs.promises.unlink(tempFilePath);
        } catch (cleanupError) {
          logger.warn('Failed to cleanup temp file:', tempFilePath, cleanupError);
        }
      }
    }
  }

}
