import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { ImageMetadata, AITool, LoRAModel } from '../types/image';
import { ImageSimilarityService } from './imageSimilarity';
import { settingsService } from './settingsService';

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
   */
  static async extractMetadata(filePath: string): Promise<ImageMetadata> {
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File does not exist: ${filePath}`);
      }

      const fileBuffer = await fs.promises.readFile(filePath);
      const metadata: ImageMetadata = {
        extractedAt: new Date().toISOString(),
        ai_info: {}
      };

      // PNG 파일의 텍스트 청크에서 AI 메타데이터 추출
      if (filePath.toLowerCase().endsWith('.png')) {
        metadata.ai_info = this.extractPngTextChunks(fileBuffer);
      }
      // JPEG 파일의 Comment/UserComment에서 AI 메타데이터 추출
      else if (filePath.toLowerCase().match(/\.(jpg|jpeg)$/)) {
        metadata.ai_info = await this.extractJpegAiMetadata(filePath);
      }

      // AI 도구 자동 감지
      this.detectAITool(metadata.ai_info);

      // LoRA 모델 정보 정리
      this.processLoRAModels(metadata.ai_info);

      // AI 정보가 없으면 기본값 설정
      if (!metadata.ai_info || Object.keys(metadata.ai_info).length === 0) {
        metadata.ai_info = {
          ai_tool: 'Unknown',
          model: 'Unknown AI Model',
          prompt: 'No prompt information available'
        };
      }

      return metadata;
    } catch (error) {
      console.warn('Failed to extract AI metadata:', error);
      return {
        extractedAt: new Date().toISOString(),
        ai_info: {
          ai_tool: 'Unknown',
          model: 'Unknown',
          prompt: 'Metadata extraction failed'
        },
        error: 'Failed to extract metadata'
      };
    }
  }

  /**
   * PNG 텍스트 청크에서 원본 메타데이터 추출
   */
  private static extractRawPngMetadata(buffer: Buffer): string[] {
    const rawData: string[] = [];

    try {
      if (buffer.readUInt32BE(0) !== 0x89504E47) {
        return rawData;
      }

      let offset = 8; // PNG 시그니처 이후부터 시작

      while (offset < buffer.length - 8) {
        const chunkLength = buffer.readUInt32BE(offset);
        const chunkType = buffer.toString('ascii', offset + 4, offset + 8);

        if (chunkType === 'tEXt' || chunkType === 'zTXt') {
          const chunkData = buffer.subarray(offset + 8, offset + 8 + chunkLength);
          const rawText = chunkData.toString('utf8');
          rawData.push(rawText);
        }

        offset += 8 + chunkLength + 4;
      }
    } catch (error) {
      console.error('PNG 파싱 오류:', error);
    }

    return rawData;
  }

  /**
   * PNG 텍스트 청크에서 AI 메타데이터 추출
   */
  private static extractPngTextChunks(buffer: Buffer): any {
    const aiInfo: any = {};

    try {
      const rawData = this.extractRawPngMetadata(buffer);

      for (const data of rawData) {
        // AI 메타데이터인지 확인하고 파싱 (parameters로 시작하는 것만)
        if (data.includes('parameters') && data.includes('Steps:')) {
          const metadata = this.parseAIMetadata(data);
          Object.assign(aiInfo, metadata);

          // LoRA 정보 추출
          if (metadata.positive_prompt) {
            const loras = this.extractLoRAInfo(metadata.positive_prompt);
            if (loras.length > 0) {
              aiInfo.lora_models = loras;
            }
          }
          break; // 첫 번째 유효한 AI 메타데이터만 사용
        }
      }
    } catch (error) {
      console.warn('PNG text chunk parsing error:', error);
    }

    return aiInfo;
  }

  /**
   * JPEG EXIF에서 AI 메타데이터 추출
   */
  private static async extractJpegAiMetadata(filePath: string): Promise<any> {
    const aiInfo: any = {};

    try {
      const image = sharp(filePath);
      const metadata = await image.metadata();

      // EXIF Comment나 UserComment에서 AI 정보 추출
      if (metadata.exif) {
        // Sharp의 exif 데이터는 Buffer 형태이므로 파싱이 필요
        // 간단한 구현으로 Comment 필드만 확인
        const exifString = metadata.exif.toString();
        if (exifString.includes('parameters') && exifString.includes('Steps:')) {
          const parsedMetadata = this.parseAIMetadata(exifString);
          Object.assign(aiInfo, parsedMetadata);
        }
      }
    } catch (error) {
      console.warn('JPEG AI metadata extraction error:', error);
    }

    return aiInfo;
  }

  /**
   * AI 메타데이터 파싱 함수 (simple_test.js 로직 적용)
   */
  private static parseAIMetadata(data: string): any {
    const result: any = {};
    const negativeIndex = data.indexOf('Negative prompt:');

    if (data.startsWith('parameters')) {
      const positiveStart = 'parameters'.length;
      const positiveEnd = negativeIndex > -1 ? negativeIndex : data.length;
      result.positive_prompt = data.substring(positiveStart, positiveEnd)
        .replace(/\u0000/g, '') // null character 제거
        .trim();
      result.prompt = result.positive_prompt; // 기존 호환성을 위해
    }

    const negativeMatch = data.match(/Negative prompt:\s*([^\n\r]+?)(?=\s*Steps:|$)/);
    if (negativeMatch) {
      result.negative_prompt = negativeMatch[1]
        .replace(/\u0000/g, '') // null character 제거
        .trim();
    }

    const stepsIndex = data.indexOf('Steps:');
    if (stepsIndex > -1) {
      const parameterSection = data.substring(stepsIndex);

      const stepsMatch = parameterSection.match(/Steps:\s*(\d+)/);
      if (stepsMatch) result.steps = parseInt(stepsMatch[1]);

      const samplerMatch = parameterSection.match(/Sampler:\s*([^,]+)/);
      if (samplerMatch) result.sampler = samplerMatch[1].replace(/\u0000/g, '').trim();

      const cfgMatch = parameterSection.match(/CFG scale:\s*([\d.]+)/);
      if (cfgMatch) result.cfg_scale = parseFloat(cfgMatch[1]);

      const seedMatch = parameterSection.match(/Seed:\s*(\d+)/);
      if (seedMatch) result.seed = seedMatch[1];

      const sizeMatch = parameterSection.match(/Size:\s*(\d+x\d+)/);
      if (sizeMatch) {
        const [width, height] = sizeMatch[1].split('x').map(Number);
        result.width = width;
        result.height = height;
      }

      const modelMatch = parameterSection.match(/Model:\s*([^,]+)/);
      if (modelMatch) result.model = modelMatch[1].replace(/\u0000/g, '').trim();

      const hashMatch = parameterSection.match(/Model hash:\s*([^,]+)/);
      if (hashMatch) result.model_hash = hashMatch[1].replace(/\u0000/g, '').trim();

      const denoisingMatch = parameterSection.match(/Denoising strength:\s*([\d.]+)/);
      if (denoisingMatch) result.denoising_strength = parseFloat(denoisingMatch[1]);

      const clipMatch = parameterSection.match(/Clip skip:\s*(\d+)/);
      if (clipMatch) result.clip_skip = parseInt(clipMatch[1]);

      const loraMatch = parameterSection.match(/Lora hashes:\s*"([^"]+)"/);
      if (loraMatch) {
        result.lora_hashes = loraMatch[1].replace(/\u0000/g, '');
      }

      const versionMatch = parameterSection.match(/Version:\s*([^,]+)/);
      if (versionMatch) result.version = versionMatch[1].replace(/\u0000/g, '').trim();
    }

    return result;
  }

  /**
   * LoRA 정보 추출 (simple_test.js 로직 적용)
   */
  private static extractLoRAInfo(positivePrompt: string): any[] {
    const loraRegex = /<lora:([^:]+):([\d.]+)>/g;
    const loras = [];
    let match;

    while ((match = loraRegex.exec(positivePrompt)) !== null) {
      loras.push({
        name: match[1],
        weight: parseFloat(match[2])
      });
    }

    return loras;
  }


  /**
   * AI 도구 자동 감지
   */
  private static detectAITool(aiInfo: any): void {
    if (!aiInfo) return;

    // 기존에 ai_tool이 설정되어 있으면 유지
    if (aiInfo.ai_tool) return;

    // 메타데이터 내용으로 AI 도구 감지
    const text = JSON.stringify(aiInfo).toLowerCase();

    if (text.includes('comfyui') || text.includes('comfy ui')) {
      aiInfo.ai_tool = 'ComfyUI';
    } else if (text.includes('novelai') || text.includes('novel ai')) {
      aiInfo.ai_tool = 'NovelAI';
    } else if (text.includes('automatic1111') || text.includes('webui')) {
      aiInfo.ai_tool = 'Automatic1111';
    } else if (text.includes('invokeai') || text.includes('invoke ai')) {
      aiInfo.ai_tool = 'InvokeAI';
    } else if (text.includes('midjourney')) {
      aiInfo.ai_tool = 'Midjourney';
    } else if (text.includes('dall-e') || text.includes('dalle')) {
      aiInfo.ai_tool = 'DALL-E';
    } else if (text.includes('stable diffusion') || text.includes('sd ')) {
      aiInfo.ai_tool = 'Stable Diffusion';
    } else {
      aiInfo.ai_tool = 'Unknown';
    }
  }

  /**
   * LoRA 모델 정보 처리 (개선된 버전)
   */
  private static processLoRAModels(aiInfo: any): void {
    if (!aiInfo) return;

    // 이미 배열 형태의 lora_models가 있으면 그대로 유지
    if (aiInfo.lora_models && Array.isArray(aiInfo.lora_models)) {
      return;
    }

    // positive_prompt나 prompt에서 LoRA 추출
    const promptText = aiInfo.positive_prompt || aiInfo.prompt;
    if (promptText) {
      const loras = this.extractLoRAInfo(promptText);
      if (loras.length > 0) {
        aiInfo.lora_models = loras;
      }
    }
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
    let tempFilePath: string | undefined;

    try {
      // 폴더 구조 생성
      const folders = await this.createUploadFolders(baseUploadPath);

      // 고유한 파일명 생성
      const filename = this.generateUniqueFilename(file.originalname);
      const originalPath = path.join(folders.originFolder, filename);

      // 썸네일 파일명 (.webp 확장자)
      const thumbnailFilename = `${path.parse(filename).name}.webp`;
      const thumbnailPath = path.join(folders.thumbnailFolder, thumbnailFilename);

      // 저용량 최적화 파일명 (.webp 확장자)
      const optimizedFilename = `${path.parse(filename).name}_opt.webp`;
      const optimizedPath = path.join(folders.optimizedFolder, optimizedFilename);

      // diskStorage 사용: file.path에서 임시 파일 읽기
      // memoryStorage 사용: file.buffer 사용 (하위 호환성)
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

      // 이미지 정보 추출
      const imageInfo = await this.getImageInfo(originalPath);

      // 메타데이터 추출
      const metadata = await this.extractMetadata(originalPath);

      // 병렬로 썸네일과 저용량 이미지 생성
      await Promise.all([
        this.generateThumbnail(originalPath, thumbnailPath),
        this.generateOptimized(originalPath, optimizedPath)
      ]);

      const relativeOriginal = this.normalizeRelativePath(originalPath, baseUploadPath);
      const relativeThumbnail = this.normalizeRelativePath(thumbnailPath, baseUploadPath);
      const relativeOptimized = this.normalizeRelativePath(optimizedPath, baseUploadPath);

      // 이미지 유사도 검색을 위한 해시 생성 (비동기, 실패해도 업로드는 성공)
      let perceptualHash: string | undefined;
      let colorHistogram: string | undefined;

      // 설정에 따라 자동 해시 생성 여부 결정
      const settings = settingsService.loadSettings();

      if (settings.similarity.autoGenerateHashOnUpload) {
        console.log('✅ [ImageProcessor] Auto hash generation ENABLED, starting...');
        try {
          console.log('🔍 [ImageProcessor] Generating perceptual hash for:', filename);
          perceptualHash = await ImageSimilarityService.generatePerceptualHash(originalPath);

          if (!perceptualHash) {
            console.error('❌ [ImageProcessor] Perceptual hash is undefined/null!');
          } else {
            console.log('✅ [ImageProcessor] Perceptual hash generated:', perceptualHash.substring(0, 16) + '...', `(${perceptualHash.length} chars)`);
          }

          console.log('🔍 [ImageProcessor] Generating color histogram...');
          const histogram = await ImageSimilarityService.generateColorHistogram(originalPath);
          colorHistogram = ImageSimilarityService.serializeHistogram(histogram);

          if (!colorHistogram) {
            console.error('❌ [ImageProcessor] Color histogram is undefined/null!');
          } else {
            console.log('✅ [ImageProcessor] Color histogram generated:', colorHistogram.length, 'bytes');
          }

          // 최종 검증
          if (perceptualHash && colorHistogram) {
            console.log('✅ [ImageProcessor] Hash generation SUCCESS - both hashes valid');
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
      console.error('Image processing failed:', error);
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