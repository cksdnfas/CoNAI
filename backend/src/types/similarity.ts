import { ImageRecord } from './image';

/**
 * 이미지 유사도 매칭 타입
 */
export type SimilarityMatchType = 'exact' | 'near-duplicate' | 'similar' | 'color-similar';

/**
 * 유사 이미지 정보
 */
export interface SimilarityHashComponentScore {
  available: boolean;
  used: boolean;
  weight: number;
  threshold: number;
  passed: boolean;
  distance?: number;
  similarity?: number;
}

export interface SimilarityColorComponentScore {
  available: boolean;
  used: boolean;
  weight: number;
  threshold: number;
  passed: boolean;
  similarity?: number;
}

export interface SimilarityComponentScores {
  perceptualHash: SimilarityHashComponentScore;
  dHash: SimilarityHashComponentScore;
  aHash: SimilarityHashComponentScore;
  color: SimilarityColorComponentScore;
}

export interface SimilarImage {
  image: ImageRecord;
  similarity: number;          // 0-100 유사도 점수 (100이 가장 유사)
  hammingDistance: number;     // Hamming distance (낮을수록 유사)
  matchType: SimilarityMatchType;
  colorSimilarity?: number;    // 색상 유사도 (0-100, 선택적)
  componentScores?: SimilarityComponentScores;
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
 * 색상 히스토그램 데이터
 */
export interface ColorHistogram {
  r: number[];  // Red 채널 분포 (0-255)
  g: number[];  // Green 채널 분포
  b: number[];  // Blue 채널 분포
}

/**
 * 유사도 검색 옵션
 */
export interface SimilaritySearchOptions {
  threshold?: number;          // 레거시 pHash 임계값 (기본: 15)
  limit?: number;              // 결과 최대 개수 (기본: 20)
  includeColorSimilarity?: boolean;  // 색상 유사도 포함 여부
  weights?: {
    perceptualHash?: number;
    dHash?: number;
    aHash?: number;
    color?: number;
  };
  thresholds?: {
    perceptualHash?: number;
    dHash?: number;
    aHash?: number;
    color?: number;
  };
  useMetadataFilter?: boolean;
  sortBy?: 'similarity' | 'upload_date' | 'file_size';
  sortOrder?: 'ASC' | 'DESC';
}

/**
 * 중복 검색 옵션
 */
export interface DuplicateSearchOptions {
  threshold?: number;          // Hamming distance 임계값 (기본: 5)
  minGroupSize?: number;       // 최소 그룹 크기 (기본: 2)
  includeMetadata?: boolean;   // 메타데이터 기반 필터링 포함
}

/**
 * 유사도 임계값 상수
 */
export const SIMILARITY_THRESHOLDS = {
  EXACT_DUPLICATE: 0,          // 완전히 동일한 이미지
  NEAR_DUPLICATE: 5,           // 거의 동일 (크기 조정, 압축 등)
  SIMILAR: 15,                 // 유사한 이미지
  COLOR_SIMILAR: 0.85          // 색상 유사도 (0-1)
} as const;

/**
 * 유사도 검색 응답
 */
export interface SimilaritySearchResponse {
  success: boolean;
  data?: {
    similar: SimilarImage[];
    total: number;
    query: {
      imageId: number;
      threshold: number;
      limit: number;
    };
  };
  error?: string;
}

/**
 * 중복 이미지 검색 응답
 */
export interface DuplicateSearchResponse {
  success: boolean;
  data?: {
    groups: DuplicateGroup[];
    totalGroups: number;
    totalImages: number;
    query: {
      threshold: number;
      minGroupSize: number;
    };
  };
  error?: string;
}

/**
 * 해시 재생성 진행 상황
 */
export interface HashRebuildProgress {
  type: 'start' | 'progress' | 'complete' | 'error';
  processed: number;
  total: number;
  currentImage?: string;
  error?: string;
}
