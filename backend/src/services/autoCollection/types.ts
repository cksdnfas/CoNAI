/**
 * Common types for auto-collection condition evaluation
 */

import { AutoCollectCondition } from '@comfyui-image-manager/shared';
import { ImageMetadataRecord } from '../../types/image';
import { ImageRecord } from '@comfyui-image-manager/shared';

/**
 * Unified image type for condition evaluation
 * Supports both new (ImageMetadataRecord) and legacy (ImageRecord) formats
 */
export type EvaluableImage = ImageMetadataRecord | ImageRecord;

/**
 * Base interface for condition evaluators
 * Each evaluator implements the Strategy pattern for specific condition types
 */
export interface ConditionEvaluator {
  /**
   * Evaluate whether an image matches the condition
   * @param image - Image to evaluate
   * @param condition - Condition to check
   * @returns Promise resolving to true if condition matches
   */
  evaluate(image: EvaluableImage, condition: AutoCollectCondition): Promise<boolean>;

  /**
   * Get the condition types this evaluator handles
   * Used by the factory for routing
   */
  getHandledTypes(): AutoCollectCondition['type'][];
}

/**
 * Regex cache entry for performance optimization
 */
export interface RegexCacheEntry {
  pattern: string;
  flags?: string;
  regex: RegExp;
}
