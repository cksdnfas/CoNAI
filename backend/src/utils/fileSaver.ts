import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { ImageSimilarityService } from '../services/imageSimilarity';
import { ImageMetadataWriteService, type ImageOutputFormat } from '../services/imageMetadataWriteService';
import { VideoProcessor } from '../services/videoProcessor';
import { runtimePaths } from '../config/runtimePaths';
import { generateFileHash } from './fileHash';

export type GeneratedImageSaveOptions = {
  format?: 'original' | ImageOutputFormat;
  quality?: number;
  resizeEnabled?: boolean;
  maxWidth?: number;
  maxHeight?: number;
  sourcePathForMetadata?: string;
  sourceMimeType?: string;
  originalFileName?: string;
};

/**
 * API 생성 이미지 파일 저장 유틸리티
 * 업로드 페이지와 동일한 파일 저장 로직 사용
 */
type SavedGeneratedMedia = {
  originalPath: string;
  fileSize: number;
  width: number;
  height: number;
  compositeHash: string;
  mimeType?: string;
};

export class FileSaver {
  /** Resolve an output image format from explicit options or the source mime/path. */
  private static resolveOutputFormat(options?: GeneratedImageSaveOptions): ImageOutputFormat {
    if (options?.format && options.format !== 'original') {
      return options.format;
    }

    const normalizedMime = (options?.sourceMimeType || '').toLowerCase();
    const extension = options?.sourcePathForMetadata ? path.extname(options.sourcePathForMetadata).toLowerCase() : '';

    if (normalizedMime === 'image/jpeg' || extension === '.jpg' || extension === '.jpeg') {
      return 'jpeg';
    }

    if (normalizedMime === 'image/webp' || extension === '.webp') {
      return 'webp';
    }

    return 'png';
  }

  /**
   * 날짜 기반 폴더 경로 생성 (YYYY-MM-DD)
   */
  private static getDateFolder(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 고유한 파일명 생성 (년도_월_일_시분초_랜덤문자열.png)
   */
  private static generateUniqueFilename(extension: string = 'png'): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    const random = Math.random().toString(36).substring(2, 8);

    return `${year}_${month}_${day}_${hour}${minute}${second}_${random}.${extension}`;
  }

  /**
   * 상대 경로 정규화 (uploads 디렉토리 기준)
   */
  private static normalizeRelativePath(fullPath: string): string {
    const uploadsDir = runtimePaths.uploadsDir;
    return path.relative(uploadsDir, fullPath).replace(/\\/g, '/');
  }

  private static resolveMimeTypeFromPath(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();

    switch (extension) {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      case '.webp':
        return 'image/webp';
      case '.gif':
        return 'image/gif';
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

  private static isStaticImageMimeType(mimeType: string): boolean {
    return mimeType.startsWith('image/') && mimeType !== 'image/gif';
  }

  /**
   * API 생성 이미지를 uploads/API/images/YYYY-MM-DD/ 폴더에 저장
   *
   * @param imageBuffer - 이미지 버퍼
   * @param serviceType - 서비스 타입 ('comfyui' | 'novelai')
   * @returns 저장된 파일 정보
   */
  static async saveGeneratedImage(
    imageBuffer: Buffer,
    serviceType: 'comfyui' | 'novelai',
    options?: GeneratedImageSaveOptions,
  ): Promise<SavedGeneratedMedia> {
    try {
      const dateFolder = this.getDateFolder();
      const dateFolderPath = path.join(runtimePaths.uploadsDir, 'API', 'images', dateFolder);

      await fs.promises.mkdir(dateFolderPath, { recursive: true });

      const outputFormat = this.resolveOutputFormat(options);
      const outputExtension = outputFormat === 'jpeg' ? 'jpg' : outputFormat;
      const filename = this.generateUniqueFilename(outputExtension);
      const fullPath = path.join(dateFolderPath, filename);

      const hasTransformOptions = Boolean(
        options
        && (
          options.format !== undefined
          || options.resizeEnabled !== undefined
          || options.quality !== undefined
          || options.maxWidth !== undefined
          || options.maxHeight !== undefined
        )
      );

      let outputBuffer = imageBuffer;
      let width = 0;
      let height = 0;

      if (hasTransformOptions) {
        const rewritten = await ImageMetadataWriteService.writeBufferAsFormatBuffer(imageBuffer, {
          format: outputFormat,
          quality: options?.quality,
          sourcePathForMetadata: options?.sourcePathForMetadata,
          originalFileName: options?.originalFileName,
          mimeType: options?.sourceMimeType,
          maxWidth: options?.resizeEnabled ? options.maxWidth : undefined,
          maxHeight: options?.resizeEnabled ? options.maxHeight : undefined,
        });

        outputBuffer = rewritten.buffer;
        width = rewritten.info.width || 0;
        height = rewritten.info.height || 0;
      } else {
        const metadata = await sharp(imageBuffer).metadata();
        width = metadata.width || 0;
        height = metadata.height || 0;
      }

      await fs.promises.writeFile(fullPath, outputBuffer);

      const { hashes } = await ImageSimilarityService.generateHashAndHistogram(fullPath);
      const compositeHash = hashes.compositeHash;

      const stats = await fs.promises.stat(fullPath);
      const relativePath = this.normalizeRelativePath(fullPath);

      return {
        originalPath: relativePath,
        fileSize: stats.size,
        width,
        height,
        compositeHash,
        mimeType: options?.sourceMimeType,
      };
    } catch (error) {
      console.error(`[FileSaver] ${serviceType} 이미지 저장 실패:`, error);
      throw new Error(`Failed to save generated image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * API 생성 결과 파일을 media 종류에 맞게 저장한다.
   * 정적 이미지는 기존 이미지 저장 파이프라인을, 영상/애니메이션은 원본 보존 저장을 사용한다.
   */
  static async saveGeneratedFile(
    sourceFilePath: string,
    serviceType: 'comfyui' | 'novelai',
    options?: GeneratedImageSaveOptions,
  ): Promise<SavedGeneratedMedia> {
    const sourceMimeType = (options?.sourceMimeType || this.resolveMimeTypeFromPath(sourceFilePath)).toLowerCase();

    if (this.isStaticImageMimeType(sourceMimeType)) {
      const imageBuffer = await fs.promises.readFile(sourceFilePath);
      return this.saveGeneratedImage(imageBuffer, serviceType, {
        ...options,
        sourcePathForMetadata: options?.sourcePathForMetadata || sourceFilePath,
        sourceMimeType,
        originalFileName: options?.originalFileName || path.basename(sourceFilePath),
      });
    }

    try {
      const dateFolder = this.getDateFolder();
      const targetDir = path.join(runtimePaths.uploadsDir, 'videos', 'API', dateFolder);
      await fs.promises.mkdir(targetDir, { recursive: true });

      const sourceExtension = path.extname(sourceFilePath) || '.bin';
      const filename = this.generateUniqueFilename(sourceExtension.replace(/^\./, ''));
      const fullPath = path.join(targetDir, filename);

      await fs.promises.copyFile(sourceFilePath, fullPath);

      const stats = await fs.promises.stat(fullPath);
      const compositeHash = await generateFileHash(fullPath);
      const relativePath = this.normalizeRelativePath(fullPath);

      let width = 0;
      let height = 0;
      try {
        const metadata = await VideoProcessor.extractMetadata(fullPath);
        width = metadata.width || 0;
        height = metadata.height || 0;
      } catch (metadataError) {
        console.warn(`[FileSaver] ${serviceType} media metadata fallback for ${path.basename(fullPath)}:`, metadataError);
      }

      return {
        originalPath: relativePath,
        fileSize: stats.size,
        width,
        height,
        compositeHash,
        mimeType: sourceMimeType,
      };
    } catch (error) {
      console.error(`[FileSaver] ${serviceType} media 저장 실패:`, error);
      throw new Error(`Failed to save generated media: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
