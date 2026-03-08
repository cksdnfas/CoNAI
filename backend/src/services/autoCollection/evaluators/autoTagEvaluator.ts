/**
 * Auto-Tag Evaluator
 *
 * Handles all auto-tag related conditions:
 * - auto_tag_exists
 * - auto_tag_rating
 * - auto_tag_general
 * - auto_tag_character
 * - auto_tag_model
 * - auto_tag_has_character
 * - auto_tag_rating_score
 */

import { AutoCollectCondition } from '@conai/shared';
import { ConditionEvaluator, EvaluableImage } from '../types';
import { ValidatorService } from '../../validatorService';

export class AutoTagEvaluator implements ConditionEvaluator {
  /**
   * Evaluate auto-tag condition
   */
  async evaluate(image: EvaluableImage, condition: AutoCollectCondition): Promise<boolean> {
    const { type } = condition;

    switch (type) {
      case 'auto_tag_exists':
        return this.evaluateAutoTagExists(image, condition);

      case 'auto_tag_rating':
        return this.evaluateRating(image, condition);

      case 'auto_tag_general':
        return this.evaluateGeneralTag(image, condition);

      case 'auto_tag_character':
        return this.evaluateCharacter(image, condition);

      case 'auto_tag_model':
        return this.evaluateModel(image, condition);

      case 'auto_tag_has_character':
        return this.evaluateHasCharacter(image, condition);

      case 'auto_tag_rating_score':
        return await this.evaluateRatingScore(image, condition);

      default:
        return false;
    }
  }

  /**
   * Check if auto tags exist
   */
  private evaluateAutoTagExists(
    image: EvaluableImage,
    condition: AutoCollectCondition
  ): boolean {
    const shouldHaveAutoTags = Boolean(condition.value);
    const hasAutoTags = image.auto_tags !== null && image.auto_tags !== undefined;
    return shouldHaveAutoTags === hasAutoTags;
  }

  /**
   * Evaluate rating condition using ValidatorService
   */
  private evaluateRating(
    image: EvaluableImage,
    condition: AutoCollectCondition
  ): boolean {
    if (!condition.rating_type) {
      return false;
    }

    const autoTags = ValidatorService.parseAutoTags(image.auto_tags);
    if (!autoTags) {
      return false;
    }

    return ValidatorService.validateRating(autoTags, {
      ratingType: condition.rating_type,
      minScore: condition.min_score,
      maxScore: condition.max_score
    });
  }

  /**
   * Evaluate general tag condition using ValidatorService
   */
  private evaluateGeneralTag(
    image: EvaluableImage,
    condition: AutoCollectCondition
  ): boolean {
    if (typeof condition.value !== 'string') {
      return false;
    }

    const autoTags = ValidatorService.parseAutoTags(image.auto_tags);
    if (!autoTags) {
      return false;
    }

    return ValidatorService.validateGeneralTag(autoTags, condition.value, {
      minScore: condition.min_score,
      maxScore: condition.max_score
    });
  }

  /**
   * Evaluate character condition using ValidatorService
   */
  private evaluateCharacter(
    image: EvaluableImage,
    condition: AutoCollectCondition
  ): boolean {
    if (typeof condition.value !== 'string') {
      return false;
    }

    const autoTags = ValidatorService.parseAutoTags(image.auto_tags);
    if (!autoTags) {
      return false;
    }

    return ValidatorService.validateCharacter(autoTags, condition.value, {
      minScore: condition.min_score,
      maxScore: condition.max_score
    });
  }

  /**
   * Evaluate auto-tag model condition using ValidatorService
   */
  private evaluateModel(
    image: EvaluableImage,
    condition: AutoCollectCondition
  ): boolean {
    if (typeof condition.value !== 'string') {
      return false;
    }

    const autoTags = ValidatorService.parseAutoTags(image.auto_tags);
    if (!autoTags) {
      return false;
    }

    return ValidatorService.validateModel(
      autoTags,
      condition.value,
      condition.case_sensitive || false
    );
  }

  /**
   * Evaluate has character condition using ValidatorService
   */
  private evaluateHasCharacter(
    image: EvaluableImage,
    condition: AutoCollectCondition
  ): boolean {
    const autoTags = ValidatorService.parseAutoTags(image.auto_tags);
    if (!autoTags) {
      return false;
    }

    const hasCharacter = ValidatorService.hasCharacter(autoTags);
    const shouldHaveCharacter = Boolean(condition.value);

    return shouldHaveCharacter === hasCharacter;
  }

  /**
   * Evaluate rating score condition (weighted)
   * Uses dynamic import to avoid circular dependencies
   */
  private async evaluateRatingScore(
    image: EvaluableImage,
    condition: AutoCollectCondition
  ): Promise<boolean> {
    const autoTags = ValidatorService.parseAutoTags(image.auto_tags);
    if (!autoTags?.rating) {
      return false;
    }

    try {
      // Validate that all required rating fields are present
      const rating = autoTags.rating;
      if (
        rating.general === undefined ||
        rating.sensitive === undefined ||
        rating.questionable === undefined ||
        rating.explicit === undefined
      ) {
        console.warn('Rating data is incomplete, missing required fields');
        return false;
      }

      // RatingScoreService for weighted score calculation
      const { RatingScoreService } = await import('../../ratingScoreService');
      const scoreResult = await RatingScoreService.calculateScore(
        rating as import('../../../types/autoTag').RatingData
      );
      const score = scoreResult.score;

      // Check min_score
      if (condition.min_score !== undefined && score < condition.min_score) {
        return false;
      }

      // Check max_score
      if (condition.max_score !== undefined && score > condition.max_score) {
        return false;
      }

      return true;
    } catch (error) {
      console.warn('Failed to evaluate rating_score condition:', error);
      return false;
    }
  }

  /**
   * Get condition types handled by this evaluator
   */
  getHandledTypes(): AutoCollectCondition['type'][] {
    return [
      'auto_tag_exists',
      'auto_tag_rating',
      'auto_tag_general',
      'auto_tag_character',
      'auto_tag_model',
      'auto_tag_has_character',
      'auto_tag_rating_score'
    ];
  }
}
