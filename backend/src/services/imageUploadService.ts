import { MediaMetadataModel } from '../models/Image/MediaMetadataModel';
import { ImageFileModel } from '../models/Image/ImageFileModel';
import { ImageSimilarityService } from './imageSimilarity';
import { ImageMetadataRecord, FileType } from '../types/image';
import path from 'path';

/**
 * 이미지 업로드 서비스
 * composite_hash 기반 새 구조로 이미지를 저장
 */
export class ImageUploadService {
  /**
   * 업로드된 이미지를 새 구조로 저장
   * @param imagePath 원본 이미지 파일 경로
   * @param imageData 이미지 메타데이터
   * @param folderId watched_folders ID (기본: 1 = 직접 업로드)
   * @returns composite_hash
   */
  static async saveUploadedImage(
    imagePath: string,
    imageData: {
      width: number;
      height: number;
      thumbnailPath: string;
      fileSize: number;
      mimeType: string;
      aiTool: string | null;
      modelName: string | null;
      loraModels: string | null;
      steps: number | null;
      cfgScale: number | null;
      sampler: string | null;
      seed: number | null;
      scheduler: string | null;
      prompt: string | null;
      negativePrompt: string | null;
      denoiseStrength: number | null;
      generationTime: number | null;
      batchSize: number | null;
      batchIndex: number | null;
      autoTags: string | null;
      duration: number | null;
      fps: number | null;
      videoCodec: string | null;
      audioCodec: string | null;
      bitrate: number | null;
    },
    folderId: number = 1
  ): Promise<string> {
    // 1. 복합 해시 생성
    const hashes = await ImageSimilarityService.generateCompositeHash(imagePath);
    const { compositeHash, perceptualHash, dHash, aHash } = hashes;

    // 2. 색상 히스토그램 생성
    let colorHistogramJson: string | null = null;
    try {
      const histogram = await ImageSimilarityService.generateColorHistogram(imagePath);
      colorHistogramJson = ImageSimilarityService.serializeHistogram(histogram);
    } catch (error) {
      console.warn('색상 히스토그램 생성 실패:', error);
    }

    // 3. media_metadata에 존재 여부 확인
    const existingMetadata = MediaMetadataModel.findByHash(compositeHash);

    if (!existingMetadata) {
      // 3-1. 신규 메타데이터 생성
      const metadataRecord: Omit<ImageMetadataRecord, 'first_seen_date' | 'metadata_updated_date'> = {
        composite_hash: compositeHash,
        perceptual_hash: perceptualHash,
        dhash: dHash,
        ahash: aHash,
        color_histogram: colorHistogramJson,
        width: imageData.width,
        height: imageData.height,
        thumbnail_path: imageData.thumbnailPath,
        ai_tool: imageData.aiTool,
        model_name: imageData.modelName,
        lora_models: imageData.loraModels,
        steps: imageData.steps,
        cfg_scale: imageData.cfgScale,
        sampler: imageData.sampler,
        seed: imageData.seed,
        scheduler: imageData.scheduler,
        prompt: imageData.prompt,
        negative_prompt: imageData.negativePrompt,
        denoise_strength: imageData.denoiseStrength,
        generation_time: imageData.generationTime,
        batch_size: imageData.batchSize,
        batch_index: imageData.batchIndex,
        auto_tags: imageData.autoTags,
        duration: imageData.duration,
        fps: imageData.fps,
        video_codec: imageData.videoCodec,
        audio_codec: imageData.audioCodec,
        bitrate: imageData.bitrate,
        rating_score: 0
      };

      MediaMetadataModel.create(metadataRecord);
      console.log(`✅ 신규 메타데이터 생성: ${compositeHash.substring(0, 16)}...`);
    } else {
      console.log(`♻️  기존 메타데이터 재사용: ${compositeHash.substring(0, 16)}...`);
    }

    // 4. image_files에 파일 위치 기록
    const fileExists = ImageFileModel.exists(imagePath);

    if (!fileExists) {
      const fileStats = await import('fs').then(fs => fs.promises.stat(imagePath));

      // 파일 타입 결정
      const fileType = this.determineFileType(imageData.mimeType, imagePath);

      ImageFileModel.create({
        composite_hash: compositeHash,
        file_type: fileType,
        original_file_path: imagePath,
        folder_id: folderId,
        file_status: 'active',
        file_size: imageData.fileSize,
        mime_type: imageData.mimeType,
        file_modified_date: fileStats.mtime.toISOString()
      });
      console.log(`✅ 파일 위치 기록: ${path.basename(imagePath)}`);
    } else {
      console.log(`⚠️  파일 경로 중복: ${path.basename(imagePath)}`);
    }

    return compositeHash;
  }

  /**
   * 레거시: images 테이블에도 저장 (호환성 유지)
   * @deprecated 새 구조 안정화 후 제거 예정
   */
  static getLegacyImageId(compositeHash: string): number | null {
    // image_files를 통해 images.id 조회
    const { db } = require('../database/init');
    const row = db.prepare(`
      SELECT i.id
      FROM image_files if
      JOIN images i ON if.original_file_path LIKE '%' || i.file_path
      WHERE if.composite_hash = ?
      LIMIT 1
    `).get(compositeHash) as { id: number } | undefined;

    return row?.id || null;
  }

  /**
   * composite_hash로 메타데이터 조회
   */
  static getMetadataByHash(compositeHash: string): ImageMetadataRecord | null {
    return MediaMetadataModel.findByHash(compositeHash);
  }

  /**
   * composite_hash로 활성 파일 경로 조회
   */
  static getActiveFilePath(compositeHash: string): string | null {
    const files = ImageFileModel.findActiveByHash(compositeHash);
    return files.length > 0 ? files[0].original_file_path : null;
  }

  /**
   * 파일 타입 결정 (image, video, animated)
   */
  private static determineFileType(mimeType: string, filePath: string): FileType {
    if (mimeType.startsWith('video/')) {
      return 'video';
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.gif' || ext === '.apng') {
      return 'animated';
    }

    return 'image';
  }
}
