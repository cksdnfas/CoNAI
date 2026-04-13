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
}
