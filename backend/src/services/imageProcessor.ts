import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { ImageMetadata, AITool, LoRAModel } from '../types/image';

export interface ProcessedImage {
  filename: string;
  originalPath: string;
  thumbnailPath: string;
  optimizedPath: string;
  width: number;
  height: number;
  fileSize: number;
  metadata: ImageMetadata;
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
   * 업로드 폴더 구조 생성
   */
  static async createUploadFolders(baseUploadPath: string): Promise<{
    dateFolder: string;
    originFolder: string;
    thumbnailFolder: string;
    optimizedFolder: string;
  }> {
    const dateFolder = this.getDateFolder();
    const dateFolderPath = path.join(baseUploadPath, dateFolder);
    const originFolder = path.join(dateFolderPath, 'Origin');
    const thumbnailFolder = path.join(dateFolderPath, 'thumbnails');
    const optimizedFolder = path.join(dateFolderPath, 'optimized');

    // 폴더 생성
    await fs.promises.mkdir(originFolder, { recursive: true });
    await fs.promises.mkdir(thumbnailFolder, { recursive: true });
    await fs.promises.mkdir(optimizedFolder, { recursive: true });

    return {
      dateFolder,
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
   */
  static async processImage(
    file: Express.Multer.File,
    baseUploadPath: string
  ): Promise<ProcessedImage> {
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

      // 원본 파일 저장
      await fs.promises.writeFile(originalPath, file.buffer);

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

      return {
        filename,
        originalPath: relativeOriginal,
        thumbnailPath: relativeThumbnail,
        optimizedPath: relativeOptimized,
        width: imageInfo.width,
        height: imageInfo.height,
        fileSize: file.size,
        metadata
      };
    } catch (error) {
      console.error('Image processing failed:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Image processing failed: ${message}`);
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
      const fullOriginalPath = path.join(baseUploadPath, originalPath);
      const fullThumbnailPath = path.join(baseUploadPath, thumbnailPath);
      const fullOptimizedPath = path.join(baseUploadPath, optimizedPath);

      // 모든 버전의 파일 삭제
      const deletePromises = [];

      if (fs.existsSync(fullOriginalPath)) {
        deletePromises.push(fs.promises.unlink(fullOriginalPath));
      }

      if (fs.existsSync(fullThumbnailPath)) {
        deletePromises.push(fs.promises.unlink(fullThumbnailPath));
      }

      if (fs.existsSync(fullOptimizedPath)) {
        deletePromises.push(fs.promises.unlink(fullOptimizedPath));
      }

      // 병렬로 파일 삭제
      await Promise.all(deletePromises);
    } catch (error) {
      console.error('Failed to delete image files:', error);
      throw error instanceof Error ? error : new Error('Unknown error occurred while deleting files');
    }
  }
}