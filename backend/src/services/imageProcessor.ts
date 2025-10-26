import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { ImageMetadata, AITool, LoRAModel } from '../types/image';
import { ImageSimilarityService } from './imageSimilarity';
import { settingsService } from './settingsService';
import { MetadataExtractor } from './metadata';

export interface ProcessedImage {
  filename: string;
  originalPath: string;
  thumbnailPath: string;
  optimizedPath: string;
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

  private static readonly THUMBNAIL_SIZE = 1080;
  private static readonly THUMBNAIL_QUALITY = 80;
  private static readonly OPTIMIZED_QUALITY = 95;

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

  /**
   * 업로드 폴더 구조 생성 (이미지 전용)
   * 경로: uploads/images/YYYY-MM-DD/Origin|thumbnails|optimized/
   */
  static async createUploadFolders(baseUploadPath: string): Promise<{
    dateFolder: string;
    originFolder: string;
    thumbnailFolder: string;
    optimizedFolder: string;
  }> {
    const dateFolder = this.getDateFolder();
    // 이미지는 images 서브폴더 사용
    const imagesPath = path.join(baseUploadPath, 'images');
    const dateFolderPath = path.join(imagesPath, dateFolder);
    const originFolder = path.join(dateFolderPath, 'Origin');
    const thumbnailFolder = path.join(dateFolderPath, 'thumbnails');
    const optimizedFolder = path.join(dateFolderPath, 'optimized');

    // 폴더 생성
    await fs.promises.mkdir(originFolder, { recursive: true });
    await fs.promises.mkdir(thumbnailFolder, { recursive: true });
    await fs.promises.mkdir(optimizedFolder, { recursive: true });

    return {
      dateFolder: path.join('images', dateFolder),
      originFolder,
      thumbnailFolder,
      optimizedFolder
    };
  }

  /**
   * 고유한 파일명 생성 (년도_월_일_시간_임의문자열 형식)
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
    const ext = path.extname(originalName);

    return `${year}_${month}_${day}_${hour}${minute}${second}_${random}${ext}`;
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
    size: number = this.THUMBNAIL_SIZE
  ): Promise<void> {
    await sharp(inputPath)
      .resize(size, size, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({
        quality: this.THUMBNAIL_QUALITY,
        effort: 4
      })
      .toFile(outputPath);
  }

  /**
   * 저용량 최적화 이미지 생성
   */
  static async generateOptimized(
    inputPath: string,
    outputPath: string
  ): Promise<void> {
    // GIF 파일은 원본 그대로 복사 (애니메이션 보존)
    const ext = path.extname(inputPath).toLowerCase();
    if (ext === '.gif') {
      const gifOutputPath = outputPath.replace(/\.webp$/, '.gif');
      await fs.promises.copyFile(inputPath, gifOutputPath);
      return;
    }

    const image = sharp(inputPath);
    const metadata = await image.metadata();

    await image
      .webp({
        quality: this.OPTIMIZED_QUALITY,
        effort: 6
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
   * 메인 이미지 처리 함수
   * diskStorage 사용 시 file.path에서 임시 파일을 읽어 처리하고 정리함
   */
  static async processImage(
    file: Express.Multer.File,
    baseUploadPath: string
  ): Promise<ProcessedImage> {
    const startTime = Date.now();
    console.log(`⏱️ [ImageProcessor] Starting image processing: ${file.originalname}`);

    let tempFilePath: string | undefined;

    try {
      // 폴더 구조 생성
      const folderStart = Date.now();
      const folders = await this.createUploadFolders(baseUploadPath);
      console.log(`⏱️ [ImageProcessor] Folder creation: ${Date.now() - folderStart}ms`);

      // 고유한 파일명 생성
      const filename = this.generateUniqueFilename(file.originalname);
      const originalPath = path.join(folders.originFolder, filename);

      // 썸네일 파일명 (.webp 확장자)
      const thumbnailFilename = `${path.parse(filename).name}.webp`;
      const thumbnailPath = path.join(folders.thumbnailFolder, thumbnailFilename);

      // 저용량 최적화 파일명 (GIF는 .gif, 나머지는 .webp)
      const ext = path.extname(filename).toLowerCase();
      const optimizedExt = ext === '.gif' ? '.gif' : '.webp';
      const optimizedFilename = `${path.parse(filename).name}_opt${optimizedExt}`;
      const optimizedPath = path.join(folders.optimizedFolder, optimizedFilename);

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
      console.log(`⏱️ [ImageProcessor] File copy: ${Date.now() - copyStart}ms`);

      // 이미지 정보 추출
      const infoStart = Date.now();
      const imageInfo = await this.getImageInfo(originalPath);
      console.log(`⏱️ [ImageProcessor] Image info extraction: ${Date.now() - infoStart}ms`);

      // 메타데이터 추출
      const metadataStart = Date.now();
      const metadata = await this.extractMetadata(originalPath);
      console.log(`⏱️ [ImageProcessor] Metadata extraction: ${Date.now() - metadataStart}ms`);

      // 병렬로 썸네일과 저용량 이미지 생성
      const generateStart = Date.now();
      await Promise.all([
        this.generateThumbnail(originalPath, thumbnailPath),
        this.generateOptimized(originalPath, optimizedPath)
      ]);
      console.log(`⏱️ [ImageProcessor] Thumbnail/Optimized generation: ${Date.now() - generateStart}ms`);

      const relativeOriginal = this.normalizeRelativePath(originalPath, baseUploadPath);
      const relativeThumbnail = this.normalizeRelativePath(thumbnailPath, baseUploadPath);
      const relativeOptimized = this.normalizeRelativePath(optimizedPath, baseUploadPath);

      // 이미지 유사도 검색을 위한 해시 생성 (비동기, 실패해도 업로드는 성공)
      let perceptualHash: string | undefined;
      let colorHistogram: string | undefined;

      // 설정에 따라 자동 해시 생성 여부 결정
      const settings = settingsService.loadSettings();

      if (settings.similarity.autoGenerateHashOnUpload) {
        const hashStart = Date.now();
        console.log('⏱️ [ImageProcessor] Starting similarity hash generation...');
        try {
          const phashStart = Date.now();
          perceptualHash = await ImageSimilarityService.generatePerceptualHash(originalPath);
          console.log(`⏱️ [ImageProcessor] Perceptual hash: ${Date.now() - phashStart}ms`);

          if (!perceptualHash) {
            console.error('❌ [ImageProcessor] Perceptual hash is undefined/null!');
          } else {
            console.log('✅ [ImageProcessor] Perceptual hash generated:', perceptualHash.substring(0, 16) + '...', `(${perceptualHash.length} chars)`);
          }

          const histStart = Date.now();
          const histogram = await ImageSimilarityService.generateColorHistogram(originalPath);
          colorHistogram = ImageSimilarityService.serializeHistogram(histogram);
          console.log(`⏱️ [ImageProcessor] Color histogram: ${Date.now() - histStart}ms`);

          if (!colorHistogram) {
            console.error('❌ [ImageProcessor] Color histogram is undefined/null!');
          } else {
            console.log('✅ [ImageProcessor] Color histogram generated:', colorHistogram.length, 'bytes');
          }

          // 최종 검증
          if (perceptualHash && colorHistogram) {
            console.log(`⏱️ [ImageProcessor] ✅ Hash generation complete: ${Date.now() - hashStart}ms`);
          } else {
            console.error('❌ [ImageProcessor] Hash generation FAILED - one or both hashes invalid:', {
              hasPerceptualHash: !!perceptualHash,
              hasColorHistogram: !!colorHistogram
            });
          }
        } catch (hashError) {
          console.error('❌ [ImageProcessor] Failed to generate similarity hashes (non-critical):', hashError);
          if (hashError instanceof Error) {
            console.error('❌ [ImageProcessor] Error details:', {
              name: hashError.name,
              message: hashError.message,
              stack: hashError.stack?.split('\n').slice(0, 3).join('\n')
            });
          }
        }
      } else {
        console.warn('⚠️ [ImageProcessor] Auto hash generation DISABLED in settings');
        console.log('   Settings value:', { autoGenerateHashOnUpload: settings.similarity.autoGenerateHashOnUpload });
      }

      const totalTime = Date.now() - startTime;
      console.log(`⏱️ [ImageProcessor] ✅ Total processing time: ${totalTime}ms`);

      return {
        filename,
        originalPath: relativeOriginal,
        thumbnailPath: relativeThumbnail,
        optimizedPath: relativeOptimized,
        width: imageInfo.width,
        height: imageInfo.height,
        fileSize: file.size,
        metadata,
        perceptualHash,
        colorHistogram
      };
    } catch (error) {
      console.error(`⏱️ [ImageProcessor] ❌ Failed after ${Date.now() - startTime}ms:`, error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Image processing failed: ${message}`);
    } finally {
      // 임시 파일 정리 (diskStorage 사용 시)
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          await fs.promises.unlink(tempFilePath);
        } catch (cleanupError) {
          console.warn('Failed to cleanup temp file:', tempFilePath, cleanupError);
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
      const optimizedRelativePath = path.join(dirname, `${basename}_opt.webp`);

      const thumbnailPath = resolveUploadsPath(thumbnailRelativePath);
      const optimizedPath = resolveUploadsPath(optimizedRelativePath);

      // 썸네일과 최적화 이미지 생성
      await Promise.all([
        ImageProcessor.generateThumbnail(fullPath, thumbnailPath),
        ImageProcessor.generateOptimized(fullPath, optimizedPath)
      ]);

      const aiInfo = metadata.ai_info || {};

      // 데이터베이스에 저장
      const imageId = await ImageModel.create({
        filename: path.basename(relativePath),
        original_name: path.basename(relativePath),
        file_path: relativePath.replace(/\\/g, '/'),
        thumbnail_path: thumbnailRelativePath.replace(/\\/g, '/'),
        optimized_path: optimizedRelativePath.replace(/\\/g, '/'),
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
      console.error('Failed to process existing image:', error);
      throw error instanceof Error ? error : new Error('Unknown error occurred while processing existing image');
    }
  }

  /**
   * 파일 삭제
   */
  static async deleteImageFiles(
    originalPath: string,
    thumbnailPath: string,
    optimizedPath: string,
    baseUploadPath: string
  ): Promise<void> {
    try {
      // 경로 검증 및 정규화
      const pathsToDelete = new Set<string>();

      // 각 경로 검증 및 추가
      const addPathIfValid = (relativePath: string) => {
        // 빈 문자열이거나 null/undefined 체크
        if (!relativePath || relativePath.trim() === '') {
          return;
        }

        // 절대 경로 생성
        const fullPath = path.join(baseUploadPath, relativePath);

        // 경로가 baseUploadPath 내부에 있는지 확인 (보안)
        const resolvedPath = path.resolve(fullPath);
        const resolvedBase = path.resolve(baseUploadPath);
        if (!resolvedPath.startsWith(resolvedBase)) {
          console.warn(`⚠️ Path outside base directory, skipping: ${relativePath}`);
          return;
        }

        // 파일 존재 여부 및 파일 타입 확인
        if (fs.existsSync(fullPath)) {
          const stats = fs.statSync(fullPath);
          if (stats.isFile()) {
            pathsToDelete.add(fullPath);
          } else {
            console.warn(`⚠️ Not a file (possibly a directory), skipping: ${fullPath}`);
          }
        }
      };

      addPathIfValid(originalPath);
      addPathIfValid(thumbnailPath);
      addPathIfValid(optimizedPath);

      // 각 파일을 개별적으로 삭제 (하나 실패해도 나머지 삭제 계속)
      const deletePromises = Array.from(pathsToDelete).map(async (filePath) => {
        try {
          await fs.promises.unlink(filePath);
          console.log(`✅ Deleted file: ${path.relative(baseUploadPath, filePath)}`);
        } catch (error) {
          console.error(`❌ Failed to delete file: ${path.relative(baseUploadPath, filePath)}`, error);
          // 개별 파일 삭제 실패는 전체 작업을 중단하지 않음
        }
      });

      await Promise.all(deletePromises);

      if (pathsToDelete.size === 0) {
        console.warn('⚠️ No valid files found to delete');
      }
    } catch (error) {
      console.error('Failed to delete image files:', error);
      throw error instanceof Error ? error : new Error('Unknown error occurred while deleting files');
    }
  }
}