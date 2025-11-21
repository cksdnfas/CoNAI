import fs from 'fs';
import path from 'path';
import { ExternalApiProvider } from '../models/ExternalApiProvider';
import { ModelInfo, CreateModelInfoInput } from '../models/ModelInfo';
import { ImageModel } from '../models/ImageModel';
import { CivitaiSettings } from '../models/CivitaiSettings';
import { runtimePaths } from '../config/runtimePaths';

const CIVITAI_API_BASE = 'https://civitai.com/api/v1';
const PROVIDER_NAME = 'civitai';

export interface CivitaiModelResponse {
  id: number;
  name: string;
  modelId: number;
  updatedAt: string;
  model: {
    name: string;
    type: string;
    nsfw: boolean;
    poi: boolean;
  };
  files: Array<{
    id: number;
    name: string;
    sizeKB: number;
    type: string;
    metadata: {
      fp?: string;
      size?: string;
      format?: string;
    };
    hashes: {
      AutoV2?: string;
      SHA256?: string;
      CRC32?: string;
      BLAKE3?: string;
    };
    downloadUrl: string;
    primary: boolean;
  }>;
  images: Array<{
    url: string;
    nsfw: string;
    width: number;
    height: number;
    hash?: string;
    meta?: Record<string, unknown>;
  }>;
  stats: {
    downloadCount: number;
    ratingCount: number;
    rating: number;
  };
  description?: string;
}

/**
 * Civitai API 서비스
 */
export class CivitaiService {
  private static thumbnailDir = path.join(runtimePaths.tempDir, 'civitai', 'thumbnails');

  /**
   * API 키 가져오기
   */
  static getApiKey(): string | null {
    return ExternalApiProvider.getDecryptedKey(PROVIDER_NAME);
  }

  /**
   * 기능 활성화 여부 확인
   */
  static async isEnabled(): Promise<boolean> {
    const settings = CivitaiSettings.get();
    return settings.enabled;
  }

  /**
   * 해시로 모델 정보 조회
   */
  static async getModelByHash(hash: string): Promise<CivitaiModelResponse | null> {
    const settings = CivitaiSettings.get();
    if (!settings.enabled) {
      return null;
    }

    const apiKey = this.getApiKey();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
      const response = await fetch(
        `${CIVITAI_API_BASE}/model-versions/by-hash/${hash.toUpperCase()}`,
        { headers }
      );

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`[Civitai] Model not found for hash: ${hash}`);
          return null;
        }
        throw new Error(`Civitai API error: ${response.status}`);
      }

      const data = await response.json() as CivitaiModelResponse;
      return data;
    } catch (error) {
      console.error('[Civitai] API call failed:', error);
      throw error;
    }
  }

  /**
   * 썸네일 디렉토리 확인 및 생성
   */
  private static ensureThumbnailDir(): void {
    if (!fs.existsSync(this.thumbnailDir)) {
      fs.mkdirSync(this.thumbnailDir, { recursive: true });
    }
  }

  /**
   * 썸네일 다운로드
   */
  static async downloadThumbnail(url: string, hash: string): Promise<string | null> {
    try {
      this.ensureThumbnailDir();

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download thumbnail: ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const ext = url.includes('.png') ? '.png' : '.jpg';
      const filename = `${hash.toUpperCase()}${ext}`;
      const filepath = path.join(this.thumbnailDir, filename);

      fs.writeFileSync(filepath, buffer);
      console.log(`[Civitai] Thumbnail saved: ${filepath}`);

      return filepath;
    } catch (error) {
      console.error('[Civitai] Thumbnail download failed:', error);
      return null;
    }
  }

  /**
   * 모델 정보 조회 및 캐싱
   */
  static async lookupAndCacheModel(modelHash: string): Promise<boolean> {
    // 1. 캐시 확인
    const cached = ModelInfo.findByHash(modelHash);
    if (cached) {
      // 이미 캐시됨 - 모든 관련 image_models 체크 완료 표시
      ImageModel.markHashAsChecked(modelHash, false);
      return true;
    }

    // 2. API 호출
    try {
      const data = await this.getModelByHash(modelHash);

      if (!data) {
        // 모델을 찾을 수 없음
        CivitaiSettings.incrementFailure();
        ImageModel.markHashAsChecked(modelHash, true);
        return false;
      }

      // 3. 썸네일 다운로드
      let thumbnailPath: string | null = null;
      if (data.images && data.images.length > 0) {
        thumbnailPath = await this.downloadThumbnail(data.images[0].url, modelHash);
      }

      // 4. DB에 저장
      const input: CreateModelInfoInput = {
        model_hash: modelHash,
        model_name: data.model.name,
        model_version_id: data.id.toString(),
        civitai_model_id: data.modelId,
        model_type: data.model.type.toLowerCase(),
        civitai_data: JSON.stringify(data),
        thumbnail_path: thumbnailPath || undefined
      };

      ModelInfo.create(input);
      CivitaiSettings.incrementSuccess();

      // 5. 관련 image_models 체크 완료 표시
      ImageModel.markHashAsChecked(modelHash, false);

      console.log(`[Civitai] Model cached: ${data.model.name} (${modelHash})`);
      return true;
    } catch (error) {
      CivitaiSettings.incrementFailure();
      ImageModel.markHashAsChecked(modelHash, true);
      console.error(`[Civitai] Lookup failed for ${modelHash}:`, error);
      return false;
    }
  }

  /**
   * Rate limiting을 적용한 대기
   */
  static async waitForRateLimit(): Promise<void> {
    const settings = CivitaiSettings.get();
    await new Promise(resolve => setTimeout(resolve, settings.apiCallInterval * 1000));
  }

  /**
   * 썸네일 경로 조회
   */
  static getThumbnailPath(hash: string): string | null {
    const jpgPath = path.join(this.thumbnailDir, `${hash.toUpperCase()}.jpg`);
    const pngPath = path.join(this.thumbnailDir, `${hash.toUpperCase()}.png`);

    if (fs.existsSync(jpgPath)) return jpgPath;
    if (fs.existsSync(pngPath)) return pngPath;
    return null;
  }
}
