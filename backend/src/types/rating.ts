import { RatingData } from './autoTag';

// Re-export RatingData for convenience
export { RatingData };

/**
 * Rating 가중치 설정
 */
export interface RatingWeights {
  id: number;
  general_weight: number;
  sensitive_weight: number;
  questionable_weight: number;
  explicit_weight: number;
  created_at: string;
  updated_at: string;
}

/**
 * Rating 가중치 업데이트 데이터
 */
export interface RatingWeightsUpdate {
  general_weight?: number;
  sensitive_weight?: number;
  questionable_weight?: number;
  explicit_weight?: number;
}

/**
 * Rating 등급 구간
 */
export interface RatingTier {
  id: number;
  tier_name: string;
  min_score: number;
  max_score: number | null;  // null이면 무한대
  tier_order: number;
  color: string | null;
  feed_visibility: 'show' | 'blur' | 'hide';
  created_at: string;
  updated_at: string;
}

/**
 * Rating 등급 생성/업데이트 데이터
 */
export interface RatingTierInput {
  tier_name: string;
  min_score: number;
  max_score: number | null;
  tier_order: number;
  color?: string | null;
  feed_visibility?: 'show' | 'blur' | 'hide';
}

/**
 * Rating 점수 계산 결과
 */
export interface RatingScoreResult {
  score: number;
  tier: RatingTier | null;
  breakdown: {
    general: number;      // 가중치 적용 후 점수
    sensitive: number;
    questionable: number;
    explicit: number;
  };
  rawRating: RatingData;  // 원본 rating 데이터
}

/**
 * Rating 점수 필터 조건
 */
export interface RatingScoreFilter {
  min_score?: number;
  max_score?: number;
}

/**
 * Rating 점수 통계
 */
export interface RatingScoreStats {
  total_images: number;
  tier_distribution: {
    [tierName: string]: number;
  };
  average_score: number;
  min_score: number;
  max_score: number;
}
