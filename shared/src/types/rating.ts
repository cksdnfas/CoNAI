/**
 * Rating-related type definitions
 * Shared between backend and frontend
 */

/**
 * Rating data structure (from auto-tagging)
 */
export interface RatingData {
  general: number;
  sensitive: number;
  questionable: number;
  explicit: number;
}

/**
 * Rating weights configuration
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
 * Rating weights update data
 */
export interface RatingWeightsUpdate {
  general_weight?: number;
  sensitive_weight?: number;
  questionable_weight?: number;
  explicit_weight?: number;
}

/**
 * Rating tier (score range)
 */
export interface RatingTier {
  id: number;
  tier_name: string;
  min_score: number;
  max_score: number | null;  // null means infinity
  tier_order: number;
  color: string | null;
  feed_visibility: 'show' | 'blur' | 'hide';
  created_at: string;
  updated_at: string;
}

/**
 * Rating tier creation/update data
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
 * Rating score calculation result
 */
export interface RatingScoreResult {
  score: number;
  tier: RatingTier | null;
  breakdown: {
    general: number;      // Score after weight applied
    sensitive: number;
    questionable: number;
    explicit: number;
  };
  rawRating: RatingData;  // Original rating data
}

/**
 * Rating score filter conditions
 */
export interface RatingScoreFilter {
  min_score?: number;
  max_score?: number;
}

/**
 * Rating score statistics
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
