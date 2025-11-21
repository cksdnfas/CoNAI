import { CivitaiTempUrl } from '../models/CivitaiTempUrl';

const CIVITAI_POST_INTENT_BASE = 'https://civitai.com/intent/post';

export interface CreateIntentParams {
  compositeHashes: string[];
  includeMetadata?: boolean;
  title?: string;
  description?: string;
  tags?: string[];
  detailsUrl?: string;
}

export interface IntentUrlResult {
  intentUrl: string;
  tokens: string[];
  expiresAt: Date;
}

/**
 * Civitai Post Intent URL 서비스
 */
export class CivitaiTempUrlService {
  /**
   * Post Intent URL 생성
   */
  static createIntentUrl(
    baseUrl: string,
    params: CreateIntentParams
  ): IntentUrlResult {
    // 1. 각 이미지에 대한 임시 토큰 생성
    const tokens = CivitaiTempUrl.createMany(
      params.compositeHashes,
      params.includeMetadata !== false,
      60 // 1시간 만료
    );

    // 2. 임시 이미지 URL 생성
    const mediaUrls = tokens.map(token =>
      `${baseUrl}/api/civitai/temp-image/${token}`
    );

    // 3. Intent URL 구성
    const query = new URLSearchParams();

    mediaUrls.forEach(url => query.append('mediaUrl', url));

    if (params.title) {
      query.append('title', params.title);
    }
    if (params.description) {
      query.append('description', params.description);
    }
    if (params.tags && params.tags.length > 0) {
      query.append('tags', params.tags.join(','));
    }
    if (params.detailsUrl) {
      query.append('detailsUrl', params.detailsUrl);
    }

    const intentUrl = `${CIVITAI_POST_INTENT_BASE}?${query.toString()}`;

    // 4. 만료 시간 계산
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 60);

    return {
      intentUrl,
      tokens,
      expiresAt
    };
  }

  /**
   * 만료된 URL 정리 (정기 작업)
   */
  static cleanup(): number {
    return CivitaiTempUrl.cleanupExpired();
  }
}
