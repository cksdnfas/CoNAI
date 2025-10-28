import axios from 'axios';
import { API_BASE_URL } from './api';
import type { ImageRecord } from '../types/image';

/**
 * 유사도 매칭 타입
 */
export type SimilarityMatchType = 'exact' | 'near-duplicate' | 'similar' | 'color-similar';

/**
 * 유사 이미지 정보
 */
export interface SimilarImage {
  image: ImageRecord;
  similarity: number;          // 0-100 유사도 점수 (100이 가장 유사)
  hammingDistance: number;     // Hamming distance (낮을수록 유사)
  matchType: SimilarityMatchType;
  colorSimilarity?: number;    // 색상 유사도 (0-100, 선택적)
}

/**
 * 중복 이미지 그룹
 */
export interface DuplicateGroup {
  groupId: string;             // 그룹 고유 ID (대표 이미지 ID 기반)
  images: ImageRecord[];       // 중복 이미지들
  similarity: number;          // 그룹 내 평균 유사도
  matchType: SimilarityMatchType;
}

/**
 * 유사도 검색 옵션
 */
export interface SimilaritySearchOptions {
  threshold?: number;          // Hamming distance 임계값 (기본: 15)
  limit?: number;              // 결과 최대 개수 (기본: 20)
  includeColorSimilarity?: boolean;  // 색상 유사도 포함 여부
  sortBy?: 'similarity' | 'upload_date' | 'file_size';
  sortOrder?: 'ASC' | 'DESC';
}

/**
 * 중복 검색 옵션
 */
export interface DuplicateSearchOptions {
  threshold?: number;          // Hamming distance 임계값 (기본: 5)
  minGroupSize?: number;       // 최소 그룹 크기 (기본: 2)
}

/**
 * 유사도 통계
 */
export interface SimilarityStats {
  totalImages: number;         // 전체 이미지 수
  imagesWithHash: number;      // 해시 생성된 이미지 수
  imagesWithoutHash: number;   // 해시 미생성 이미지 수
  completionPercentage: number; // 완료율 (%)
}

/**
 * 해시 재생성 결과
 */
export interface HashRebuildResult {
  message: string;
  processed: number;
  failed: number;
  total: number;
  remaining: number;
  errors?: Array<{ imageId: number; error: string }>;
}

const api = axios.create({
  baseURL: `${API_BASE_URL}/api/images`,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * 이미지 유사도 검색 API
 */
export const similarityApi = {
  /**
   * 특정 이미지의 중복 이미지 검색
   */
  findDuplicates: async (
    imageId: string | number,
    threshold: number = 5,
    includeMetadata: boolean = true
  ): Promise<SimilarImage[]> => {
    const response = await api.get<{ success: boolean; data: { similar: SimilarImage[] } }>(
      `/${imageId}/duplicates`,
      {
        params: { threshold, includeMetadata }
      }
    );
    return response.data.data.similar;
  },

  /**
   * 유사 이미지 검색
   */
  findSimilar: async (
    imageId: string | number,
    options: SimilaritySearchOptions = {}
  ): Promise<SimilarImage[]> => {
    const {
      threshold = 15,
      limit = 20,
      includeColorSimilarity = false,
      sortBy = 'similarity',
      sortOrder = 'DESC'
    } = options;

    const response = await api.get<{ success: boolean; data: { similar: SimilarImage[] } }>(
      `/${imageId}/similar`,
      {
        params: { threshold, limit, includeColorSimilarity, sortBy, sortOrder }
      }
    );
    return response.data.data.similar;
  },

  /**
   * 색감이 유사한 이미지 검색
   */
  findSimilarByColor: async (
    imageId: string | number,
    threshold: number = 85,
    limit: number = 20
  ): Promise<SimilarImage[]> => {
    const response = await api.get<{ success: boolean; data: { similar: SimilarImage[] } }>(
      `/${imageId}/similar-color`,
      {
        params: { threshold, limit }
      }
    );
    return response.data.data.similar;
  },

  /**
   * 전체 중복 이미지 그룹 검색
   */
  findAllDuplicates: async (
    options: DuplicateSearchOptions = {}
  ): Promise<DuplicateGroup[]> => {
    const { threshold = 5, minGroupSize = 2 } = options;

    const response = await api.get<{ success: boolean; data: { groups: DuplicateGroup[] } }>(
      '/duplicates/all',
      {
        params: { threshold, minGroupSize }
      }
    );
    return response.data.data.groups;
  },

  /**
   * 기존 이미지들의 해시 재생성 (배치 처리)
   */
  rebuildHashes: async (limit: number = 50): Promise<HashRebuildResult> => {
    const response = await api.post<{ success: boolean; data: HashRebuildResult }>(
      '/similarity/rebuild',
      null,
      { params: { limit } }
    );
    return response.data.data;
  },

  /**
   * 유사도 검색 통계 조회
   */
  getStats: async (): Promise<SimilarityStats> => {
    const response = await api.get<{ success: boolean; data: SimilarityStats }>(
      '/similarity/stats'
    );
    return response.data.data;
  },
};
