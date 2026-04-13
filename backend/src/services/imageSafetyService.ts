import { RatingScoreModel } from '../models/RatingScore';

export type ImageFeedVisibility = 'show' | 'blur' | 'hide';

function toSqlNumberLiteral(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric safety boundary: ${value}`);
  }
  return Number.isInteger(value) ? String(value) : String(value);
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
      .map(tier => {
        const lowerBound = `${scoreExpression} >= ${toSqlNumberLiteral(tier.min_score)}`;
        const upperBound = tier.max_score === null || tier.max_score === undefined
          ? null
          : `${scoreExpression} < ${toSqlNumberLiteral(tier.max_score)}`;
        return upperBound ? `(${lowerBound} AND ${upperBound})` : `(${lowerBound})`;
      });

    if (hiddenRanges.length === 0) {
      return '1=1';
    }

    return `(${scoreExpression} IS NULL OR NOT (${hiddenRanges.join(' OR ')}))`;
  }
}
