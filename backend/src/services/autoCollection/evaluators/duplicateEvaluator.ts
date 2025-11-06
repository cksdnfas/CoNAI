/**
 * Duplicate Evaluator
 *
 * Handles duplicate image detection conditions:
 * - duplicate_exact (Hamming distance = 0)
 * - duplicate_near (Hamming distance ≤ 5)
 * - duplicate_similar (Hamming distance ≤ 15)
 * - duplicate_custom (custom Hamming distance threshold)
 */

import { AutoCollectCondition } from '@comfyui-image-manager/shared';
import { ConditionEvaluator, EvaluableImage } from '../types';

export class DuplicateEvaluator implements ConditionEvaluator {
  /**
   * Evaluate duplicate condition
   */
  async evaluate(image: EvaluableImage, condition: AutoCollectCondition): Promise<boolean> {
    const { type } = condition;

    // All duplicate conditions require perceptual_hash
    if (!image.perceptual_hash) {
      return false;
    }

    let threshold: number;

    switch (type) {
      case 'duplicate_exact':
        threshold = 0;
        break;

      case 'duplicate_near':
        threshold = 5;
        break;

      case 'duplicate_similar':
        threshold = 15;
        break;

      case 'duplicate_custom':
        if (condition.hamming_threshold === undefined) {
          return false;
        }
        threshold = condition.hamming_threshold;
        break;

      default:
        return false;
    }

    return await this.evaluateDuplicate(image, threshold);
  }

  /**
   * Evaluate duplicate condition using ImageSimilarityModel
   * Uses dynamic import to avoid circular dependencies
   */
  private async evaluateDuplicate(
    image: EvaluableImage,
    threshold: number
  ): Promise<boolean> {
    try {
      // Dynamic import to avoid circular dependencies
      const { ImageSimilarityModel } = await import('../../../models/Image/ImageSimilarityModel');

      // Find duplicates using composite_hash
      const duplicates = await ImageSimilarityModel.findDuplicates(image.composite_hash, {
        threshold,
        includeMetadata: true
      });

      // Return true if any duplicates found
      return duplicates.length > 0;
    } catch (error) {
      console.warn('Failed to evaluate duplicate condition:', error);
      return false;
    }
  }

  /**
   * Get condition types handled by this evaluator
   */
  getHandledTypes(): AutoCollectCondition['type'][] {
    return [
      'duplicate_exact',
      'duplicate_near',
      'duplicate_similar',
      'duplicate_custom'
    ];
  }
}
