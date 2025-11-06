/**
 * Auto Collection Service (Backward Compatibility Layer)
 *
 * This file maintains the original AutoCollectionService API for backward compatibility.
 * All logic has been refactored into the autoCollection/ directory using Strategy pattern.
 *
 * Original 817 lines with 160-line switch statement → Refactored into modular evaluators
 *
 * Migration Status:
 * - ✅ Condition evaluation logic → autoCollection/evaluators/
 * - ✅ Validation logic → validatorService.ts (Phase 1)
 * - ✅ Orchestration logic → autoCollection/autoCollectionOrchestrator.ts
 * - ✅ Factory pattern → autoCollection/conditionEvaluator.ts
 */

import { AutoCollectCondition, AutoCollectResult } from '@comfyui-image-manager/shared';
import { ImageMetadataRecord } from '../types/image';
import { ImageRecord } from '@comfyui-image-manager/shared';
import { AutoCollectionOrchestrator, checkImageMatchesConditions } from './autoCollection';

/**
 * AutoCollectionService - Backward Compatible Wrapper
 *
 * Delegates to new refactored structure while maintaining original API
 */
export class AutoCollectionService {
  /**
   * Check if a single image matches the group conditions
   * Delegates to refactored conditionEvaluator
   *
   * @param image - ImageMetadataRecord (new) or ImageRecord (legacy)
   * @param conditions - Auto-collection conditions
   * @returns Promise<boolean> - True if image matches any condition
   */
  static async checkImageMatchesConditions(
    image: ImageMetadataRecord | ImageRecord,
    conditions: AutoCollectCondition[]
  ): Promise<boolean> {
    return checkImageMatchesConditions(image, conditions);
  }

  /**
   * Run auto-collection for a specific group
   * Delegates to AutoCollectionOrchestrator
   *
   * @param groupId - Group ID
   * @returns AutoCollectResult with statistics
   */
  static async runAutoCollectionForGroup(groupId: number): Promise<AutoCollectResult> {
    return AutoCollectionOrchestrator.runAutoCollectionForGroup(groupId);
  }

  /**
   * Run auto-collection for all enabled groups
   * Delegates to AutoCollectionOrchestrator
   *
   * @returns Array of AutoCollectResult
   */
  static async runAutoCollectionForAllGroups(): Promise<AutoCollectResult[]> {
    return AutoCollectionOrchestrator.runAutoCollectionForAllGroups();
  }

  /**
   * Run auto-collection for a newly uploaded image
   * Delegates to AutoCollectionOrchestrator
   *
   * @param compositeHash - Image composite hash
   * @returns Array of AutoCollectResult
   */
  static async runAutoCollectionForNewImage(compositeHash: string): Promise<AutoCollectResult[]> {
    return AutoCollectionOrchestrator.runAutoCollectionForNewImage(compositeHash);
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use runAutoCollectionForNewImage(compositeHash: string) instead
   */
  static async runAutoCollectionForNewImageById(
    imageId: number | string
  ): Promise<AutoCollectResult[]> {
    // If imageId is actually a composite_hash string, use it directly
    if (typeof imageId === 'string') {
      console.warn(
        'runAutoCollectionForNewImageById: Received composite_hash, using runAutoCollectionForNewImage'
      );
      return await this.runAutoCollectionForNewImage(imageId);
    }

    // Numeric ID no longer supported
    console.error(
      `runAutoCollectionForNewImageById: Numeric IDs no longer supported. Use composite_hash instead.`
    );
    return [];
  }

  /**
   * Validate conditions array
   * Delegates to AutoCollectionOrchestrator
   *
   * @param conditions - Conditions to validate
   * @returns Validation result with errors
   */
  static validateConditions(
    conditions: AutoCollectCondition[]
  ): { valid: boolean; errors: string[] } {
    return AutoCollectionOrchestrator.validateConditions(conditions);
  }

  // Note: The following private methods have been removed and refactored:
  // - evaluateCondition() → autoCollection/conditionEvaluator.ts
  // - evaluateRatingCondition() → autoCollection/evaluators/autoTagEvaluator.ts
  // - evaluateGeneralTagCondition() → autoCollection/evaluators/autoTagEvaluator.ts
  // - evaluateCharacterCondition() → autoCollection/evaluators/autoTagEvaluator.ts
  // - evaluateAutoTagModelCondition() → autoCollection/evaluators/autoTagEvaluator.ts
  // - evaluateHasCharacterCondition() → autoCollection/evaluators/autoTagEvaluator.ts
  // - evaluateRatingScoreCondition() → autoCollection/evaluators/autoTagEvaluator.ts
  // - evaluateDuplicateCondition() → autoCollection/evaluators/duplicateEvaluator.ts
  // - isComplexFilter() → autoCollection/autoCollectionOrchestrator.ts
  // - runAutoCollectionWithComplexFilter() → autoCollection/autoCollectionOrchestrator.ts
  // - regexCache, getRegex(), escapeRegex() → autoCollection/evaluators/regexEvaluator.ts
}
