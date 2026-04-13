import { RatingScoreModel } from '../models/RatingScore';

export type ImageFeedVisibility = 'show' | 'blur' | 'hide';

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
    return `(
      ${scoreExpression} IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM rating_tiers rt
        WHERE rt.feed_visibility = 'hide'
          AND ${scoreExpression} >= rt.min_score
          AND (rt.max_score IS NULL OR ${scoreExpression} < rt.max_score)
      )
    )`;
  }
}
