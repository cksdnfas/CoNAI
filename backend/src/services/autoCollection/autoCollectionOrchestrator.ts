/**
 * Auto Collection Orchestrator
 *
 * Orchestrates auto-collection workflows:
 * - Running auto-collection for groups
 * - Processing new images
 * - Condition validation
 */

import { GroupModel, ImageGroupModel } from '../../models/Group';
import {
  GroupRecord,
  AutoCollectCondition,
  AutoCollectResult,
  ComplexFilter
} from '@comfyui-image-manager/shared';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { ComplexFilterService } from '../complexFilterService';
import { checkImageMatchesConditions } from './conditionEvaluator';
import { EvaluableImage } from './types';

/**
 * Auto Collection Orchestrator Class
 * Manages all auto-collection workflows
 */
export class AutoCollectionOrchestrator {
  /**
   * Check if conditions are in ComplexFilter format
   */
  private static isComplexFilter(data: any): data is ComplexFilter {
    return data && (
      data.exclude_group !== undefined ||
      data.or_group !== undefined ||
      data.and_group !== undefined
    );
  }

  /**
   * Run auto-collection for a specific group
   * Supports both ComplexFilter and legacy AutoCollectCondition[] formats
   *
   * @param groupId - Group ID to run auto-collection for
   * @returns Auto-collection result with statistics
   */
  static async runAutoCollectionForGroup(groupId: number): Promise<AutoCollectResult> {
    const startTime = Date.now();

    try {
      const group = await GroupModel.findById(groupId);
      if (!group || !group.auto_collect_enabled || !group.auto_collect_conditions) {
        throw new Error('Group not found or auto collection not enabled');
      }

      const parsedConditions = JSON.parse(group.auto_collect_conditions);

      // ComplexFilter format
      if (this.isComplexFilter(parsedConditions)) {
        return await this.runAutoCollectionWithComplexFilter(
          groupId,
          group,
          parsedConditions,
          startTime
        );
      }

      // Legacy format (AutoCollectCondition[])
      const conditions: AutoCollectCondition[] = parsedConditions;
      if (!conditions || conditions.length === 0) {
        throw new Error('No valid conditions found');
      }

      return await this.runAutoCollectionWithLegacyConditions(
        groupId,
        group,
        conditions,
        startTime
      );
    } catch (error) {
      console.error(`Auto collection failed for group ${groupId}:`, error);
      throw error;
    }
  }

  /**
   * Run auto-collection using legacy conditions format
   */
  private static async runAutoCollectionWithLegacyConditions(
    groupId: number,
    group: GroupRecord,
    conditions: AutoCollectCondition[],
    startTime: number
  ): Promise<AutoCollectResult> {
    // Remove existing auto-collected images
    const removedCount = await ImageGroupModel.removeAutoCollectedImages(groupId);

    // Process all images in batches
    let addedCount = 0;
    let page = 1;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const result = await MediaMetadataModel.findAll({ page, limit });
      const images = result.items;

      if (images.length === 0) {
        hasMore = false;
        break;
      }

      for (const image of images) {
        const matches = await checkImageMatchesConditions(image, conditions);
        if (matches) {
          const alreadyInGroup = await ImageGroupModel.isImageInGroup(
            groupId,
            image.composite_hash
          );

          if (!alreadyInGroup) {
            try {
              await ImageGroupModel.addImageToGroup(groupId, image.composite_hash, 'auto');
              addedCount++;
            } catch (err) {
              console.warn('Error adding image to group:', err);
            }
          }
        }
      }

      page++;
      hasMore = images.length === limit;
    }

    // Update last run time
    await GroupModel.updateAutoCollectLastRun(groupId);

    const executionTime = Date.now() - startTime;

    return {
      group_id: groupId,
      group_name: group.name,
      images_added: addedCount,
      images_removed: removedCount,
      execution_time: executionTime
    };
  }

  /**
   * Run auto-collection using ComplexFilter format
   */
  private static async runAutoCollectionWithComplexFilter(
    groupId: number,
    group: GroupRecord,
    complexFilter: ComplexFilter,
    startTime: number
  ): Promise<AutoCollectResult> {
    try {
      // Remove existing auto-collected images
      const removedCount = await ImageGroupModel.removeAutoCollectedImages(groupId);

      // Use ComplexFilterService for efficient querying
      const searchResult = await ComplexFilterService.executeComplexSearch(
        complexFilter,
        undefined,
        { page: 1, limit: 10000 } // Get all matching images
      );

      const matchingImages = searchResult.images;
      let addedCount = 0;

      // Add matching images to group
      for (const image of matchingImages) {
        try {
          const alreadyInGroup = await ImageGroupModel.isImageInGroup(
            groupId,
            image.composite_hash
          );

          if (!alreadyInGroup) {
            await ImageGroupModel.addImageToGroup(groupId, image.composite_hash, 'auto');
            addedCount++;
          }
        } catch (err) {
          console.warn('Error adding image to group:', err);
        }
      }

      // Update last run time
      await GroupModel.updateAutoCollectLastRun(groupId);

      const executionTime = Date.now() - startTime;

      return {
        group_id: groupId,
        group_name: group.name,
        images_added: addedCount,
        images_removed: removedCount,
        execution_time: executionTime
      };
    } catch (error) {
      console.error(`Complex filter auto collection failed for group ${groupId}:`, error);
      throw error;
    }
  }

  /**
   * Run auto-collection for all enabled groups
   */
  static async runAutoCollectionForAllGroups(): Promise<AutoCollectResult[]> {
    try {
      const groups = await GroupModel.findAutoCollectEnabled();
      const results: AutoCollectResult[] = [];

      for (const group of groups) {
        try {
          const result = await this.runAutoCollectionForGroup(group.id);
          results.push(result);
        } catch (error) {
          console.error(`Auto collection failed for group ${group.name} (${group.id}):`, error);
          // Continue processing other groups even if one fails
          results.push({
            group_id: group.id,
            group_name: group.name,
            images_added: 0,
            images_removed: 0,
            execution_time: 0
          });
        }
      }

      return results;
    } catch (error) {
      console.error('Auto collection for all groups failed:', error);
      throw error;
    }
  }

  /**
   * Run auto-collection for a newly uploaded image
   *
   * @param compositeHash - Image composite hash
   * @returns Array of auto-collection results
   */
  static async runAutoCollectionForNewImage(
    compositeHash: string
  ): Promise<AutoCollectResult[]> {
    try {
      // Get image metadata
      const image = MediaMetadataModel.findByHash(compositeHash);
      if (!image) {
        throw new Error(`Image metadata not found for hash: ${compositeHash.substring(0, 16)}...`);
      }

      const groups = await GroupModel.findAutoCollectEnabled();
      const results: AutoCollectResult[] = [];

      for (const group of groups) {
        try {
          if (!group.auto_collect_conditions) {
            continue;
          }

          const parsedConditions = JSON.parse(group.auto_collect_conditions);
          let matches = false;

          // ComplexFilter format
          if (this.isComplexFilter(parsedConditions)) {
            const searchResult = await ComplexFilterService.executeComplexSearch(
              parsedConditions,
              undefined,
              { page: 1, limit: 1 }
            );

            // Check if current image is in results
            matches = searchResult.images.some(
              (img: any) => img.composite_hash === compositeHash
            );
          } else {
            // Legacy format
            const conditions: AutoCollectCondition[] = parsedConditions;
            matches = await checkImageMatchesConditions(image, conditions);
          }

          if (matches) {
            // Check if already in group
            const alreadyInGroup = await ImageGroupModel.isImageInGroup(
              group.id,
              compositeHash
            );

            if (!alreadyInGroup) {
              await ImageGroupModel.addImageToGroup(group.id, compositeHash, 'auto');
              results.push({
                group_id: group.id,
                group_name: group.name,
                images_added: 1,
                images_removed: 0,
                execution_time: 0
              });
            }
          }
        } catch (error) {
          console.error(`Auto collection failed for new image in group ${group.name}:`, error);
        }
      }

      return results;
    } catch (error) {
      console.error('Auto collection for new image failed:', error);
      throw error;
    }
  }

  /**
   * Validate conditions array
   * @param conditions - Conditions to validate
   * @returns Validation result with errors
   */
  static validateConditions(
    conditions: AutoCollectCondition[]
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!Array.isArray(conditions)) {
      errors.push('Conditions must be an array');
      return { valid: false, errors };
    }

    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i];

      if (!condition.type) {
        errors.push(`Condition ${i + 1}: type is required`);
        continue;
      }

      const validTypes = [
        'prompt_contains', 'prompt_regex',
        'negative_prompt_contains', 'negative_prompt_regex',
        'ai_tool', 'model_name',
        'auto_tag_rating', 'auto_tag_general',
        'auto_tag_character', 'auto_tag_model',
        'auto_tag_has_character', 'auto_tag_exists',
        'auto_tag_rating_score',
        'duplicate_exact', 'duplicate_near',
        'duplicate_similar', 'duplicate_custom'
      ];

      if (!validTypes.includes(condition.type)) {
        errors.push(`Condition ${i + 1}: invalid type "${condition.type}"`);
      }

      // Value validation
      if (condition.value === undefined || condition.value === null) {
        errors.push(`Condition ${i + 1}: value is required`);
        continue;
      }

      // Regex validation
      if (condition.type.includes('regex')) {
        try {
          new RegExp(condition.value as string);
        } catch (err) {
          errors.push(`Condition ${i + 1}: invalid regex pattern "${condition.value}"`);
        }
      }

      // Auto-tag specific validation
      if (condition.type.startsWith('auto_tag_')) {
        this.validateAutoTagCondition(condition, i, errors);
      }

      // Duplicate specific validation
      if (condition.type.startsWith('duplicate_')) {
        this.validateDuplicateCondition(condition, i, errors);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate auto-tag specific conditions
   */
  private static validateAutoTagCondition(
    condition: AutoCollectCondition,
    index: number,
    errors: string[]
  ): void {
    // Rating type validation
    if (condition.type === 'auto_tag_rating') {
      if (!condition.rating_type) {
        errors.push(`Condition ${index + 1}: rating_type is required for auto_tag_rating`);
      } else if (!['general', 'sensitive', 'questionable', 'explicit'].includes(condition.rating_type)) {
        errors.push(`Condition ${index + 1}: invalid rating_type "${condition.rating_type}"`);
      }
    }

    // Rating score validation
    if (condition.type === 'auto_tag_rating_score') {
      if (condition.min_score === undefined && condition.max_score === undefined) {
        errors.push(`Condition ${index + 1}: rating_score requires at least min_score or max_score`);
      }
      if (condition.min_score !== undefined && condition.min_score < 0) {
        errors.push(`Condition ${index + 1}: min_score cannot be negative`);
      }
      if (condition.max_score !== undefined && condition.max_score < 0) {
        errors.push(`Condition ${index + 1}: max_score cannot be negative`);
      }
      if (
        condition.min_score !== undefined &&
        condition.max_score !== undefined &&
        condition.min_score >= condition.max_score
      ) {
        errors.push(`Condition ${index + 1}: min_score must be less than max_score`);
      }
    } else {
      // General score validation for other auto-tag conditions
      if (condition.min_score !== undefined && (condition.min_score < 0 || condition.min_score > 1)) {
        errors.push(`Condition ${index + 1}: min_score must be between 0 and 1`);
      }
      if (condition.max_score !== undefined && (condition.max_score < 0 || condition.max_score > 1)) {
        errors.push(`Condition ${index + 1}: max_score must be between 0 and 1`);
      }
      if (
        condition.min_score !== undefined &&
        condition.max_score !== undefined &&
        condition.min_score > condition.max_score
      ) {
        errors.push(`Condition ${index + 1}: min_score cannot be greater than max_score`);
      }
    }

    // Boolean value validation
    if (condition.type === 'auto_tag_exists' || condition.type === 'auto_tag_has_character') {
      if (typeof condition.value !== 'boolean') {
        errors.push(`Condition ${index + 1}: value must be boolean for ${condition.type}`);
      }
    }

    // String value validation
    if (['auto_tag_general', 'auto_tag_character', 'auto_tag_model'].includes(condition.type)) {
      if (typeof condition.value !== 'string') {
        errors.push(`Condition ${index + 1}: value must be string for ${condition.type}`);
      }
    }
  }

  /**
   * Validate duplicate specific conditions
   */
  private static validateDuplicateCondition(
    condition: AutoCollectCondition,
    index: number,
    errors: string[]
  ): void {
    if (condition.type === 'duplicate_custom') {
      if (condition.hamming_threshold === undefined) {
        errors.push(`Condition ${index + 1}: hamming_threshold is required for duplicate_custom`);
      } else if (condition.hamming_threshold < 0 || condition.hamming_threshold > 64) {
        errors.push(`Condition ${index + 1}: hamming_threshold must be between 0 and 64`);
      }
    }
  }
}
