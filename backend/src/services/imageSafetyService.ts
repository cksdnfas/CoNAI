import { RatingScoreModel } from '../models/RatingScore';

export type ImageFeedVisibility = 'show' | 'blur' | 'hide';

function toSqlNumberLiteral(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric safety boundary: ${value}`);
  }
  return Number.isInteger(value) ? String(value) : String(value);
}

function tierRangeCondition(scoreExpression: string, tier: { min_score: number; max_score?: number | null }): string {
  const lowerBound = `${scoreExpression} >= ${toSqlNumberLiteral(tier.min_score)}`;
  return tier.max_score === null || tier.max_score === undefined
    ? `(${lowerBound})`
    : `(${lowerBound} AND ${scoreExpression} < ${toSqlNumberLiteral(tier.max_score)})`;
}

/** Resolve the current visibility policy from one image rating score. */
export class ImageSafetyService {
  static resolveFeedVisibility(score: number | null | undefined): ImageFeedVisibility {
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      return 'show';
    }

    const tier = RatingScoreModel.getTierByScore(score);
    return tier?.feed_visibility ?? 'show';
  }

  static isHidden(score: number | null | undefined): boolean {
    return this.resolveFeedVisibility(score) === 'hide';
  }

  /** Build an SQL condition that excludes images mapped to hidden rating tiers. */
  static buildVisibleScoreCondition(scoreExpression: string): string {
    const hiddenRanges = RatingScoreModel.getAllTiers()
      .filter(tier => tier.feed_visibility === 'hide')
      .map(tier => tierRangeCondition(scoreExpression, tier));

    if (hiddenRanges.length === 0) {
      return '1=1';
    }

    return `(${scoreExpression} IS NULL OR NOT (${hiddenRanges.join(' OR ')}))`;
  }

  /**
   * SQL condition passing what contentRating.scoreWithinLimit passes for a ceiling tier id: a score in that tier or one
   * ordered before it. Unrated (NULL) and a deleted ceiling pass nothing.
   */
  static buildRatingCeilingCondition(scoreExpression: string, ceilingTierId: number): string {
    const tiers = RatingScoreModel.getAllTiers();
    const ceiling = tiers.find(tier => tier.id === ceilingTierId);
    const ranges = ceiling
      ? tiers.filter(tier => tier.tier_order <= ceiling.tier_order).map(tier => tierRangeCondition(scoreExpression, tier))
      : [];
    return ranges.length > 0 ? `(${ranges.join(' OR ')})` : '0=1';
  }
}
