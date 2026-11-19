import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { ImageMetadataWriteService, type ImageOutputFormat } from '../services/imageMetadataWriteService';
import type { AIMetadata } from '../services/metadata/types';
import { runtimePaths } from '../config/runtimePaths';
import { generateDatedRandomFilename, getDateFolder, normalizeRelativePath } from './mediaStoragePaths';
import { relocateFile } from './recycleBin';

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
  /** Server-only integrity check, after final encoding/write and before library registration. */
  verifySavedFile?: (absolutePath: string) => Promise<void>;
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
  mimeType?: string;
};

export class FileSaver {
  /** Narrow a requested or Sharp-detected format to one the saver writes; anything else is null. */
  private static toOutputFormat(format: string | undefined): ImageOutputFormat | null {
    // The format becomes the file extension; queued payloads are untyped JSON, so only known formats pass.
    return format === 'png' || format === 'jpeg' || format === 'webp' ? format : null;
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

      const source = await sharp(imageBuffer).metadata();
      const sourceFormat = this.toOutputFormat(source.format);
      const requestedFormat = this.toOutputFormat(options?.format);
      // 'original' (or no format) keeps the source's own format.
      const outputFormat = requestedFormat ?? sourceFormat ?? 'png';
      const outputExtension = outputFormat === 'jpeg' ? 'jpg' : outputFormat;
      const filename = generateDatedRandomFilename(outputExtension);
      const fullPath = path.join(dateFolderPath, filename);

      // Keep the original bytes and metadata when nothing would change. An explicit jpeg/webp request is
      // still re-encoded at its quality even if the source already has that format; only png is lossless.
      const exceedsLimit = (limit: number | undefined, size: number | undefined) => (
        typeof limit === 'number' && Number.isFinite(limit) && (size ?? 0) > limit
      );
      const resizes = options?.resizeEnabled === true
        && (exceedsLimit(options.maxWidth, source.width) || exceedsLimit(options.maxHeight, source.height));
      const keepsSourceEncoding = outputFormat === sourceFormat && (requestedFormat === null || requestedFormat === 'png');
      const needsTransform = !keepsSourceEncoding || resizes || options?.metadataPatch !== undefined;

      let outputBuffer = imageBuffer;
      let width = source.width || 0;
      let height = source.height || 0;

      if (needsTransform) {
        const rewritten = await ImageMetadataWriteService.writeBufferAsFormatBuffer(imageBuffer, {
          format: outputFormat,
          quality: options?.quality,
          sourcePathForMetadata: options?.sourcePathForMetadata,
          // In-memory results (NovelAI) have no source file; their AI metadata is read from their own bytes.
          inputFormatForMetadata: sourceFormat ?? undefined,
          originalFileName: options?.originalFileName,
          mimeType: options?.sourceMimeType,
          metadataPatch: options?.metadataPatch,
          maxWidth: options?.resizeEnabled ? options.maxWidth : undefined,
          maxHeight: options?.resizeEnabled ? options.maxHeight : undefined,
        });

        outputBuffer = rewritten.buffer;
        width = rewritten.info.width || 0;
        height = rewritten.info.height || 0;
      }

      if (options?.verifySavedFile) {
        // Never expose unverified output to the recursive uploads watcher.
        const relativeTemp = path.relative(runtimePaths.uploadsDir, runtimePaths.tempDir);
        if (relativeTemp !== '..' && !relativeTemp.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeTemp)) {
          throw new Error('Verified image staging must be outside the uploads directory');
        }
        await fs.promises.mkdir(runtimePaths.tempDir, { recursive: true });
        const stagingDirectory = await fs.promises.mkdtemp(path.join(runtimePaths.tempDir, 'verified-image-'));
        try {
          const stagedPath = path.join(stagingDirectory, filename);
          await fs.promises.writeFile(stagedPath, outputBuffer);
          await options.verifySavedFile(stagedPath);
          // Temp and uploads can sit on different volumes (configured data paths, Docker mounts): copy when rename can't.
          await relocateFile(stagedPath, fullPath);
        } finally {
          await fs.promises.rm(stagingDirectory, { recursive: true, force: true });
        }
      } else {
        await fs.promises.writeFile(fullPath, outputBuffer);
      }

      const stats = await fs.promises.stat(fullPath);
      const relativePath = normalizeRelativePath(fullPath, runtimePaths.uploadsDir);

      return {
        originalPath: relativePath,
        fileSize: stats.size,
        width,
        height,
        mimeType: this.buildImageMimeType(outputFormat),
      };
    } catch (error) {
      console.error(`[FileSaver] ${serviceType} 이미지 저장 실패:`, error);
      throw new Error(`Failed to save generated image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * API 생성 결과 파일을 media 종류에 맞게 저장한다.
   * 정적 이미지는 저장 옵션을 적용하고 비디오는 원본을 먼저 보존한다.
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

      const sourceExtension = path.extname(sourceFilePath) || '.bin';
      const filename = generateDatedRandomFilename(sourceExtension.replace(/^\./, ''));
      const initialPath = path.join(targetDir, filename);
      // Register and preview the original; optimization produces a separate background derivative.
      const finalPath = initialPath;
      const finalMimeType = sourceMimeType;
      await fs.promises.copyFile(sourceFilePath, finalPath);

      const stats = await fs.promises.stat(finalPath);
      const relativePath = normalizeRelativePath(finalPath, runtimePaths.uploadsDir);

      return {
        originalPath: relativePath,
        fileSize: stats.size,
        width: 0,
        height: 0,
        mimeType: finalMimeType,
      };
    } catch (error) {
      console.error(`[FileSaver] ${serviceType} media 저장 실패:`, error);
      throw new Error(`Failed to save generated media: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
