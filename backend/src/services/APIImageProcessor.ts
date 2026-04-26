import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { ImageProcessor } from './imageProcessor';
import { BackgroundProcessorService } from './backgroundProcessorService';
import { FileSaver, type GeneratedImageSaveOptions } from '../utils/fileSaver';
import { runtimePaths } from '../config/runtimePaths';

type ProcessedGeneratedMedia = {
  originalPath: string;
  fileSize: number;
  width: number;
  height: number;
  compositeHash: string;
  mimeType?: string;
};

export class APIImageProcessor {
  private static getBaseUploadPath(): string {
    return path.join(runtimePaths.uploadsDir, 'API');
  }

  private static resolveSavedMediaPath(originalPath: string): string {
    return path.isAbsolute(originalPath)
      ? originalPath
      : path.join(runtimePaths.uploadsDir, originalPath);
  }

  private static async runImmediateMediaPipeline(saved: ProcessedGeneratedMedia): Promise<ProcessedGeneratedMedia> {
    const processingResult = await BackgroundProcessorService.processSavedMediaFile(
      this.resolveSavedMediaPath(saved.originalPath),
      {
        mimeType: saved.mimeType,
        quiet: true,
      },
    );

    return {
      ...saved,
      compositeHash: processingResult.compositeHash || saved.compositeHash,
    };
  }

  /**
   * Process generated image from buffer - SIMPLIFIED VERSION
   * Saves ONLY original file to uploads/API/images/YYYY-MM-DD/
   * Thumbnail version will be created by background scan
   *
   * @param imageBuffer - Image buffer from API response
   * @param serviceType - 'comfyui', 'novelai', or 'codex'
   * @returns Original image path and metadata
   */
  static async processGeneratedImage(
    imageBuffer: Buffer,
    serviceType: 'comfyui' | 'novelai' | 'codex',
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
      const saved = await FileSaver.saveGeneratedImage(imageBuffer, serviceType, saveOptions);
      return await this.runImmediateMediaPipeline(saved);
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
    serviceType: 'comfyui' | 'novelai' | 'codex',
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
      const saved = await FileSaver.saveGeneratedFile(sourceFilePath, serviceType, saveOptions);
      return await this.runImmediateMediaPipeline(saved);
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
   * @param serviceType - 'comfyui', 'novelai', or 'codex'
   * @returns Extracted metadata (prompt, negative_prompt, width, height, etc.)
   */
  static async extractMetadataFromBuffer(
    imageBuffer: Buffer,
    serviceType: 'comfyui' | 'novelai' | 'codex'
  ): Promise<{
    positive_prompt?: string;
    negative_prompt?: string;
    width?: number;
    height?: number;
    metadata: any;
  }> {
    // NovelAI/Codex history is now kept minimal, so skip history-side metadata extraction here.
    if (serviceType === 'novelai' || serviceType === 'codex') {
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
