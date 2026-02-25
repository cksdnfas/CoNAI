export interface RatingData {
    general: number;
    sensitive: number;
    questionable: number;
    explicit: number;
}
export interface RatingWeights {
    id: number;
    general_weight: number;
    sensitive_weight: number;
    questionable_weight: number;
    explicit_weight: number;
    created_at: string;
    updated_at: string;
}
export interface RatingWeightsUpdate {
    general_weight?: number;
    sensitive_weight?: number;
    questionable_weight?: number;
    explicit_weight?: number;
}
export interface RatingTier {
    id: number;
    tier_name: string;
    min_score: number;
    max_score: number | null;
    tier_order: number;
    color: string | null;
    created_at: string;
    updated_at: string;
}
export interface RatingTierInput {
    tier_name: string;
    min_score: number;
    max_score: number | null;
    tier_order: number;
    color?: string | null;
}
export interface RatingScoreResult {
    score: number;
    tier: RatingTier | null;
    breakdown: {
        general: number;
        sensitive: number;
        questionable: number;
        explicit: number;
    };
    rawRating: RatingData;
}
export interface RatingScoreFilter {
    min_score?: number;
    max_score?: number;
}
export interface RatingScoreStats {
    total_images: number;
    tier_distribution: {
        [tierName: string]: number;
    };
    average_score: number;
    min_score: number;
    max_score: number;
}
//# sourceMappingURL=rating.d.ts.map