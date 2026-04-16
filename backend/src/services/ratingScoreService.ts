import { RatingScoreModel } from '../models/RatingScore';
import { RatingData } from '../types/autoTag';
import {
  RatingWeights,
  RatingWeightsUpdate,
  RatingTier,
  RatingTierInput,
  RatingScoreResult,
  RatingScoreFilter
} from '../types/rating';

/**
 * RatingScoreService
 * Rating 가중치 점수 계산 및 등급 관리 서비스
 */
export class RatingScoreService {
  /**
   * Rating 데이터로 점수 계산
   * @param ratingData Rating 데이터 (general, sensitive, questionable, explicit)
   * @returns 계산된 점수 및 등급
   */
  static async calculateScore(ratingData: RatingData): Promise<RatingScoreResult> {
    const weights = await RatingScoreModel.getWeights();

    if (!weights) {
      throw new Error('Rating weights not found. Please run database migrations.');
    }

    // 소수점 3자리 반올림 헬퍼 함수
    const round3 = (value: number): number => Math.round(value * 1000) / 1000;

    // 각 항목의 소수점 3자리 반올림 후 가중치 곱셈
    const generalScore = round3(ratingData.general) * weights.general_weight;
    const sensitiveScore = round3(ratingData.sensitive) * weights.sensitive_weight;
    const questionableScore = round3(ratingData.questionable) * weights.questionable_weight;
    const explicitScore = round3(ratingData.explicit) * weights.explicit_weight;

    // 총점 계산
    const totalScore = generalScore + sensitiveScore + questionableScore + explicitScore;

    // 점수로 등급 찾기
    const tier = await RatingScoreModel.getTierByScore(totalScore);

    return {
      score: totalScore,
      tier,
      breakdown: {
        general: generalScore,
        sensitive: sensitiveScore,
        questionable: questionableScore,
        explicit: explicitScore
      },
      rawRating: ratingData
    };
  }

  /**
   * 점수로 등급 조회
   * @param score 계산된 점수
   */
  static async getTierByScore(score: number): Promise<RatingTier | null> {
    return RatingScoreModel.getTierByScore(score);
  }

  /**
   * 가중치 설정 조회
   */
  static async getWeights(): Promise<RatingWeights> {
    const weights = await RatingScoreModel.getWeights();
    if (!weights) {
      throw new Error('Rating weights not found. Please run database migrations.');
    }
    return weights;
  }

  /**
   * 가중치 설정 업데이트
   * @param weights 업데이트할 가중치 (일부만 업데이트 가능)
   */
  static async updateWeights(weights: RatingWeightsUpdate): Promise<RatingWeights> {
    // 가중치 유효성 검증
    this.validateWeights(weights);

    return RatingScoreModel.updateWeights(weights);
  }

  /**
   * 모든 등급 조회
   */
  static async getAllTiers(): Promise<RatingTier[]> {
    return RatingScoreModel.getAllTiers();
  }

  /**
   * 특정 등급 조회
   */
  static async getTierById(id: number): Promise<RatingTier | null> {
    return RatingScoreModel.getTierById(id);
  }

  /**
   * 등급 생성
   */
  static async createTier(tierData: RatingTierInput): Promise<RatingTier> {
    // 등급 유효성 검증
    this.validateTierData(tierData);

    return RatingScoreModel.createTier(tierData);
  }

  /**
   * 등급 수정
   */
  static async updateTier(id: number, tierData: Partial<RatingTierInput>): Promise<RatingTier> {
    // 등급 유효성 검증
    if (tierData.min_score !== undefined || tierData.max_score !== undefined || tierData.tier_order !== undefined) {
      const partialTierData: any = {
        tier_name: tierData.tier_name || '',
        min_score: tierData.min_score ?? 0,
        max_score: tierData.max_score,
        tier_order: tierData.tier_order ?? 0,
        color: tierData.color,
        feed_visibility: tierData.feed_visibility,
      };
      this.validateTierData(partialTierData);
    }

    return RatingScoreModel.updateTier(id, tierData);
  }

  /**
   * 등급 삭제
   */
  static async deleteTier(id: number): Promise<void> {
    return RatingScoreModel.deleteTier(id);
  }

  /**
   * 모든 등급 일괄 업데이트
   * @param tiers 새로운 등급 목록
   */
  static async updateAllTiers(tiers: RatingTierInput[]): Promise<RatingTier[]> {
    // 각 등급 유효성 검증
    tiers.forEach((tier, index) => {
      try {
        this.validateTierData(tier);
      } catch (error) {
        throw new Error(`Invalid tier at index ${index}: ${(error as Error).message}`);
      }
    });

    // tier_order 중복 검증
    const orderSet = new Set(tiers.map(t => t.tier_order));
    if (orderSet.size !== tiers.length) {
      throw new Error('Tier orders must be unique');
    }

    // 점수 구간 겹침 검증
    this.validateTierRanges(tiers);

    return RatingScoreModel.updateAllTiers(tiers);
  }

  /**
   * 가중치 유효성 검증
   */
  private static validateWeights(weights: RatingWeightsUpdate): void {
    const weightKeys = ['general_weight', 'sensitive_weight', 'questionable_weight', 'explicit_weight'] as const;

    for (const key of weightKeys) {
      const value = weights[key];
      if (value !== undefined) {
        if (typeof value !== 'number' || isNaN(value)) {
          throw new Error(`${key} must be a valid number`);
        }
        if (value < 0) {
          throw new Error(`${key} cannot be negative`);
        }
      }
    }
  }

  /**
   * 등급 데이터 유효성 검증
   */
  private static validateTierData(tierData: RatingTierInput): void {
    if (!tierData.tier_name || tierData.tier_name.trim() === '') {
      throw new Error('tier_name is required');
    }

    if (typeof tierData.min_score !== 'number' || isNaN(tierData.min_score)) {
      throw new Error('min_score must be a valid number');
    }

    if (tierData.min_score < 0) {
      throw new Error('min_score cannot be negative');
    }

    if (tierData.max_score !== null) {
      if (typeof tierData.max_score !== 'number' || isNaN(tierData.max_score)) {
        throw new Error('max_score must be a valid number or null');
      }
      if (tierData.max_score <= tierData.min_score) {
        throw new Error('max_score must be greater than min_score');
      }
    }

    if (typeof tierData.tier_order !== 'number' || isNaN(tierData.tier_order)) {
      throw new Error('tier_order must be a valid number');
    }

    if (tierData.tier_order < 0) {
      throw new Error('tier_order cannot be negative');
    }

    if (tierData.feed_visibility !== undefined && !['show', 'blur', 'hide'].includes(tierData.feed_visibility)) {
      throw new Error('feed_visibility must be one of: show, blur, hide');
    }
  }

  /**
   * 등급 점수 구간 겹침 검증
   */
  private static validateTierRanges(tiers: RatingTierInput[]): void {
    // tier_order로 정렬
    const sortedTiers = [...tiers].sort((a, b) => a.tier_order - b.tier_order);

    for (let i = 0; i < sortedTiers.length - 1; i++) {
      const current = sortedTiers[i];
      const next = sortedTiers[i + 1];

      // 현재 등급의 max_score가 null이면 마지막 등급이어야 함
      if (current.max_score === null && i < sortedTiers.length - 1) {
        throw new Error(`Tier "${current.tier_name}" has no max_score but is not the last tier`);
      }

      // 현재 등급의 max_score와 다음 등급의 min_score 비교
      if (current.max_score !== null && current.max_score !== next.min_score) {
        throw new Error(
          `Gap or overlap detected between tier "${current.tier_name}" (max: ${current.max_score}) and tier "${next.tier_name}" (min: ${next.min_score})`
        );
      }
    }

    // 마지막 등급은 max_score가 null이어야 함
    const lastTier = sortedTiers[sortedTiers.length - 1];
    if (lastTier.max_score !== null) {
      throw new Error(`Last tier "${lastTier.tier_name}" must have max_score set to null`);
    }
  }

  /**
   * 점수 필터 조건을 SQL WHERE 절로 변환
   * Search/history-facing score semantics should follow stored media_metadata.rating_score.
   * (autoTagSearchService에서 사용)
   */
  static buildScoreFilterSQL(filter: RatingScoreFilter, _weights?: RatingWeights | null): {
    condition: string;
    params: number[];
  } {
    const conditions: string[] = [];
    const params: number[] = [];

    if (filter.min_score !== undefined) {
      conditions.push(`i.rating_score >= ?`);
      params.push(filter.min_score);
    }

    if (filter.max_score !== undefined) {
      conditions.push(`i.rating_score < ?`);
      params.push(filter.max_score);
    }

    return {
      condition: conditions.join(' AND '),
      params
    };
  }
}
