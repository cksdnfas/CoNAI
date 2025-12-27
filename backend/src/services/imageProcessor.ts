import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { ImageMetadata, AITool, LoRAModel } from '../types/image';
import { ImageSimilarityService } from './imageSimilarity';
import { settingsService } from './settingsService';
import { MetadataExtractor } from './metadata';
import { logger } from '../utils/logger';

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
  private static normalizeRelativePath(targetPath: string, basePath: string): string {
    return path.relative(basePath, targetPath).replace(/\\/g, '/');
  }

  /**
   * 날짜 기반 폴더 경로 생성
   */
  static getDateFolder(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    const random = Math.random().toString(36).substring(2, 8);

    // 유니코드 정규화 및 안전한 파일명 처리
    const { normalizeFilename } = require('../utils/pathResolver');
    const safeOriginalName = normalizeFilename(originalName);

    // 확장자 분리
    const ext = path.extname(safeOriginalName);
    const nameWithoutExt = path.basename(safeOriginalName, ext);

    // 타임스탬프_랜덤값_원본파일명.확장자 형식
    return `${year}${month}${day}_${hour}${minute}${second}_${random}_${nameWithoutExt}${ext}`;
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
   */
  static async generateThumbnail(
    inputPath: string,
    outputPath: string,
    customSize?: number
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

    const pipeline = sharp(inputPath);

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
    const image = sharp(filePath);
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

    try {
      // 폴더 구조 생성
      const folderStart = Date.now();
      const folders = await this.createUploadFolders(baseUploadPath);
      logger.debug(`⏱️ [ImageProcessor] Folder creation: ${Date.now() - folderStart}ms`);

      // 고유한 파일명 생성
      const filename = this.generateUniqueFilename(file.originalname);
      const originalPath = path.join(folders.targetFolder, filename);

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

      const relativeOriginal = this.normalizeRelativePath(originalPath, baseUploadPath);

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

  /**
   * 기존 이미지 파일 처리 (ComfyUI 등에서 생성된 이미지용)
   * 이미 uploads 디렉토리에 저장된 파일을 데이터베이스에 등록
   * @param relativePath uploads 디렉토리 기준 상대 경로
   * @param additionalMetadata 추가 메타데이터 (ai_tool, prompt 등)
   * @returns 생성된 이미지 ID
   */
  async processExistingImage(
    relativePath: string,
    additionalMetadata?: Partial<ImageMetadata['ai_info']>
  ): Promise<number> {
    const { resolveUploadsPath } = await import('../config/runtimePaths');
    const { ImageModel } = await import('../models/Image');

    try {
      const fullPath = resolveUploadsPath(relativePath);

      if (!fs.existsSync(fullPath)) {
        throw new Error(`Image file not found: ${relativePath}`);
      }

      // 파일 정보 가져오기
      const stats = await fs.promises.stat(fullPath);
      const imageInfo = await ImageProcessor.getImageInfo(fullPath);

      // 메타데이터 추출
      const metadata = await ImageProcessor.extractMetadata(fullPath);

      // 추가 메타데이터 병합
      if (additionalMetadata) {
        metadata.ai_info = {
          ...metadata.ai_info,
          ...additionalMetadata
        };
      }

      // 썸네일 생성 (같은 폴더에)
      const ext = path.extname(relativePath);
      const basename = path.basename(relativePath, ext);
      const dirname = path.dirname(relativePath);

      const thumbnailRelativePath = path.join(dirname, `${basename}_thumb.webp`);

      const thumbnailPath = resolveUploadsPath(thumbnailRelativePath);

      // 썸네일 생성
      await ImageProcessor.generateThumbnail(fullPath, thumbnailPath);

      const aiInfo = metadata.ai_info || {};

      // 데이터베이스에 저장
      const imageId = await ImageModel.create({
        filename: path.basename(relativePath),
        original_name: path.basename(relativePath),
        file_path: relativePath.replace(/\\/g, '/'),
        thumbnail_path: thumbnailRelativePath.replace(/\\/g, '/'),
        file_size: stats.size,
        mime_type: 'image/' + ext.substring(1),
        width: imageInfo.width,
        height: imageInfo.height,
        metadata: JSON.stringify(metadata),

        // AI 메타데이터 필드들
        ai_tool: aiInfo.ai_tool || null,
        model_name: aiInfo.model || null,
        lora_models: aiInfo.lora_models ? JSON.stringify(aiInfo.lora_models) : null,
        steps: aiInfo.steps || null,
        cfg_scale: aiInfo.cfg_scale || null,
        sampler: aiInfo.sampler || null,
        seed: aiInfo.seed || null,
        scheduler: aiInfo.scheduler || null,
        prompt: aiInfo.prompt || null,
        negative_prompt: aiInfo.negative_prompt || null,
        denoise_strength: aiInfo.denoise_strength || null,
        generation_time: aiInfo.generation_time || null,
        batch_size: aiInfo.batch_size || null,
        batch_index: aiInfo.batch_index || null,
        auto_tags: null,

        // 동영상 메타데이터 필드들 (이미지는 null)
        duration: null,
        fps: null,
        video_codec: null,
        audio_codec: null,
        bitrate: null,

        // 유사도 검색 필드들 (기존 이미지는 나중에 생성 가능)
        perceptual_hash: null,
        color_histogram: null
      });

      return imageId;
    } catch (error) {
      logger.error('Failed to process existing image:', error);
      throw error instanceof Error ? error : new Error('Unknown error occurred while processing existing image');
    }
  }

  /**
   * 파일 삭제
   *
   * @deprecated Use DeletionService.deleteImageWithThumbnail() instead
   *             통합 삭제 서비스(DeletionService)를 사용하세요.
   *             - RecycleBin 지원
   *             - composite_hash 중복 검사
   *             - 일관된 에러 핸들링
   */
  static async deleteImageFiles(
    originalPath: string,
    thumbnailPath: string,
    baseUploadPath: string
  ): Promise<void> {
    // DeletionService로 위임
    const { DeletionService } = await import('./deletionService');
    await DeletionService.deleteImageWithThumbnail(originalPath, thumbnailPath);
  }
}