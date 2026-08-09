import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { ImageMetadata, AITool, LoRAModel } from '../types/image';
import { ImageSimilarityService } from './imageSimilarity';
import { settingsService } from './settingsService';
import { MetadataExtractor } from './metadata';
import { logger } from '../utils/logger';
import { getDateFolder, generateUniqueOriginalFilename, normalizeRelativePath } from '../utils/mediaStoragePaths';
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
   * 원본 파일명 기반으로 고유한 파일명 생성
   * 중복 방지를 위해 타임스탬프와 랜덤 문자열을 파일명 앞에 추가
   *
   * @param originalName 원본 파일명 (예: "한글 테스트.png")
   * @returns 고유한 파일명 (예: "20250109_143025_abc123_한글 테스트.png")
   */
  static generateUniqueFilename(originalName: string): string {
    return generateUniqueOriginalFilename(originalName);
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
    sourceImage?: sharp.Sharp
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
      .toFile(outputPath);
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

      // 고유한 파일명 생성
      const filename = this.generateUniqueFilename(file.originalname);
      const originalPath = path.join(folders.targetFolder, filename);
      storedFilePath = originalPath;

      // diskStorage 사용: file.path에서 임시 파일 읽기
      // memoryStorage 사용: file.buffer 사용 (하위 호환성)
      const copyStart = Date.now();
      if (file.path) {
        // diskStorage: 임시 파일 복사
        tempFilePath = file.path;
        await fs.promises.copyFile(file.path, originalPath);
      } else if (file.buffer) {
        // memoryStorage (레거시): 버퍼에서 저장
        await fs.promises.writeFile(originalPath, file.buffer);
      } else {
        throw new Error('No file data available (neither path nor buffer)');
      }
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
