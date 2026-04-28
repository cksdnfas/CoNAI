import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { ImageSimilarityService } from '../services/imageSimilarity';
import { ImageMetadataWriteService, type ImageOutputFormat } from '../services/imageMetadataWriteService';
import type { AIMetadata } from '../services/metadata/types';
import { settingsService } from '../services/settingsService';
import { VideoOptimizationService } from '../services/videoOptimizationService';
import { VideoProcessor } from '../services/videoProcessor';
import { runtimePaths } from '../config/runtimePaths';
import { generateFileHash } from './fileHash';
import { generateDatedRandomFilename, getDateFolder, normalizeRelativePath } from './mediaStoragePaths';

export type GeneratedImageSaveOptions = {
  format?: 'original' | ImageOutputFormat;
  quality?: number;
  resizeEnabled?: boolean;
  maxWidth?: number;
  maxHeight?: number;
  sourcePathForMetadata?: string;
  sourceMimeType?: string;
  originalFileName?: string;
  metadataPatch?: Partial<AIMetadata>;
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

  private static buildImageMimeType(format: ImageOutputFormat): string {
    if (format === 'jpeg') {
      return 'image/jpeg';
    }

    return `image/${format}`;
  }

  /**
   * API 생성 이미지를 uploads/API/images/YYYY-MM-DD/ 폴더에 저장
   *
   * @param imageBuffer - 이미지 버퍼
   * @param serviceType - 서비스 타입 ('comfyui' | 'novelai' | 'codex')
   * @returns 저장된 파일 정보
   */
  static async saveGeneratedImage(
    imageBuffer: Buffer,
    serviceType: 'comfyui' | 'novelai' | 'codex',
    options?: GeneratedImageSaveOptions,
  ): Promise<SavedGeneratedMedia> {
    try {
      const dateFolder = getDateFolder();
      const dateFolderPath = path.join(runtimePaths.uploadsDir, 'API', 'images', dateFolder);

      await fs.promises.mkdir(dateFolderPath, { recursive: true });

      const outputFormat = this.resolveOutputFormat(options);
      const outputExtension = outputFormat === 'jpeg' ? 'jpg' : outputFormat;
      const filename = generateDatedRandomFilename(outputExtension);
      const fullPath = path.join(dateFolderPath, filename);

      const hasTransformOptions = Boolean(
        options
        && (
          options.format !== undefined
          || options.resizeEnabled !== undefined
          || options.quality !== undefined
          || options.maxWidth !== undefined
          || options.maxHeight !== undefined
          || options.metadataPatch !== undefined
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
          metadataPatch: options?.metadataPatch,
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
      const relativePath = normalizeRelativePath(fullPath, runtimePaths.uploadsDir);

      return {
        originalPath: relativePath,
        fileSize: stats.size,
        width,
        height,
        compositeHash,
        mimeType: this.buildImageMimeType(outputFormat),
      };
    } catch (error) {
      console.error(`[FileSaver] ${serviceType} 이미지 저장 실패:`, error);
      throw new Error(`Failed to save generated image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * API 생성 결과 파일을 media 종류에 맞게 저장한다.
   * 정적 이미지는 기존 이미지 저장 파이프라인을, 비디오는 설정 기반 H.264 최적화를 적용한다.
   */
  static async saveGeneratedFile(
    sourceFilePath: string,
    serviceType: 'comfyui' | 'novelai' | 'codex',
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
      const dateFolder = getDateFolder();
      const targetDir = path.join(runtimePaths.uploadsDir, 'videos', 'API', dateFolder);
      await fs.promises.mkdir(targetDir, { recursive: true });

      const videoOptimizationSettings = settingsService.loadSettings().videoOptimization;
      const shouldOptimizeVideo = sourceMimeType.startsWith('video/')
        && videoOptimizationSettings.enabled
        && videoOptimizationSettings.applyToGeneratedOutputs;

      const sourceExtension = path.extname(sourceFilePath) || '.bin';
      const filename = generateDatedRandomFilename(sourceExtension.replace(/^\./, ''));
      const initialPath = path.join(targetDir, filename);
      const targetBasePath = path.join(targetDir, path.parse(filename).name);

      let finalPath = initialPath;
      let finalMimeType = sourceMimeType;
      if (shouldOptimizeVideo) {
        const optimizationResult = await VideoOptimizationService.persistWithFallback(sourceFilePath, targetBasePath, sourceExtension, {
          crf: videoOptimizationSettings.crf,
          audioBitrateKbps: videoOptimizationSettings.audioBitrateKbps,
          logLabel: `${serviceType} output`,
        });
        finalPath = optimizationResult.outputPath;
        finalMimeType = optimizationResult.mimeType;
      } else {
        await fs.promises.copyFile(sourceFilePath, finalPath);
      }

      const stats = await fs.promises.stat(finalPath);
      const compositeHash = await generateFileHash(finalPath);
      const relativePath = normalizeRelativePath(finalPath, runtimePaths.uploadsDir);

      let width = 0;
      let height = 0;
      try {
        const metadata = await VideoProcessor.extractMetadata(finalPath);
        width = metadata.width || 0;
        height = metadata.height || 0;
      } catch (metadataError) {
        console.warn(`[FileSaver] ${serviceType} media metadata fallback for ${path.basename(finalPath)}:`, metadataError);
      }

      return {
        originalPath: relativePath,
        fileSize: stats.size,
        width,
        height,
        compositeHash,
        mimeType: finalMimeType,
      };
    } catch (error) {
      console.error(`[FileSaver] ${serviceType} media 저장 실패:`, error);
      throw new Error(`Failed to save generated media: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
