import path from 'path';
import fs from 'fs';
import { ImageProcessor } from './imageProcessor';
import { ImageModel } from '../models/Image';
import { ImageMetadataModel } from '../models/Image/ImageMetadataModel';
import { ImageSimilarityModel } from '../models/Image/ImageSimilarityModel';
import { ImageSimilarityService } from './imageSimilarity';
import { PromptCollectionService } from './promptCollectionService';
import { AutoCollectionService } from './autoCollectionService';
import { imageTaggerService, ImageTaggerService } from './imageTaggerService';
import { settingsService } from './settingsService';
import { runtimePaths, resolveUploadsPath } from '../config/runtimePaths';
import { refinePrimaryPrompt } from '@comfyui-image-manager/shared';

const UPLOAD_BASE_PATH = runtimePaths.uploadsDir;

/**
 * 공통 업로드 서비스
 * 업로드 API와 워크플로우 이미지 생성에서 공통으로 사용
 */
export class UploadService {
  /**
   * 로컬 파일 경로에서 이미지를 처리하여 DB에 저장
   * @param localFilePath 로컬 파일의 상대 경로 (uploads/ 기준)
   * @param additionalMetadata 추가 메타데이터 (ai_tool, prompt 등)
   * @returns 생성된 이미지 ID
   */
  static async processAndUploadImage(
    localFilePath: string,
    additionalMetadata?: {
      ai_tool?: string;
      prompt?: string;
      [key: string]: any;
    }
  ): Promise<number> {
    console.log('🔄 Processing image for upload:', localFilePath);

    const fullPath = resolveUploadsPath(localFilePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Image file not found: ${localFilePath}`);
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
    const ext = path.extname(localFilePath);
    const basename = path.basename(localFilePath, ext);
    const dirname = path.dirname(localFilePath);

    const thumbnailRelativePath = path.join(dirname, `${basename}_thumb.webp`);

    const thumbnailPath = resolveUploadsPath(thumbnailRelativePath);

    // 썸네일 생성
    await ImageProcessor.generateThumbnail(fullPath, thumbnailPath);

    console.log('✅ Image processed successfully');

    const aiInfo = metadata.ai_info || {};

    // STEP 1: 프롬프트 정제 (DB 저장 전)
    let refinedPrompt = aiInfo.prompt || null;
    let refinedNegativePrompt = aiInfo.negative_prompt || null;

    if (refinedPrompt) {
      console.log('🔄 Refining positive prompt...');
      refinedPrompt = refinePrimaryPrompt(refinedPrompt);
      console.log('✅ Positive prompt refined');
    }

    if (refinedNegativePrompt) {
      console.log('🔄 Refining negative prompt...');
      refinedNegativePrompt = refinePrimaryPrompt(refinedNegativePrompt);
      console.log('✅ Negative prompt refined');
    }

    console.log('💾 Saving to database...');

    // 데이터베이스에 저장 (정제된 프롬프트 사용)
    const imageId = await ImageModel.create({
      filename: path.basename(localFilePath),
      original_name: path.basename(localFilePath),
      file_path: localFilePath.replace(/\\/g, '/'),
      thumbnail_path: thumbnailRelativePath.replace(/\\/g, '/'),
      file_size: stats.size,
      mime_type: 'image/' + ext.substring(1),
      width: imageInfo.width,
      height: imageInfo.height,
      metadata: JSON.stringify(metadata),

      // AI 메타데이터 필드들 (정제된 프롬프트 사용)
      ai_tool: aiInfo.ai_tool || null,
      model_name: aiInfo.model || null,
      lora_models: aiInfo.lora_models ? JSON.stringify(aiInfo.lora_models) : null,
      steps: aiInfo.steps || null,
      cfg_scale: aiInfo.cfg_scale || null,
      sampler: aiInfo.sampler || null,
      seed: aiInfo.seed || null,
      scheduler: aiInfo.scheduler || null,
      prompt: refinedPrompt,
      negative_prompt: refinedNegativePrompt,
      denoise_strength: aiInfo.denoise_strength || null,
      generation_time: aiInfo.generation_time || null,
      batch_size: aiInfo.batch_size || null,
      batch_index: aiInfo.batch_index || null,
      auto_tags: null,  // 업로드 시에는 null, 자동 태깅으로 추가

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

    console.log('✅ Database save successful, ID:', imageId);

    // STEP 3: 프롬프트 수집 (정제된 프롬프트 사용)
    // 비동기로 처리, 오류가 있어도 업로드는 계속 진행
    try {
      console.log('🔍 Collecting prompts...');
      await PromptCollectionService.collectFromImage(
        refinedPrompt,
        refinedNegativePrompt
      );
      console.log('✅ Prompts collected successfully');
    } catch (promptError) {
      console.warn('⚠️ Failed to collect prompts (non-critical):', promptError);
    }

    // 자동 태깅은 AutoTagScheduler에서 백그라운드로 처리됨
    // Upload 시에는 파일 저장만 수행
    try {
      const settings = settingsService.loadSettings();

      if (settings.tagger.enabled) {
        console.log('🏷️ Auto-tagging will be handled by AutoTagScheduler in the background');
      }
    } catch (autoTagError) {
      console.warn('⚠️ Failed to auto-tag image (non-critical):', autoTagError);
    }

    // 유사도 해시 생성 (설정에서 활성화된 경우)
    try {
      const settings = settingsService.loadSettings();

      if (settings.similarity?.autoGenerateHashOnUpload) {
        console.log('🔢 Generating similarity hashes...');

        // imageId로부터 composite_hash 조회
        const { db } = await import('../database/init');
        const file = db.prepare(`
          SELECT if.composite_hash
          FROM image_files if
          JOIN images i ON if.original_file_path LIKE '%' || i.file_path
          WHERE i.id = ?
          LIMIT 1
        `).get(imageId) as { composite_hash: string } | undefined;

        if (file && file.composite_hash) {
          // 해시 생성
          const result = await ImageSimilarityService.generateHashAndHistogram(fullPath);

          // 메타데이터 업데이트
          await ImageSimilarityModel.updateHash(
            file.composite_hash,
            result.hashes.perceptualHash,
            ImageSimilarityService.serializeHistogram(result.colorHistogram)
          );

          console.log('✅ Similarity hashes generated successfully');
        } else {
          console.warn('⚠️ Could not find composite_hash for similarity hash generation');
        }
      }
    } catch (hashError) {
      console.warn('⚠️ Failed to generate similarity hashes (non-critical):', hashError);
    }

    // 자동수집 그룹 처리 (자동 태깅 이후 실행하여 auto_tags 조건도 체크 가능)
    try {
      console.log('🔍 Running auto collection...');
      const autoCollectResults = await AutoCollectionService.runAutoCollectionForNewImageById(imageId);
      if (autoCollectResults.length > 0) {
        console.log(`✅ Image automatically added to ${autoCollectResults.length} groups`);
      }
    } catch (autoCollectError) {
      console.warn('⚠️ Failed to run auto collection (non-critical):', autoCollectError);
    }

    return imageId;
  }

  /**
   * 여러 이미지를 순차적으로 처리
   * @param localFilePaths 로컬 파일 경로 배열
   * @param additionalMetadata 추가 메타데이터
   * @returns 생성된 이미지 ID 배열
   */
  static async processAndUploadMultipleImages(
    localFilePaths: string[],
    additionalMetadata?: {
      ai_tool?: string;
      prompt?: string;
      [key: string]: any;
    }
  ): Promise<number[]> {
    const imageIds: number[] = [];

    for (const filePath of localFilePaths) {
      try {
        const imageId = await this.processAndUploadImage(filePath, additionalMetadata);
        imageIds.push(imageId);
      } catch (error) {
        console.error(`❌ Failed to process image ${filePath}:`, error);
        // 하나의 이미지 실패해도 나머지는 계속 처리
      }
    }

    return imageIds;
  }
}
