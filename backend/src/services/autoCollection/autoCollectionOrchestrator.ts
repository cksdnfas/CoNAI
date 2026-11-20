/**
 * Auto Collection Orchestrator
 *
 * Orchestrates auto-collection workflows:
 * - Running auto-collection for groups
 * - Processing new images
 * - Condition validation
 */

import { GroupModel, ImageGroupModel } from '../../models/Group';
import type { AutoCollectCondition, AutoCollectResult, ComplexFilter } from '@conai/shared';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { ComplexFilterService } from '../complexFilterService';
import { checkImageMatchesConditions } from './conditionEvaluator';
import { EvaluableImage } from './types';
import { maybeTruncateImagesWal } from '../../database/walMaintenance';
import { db } from '../../database/init';
import { LIBRARY_BATCH_SIZE, pageBoundary, type LibraryBatchHooks } from '../maintenance/libraryBatch';

class ObsoleteStage extends Error {}

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
  static async runAutoCollectionForGroup(groupId: number, hooks: LibraryBatchHooks = {}): Promise<AutoCollectResult> {
    const startTime = Date.now();
    let added = 0, removed = 0;
    const matches = db.prepare('SELECT 1 FROM groups WHERE id = ? AND auto_collect_enabled = 1 AND auto_collect_conditions = ?');
    // A rule edit joins the live job for this group. Discard its obsolete stage and finish against the saved rules.
    for (;;) {
      hooks.throwIfCancelled?.();
      const group = GroupModel.findById(groupId);
      if (!group || !group.auto_collect_enabled || !group.auto_collect_conditions) {
        throw new Error('Group not found or auto collection not enabled');
      }
      const rules = group.auto_collect_conditions;
      const parsed = JSON.parse(rules);
      const current = () => Boolean(matches.get(groupId, rules));
      const complex = this.isComplexFilter(parsed);
      const stage = (table: string) => complex
        ? this.stageComplexFilter(table, parsed)
        : this.stageLegacyConditions(table, parsed, hooks, current);
      try {
        const diff = await ImageGroupModel.replaceAutoCollectedImagesStaged(groupId, stage, hooks, current);
        removed += diff.removedCount;
        added += diff.addedCount;
        hooks.throwIfCancelled?.();
        if (diff.superseded || !GroupModel.updateAutoCollectLastRun(groupId, rules)) continue;
      } catch (error) {
        if (error instanceof ObsoleteStage) continue;
        throw error;
      }
      maybeTruncateImagesWal(complex ? 'auto-collection-group-complex' : 'auto-collection-group-legacy');
      return { group_id: groupId, group_name: group.name, images_added: added, images_removed: removed, execution_time: Date.now() - startTime };
    }
  }

  private static async stageLegacyConditions(table: string, conditions: AutoCollectCondition[], hooks: LibraryBatchHooks, current: () => boolean) {
    if (!Array.isArray(conditions) || !conditions.length) throw new Error('No valid conditions found');
    // Conditions are OR-ed, so the order only decides how soon a row is accepted. Duplicate conditions each run a
    // similarity search, so they go last and only see rows no cheaper condition already matched.
    const orderedConditions = [
      ...conditions.filter((condition) => !condition.type.startsWith('duplicate_')),
      ...conditions.filter((condition) => condition.type.startsWith('duplicate_')),
    ];

    // Walk the ready rows by rowid (no COUNT, no OFFSET) and stage matches in a TEMP table, so neither the rows nor
    // the matching hashes are ever all in memory and the images.db write lock is only taken by the diff pages.
    const stageHash = db.prepare(`INSERT OR IGNORE INTO ${table} (composite_hash) VALUES (?)`);
    const stagePage = db.transaction((hashes: string[]) => {
      for (const hash of hashes) stageHash.run(hash);
    });
    let cursor = 0;
    for (;;) {
      hooks.throwIfCancelled?.();
      if (!current()) throw new ObsoleteStage();
      const images = MediaMetadataModel.findReadyPageAfterRowid(cursor, LIBRARY_BATCH_SIZE);
      if (!images.length) break;
      cursor = images[images.length - 1].row_id;
      const hashes: string[] = [];
      for (const image of images) {
        if (await checkImageMatchesConditions(image, orderedConditions)) hashes.push(image.composite_hash);
      }
      stagePage(hashes);
      await pageBoundary(hooks);
    }
  }

  private static async stageComplexFilter(table: string, filter: ComplexFilter) {
    const query = await ComplexFilterService.buildComplexSearchHashesQuery(filter, undefined, { includeMediaWithoutActiveFile: true });
    db.prepare(`INSERT OR IGNORE INTO ${table} (composite_hash)
      SELECT composite_hash FROM (${query.query}) AS desired_hashes WHERE composite_hash IS NOT NULL`).run(...query.params);
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

      const groups = GroupModel.findAutoCollectEnabled();
      const results: AutoCollectResult[] = [];
      const collect = db.prepare(`INSERT INTO image_groups (group_id, composite_hash, order_index, collection_type)
        SELECT id, ?, 0, 'auto' FROM groups WHERE id = ? AND auto_collect_enabled = 1 AND auto_collect_conditions = ?
        AND EXISTS (SELECT 1 FROM media_metadata WHERE composite_hash = ?)
        ON CONFLICT(group_id, composite_hash) DO NOTHING`);

      for (const group of groups) {
        try {
          if (!group.auto_collect_conditions) {
            continue;
          }

          const parsedConditions = JSON.parse(group.auto_collect_conditions);
          let matches = false;

          // ComplexFilter format
          if (this.isComplexFilter(parsedConditions)) {
            // New-image auto-collection must only evaluate the current image.
            // Whole-group rebuilds are reserved for explicit user rebuild actions.
            matches = ComplexFilterService.matchesImage(parsedConditions, image);
          } else {
            // Legacy format
            const conditions: AutoCollectCondition[] = parsedConditions;
            matches = await checkImageMatchesConditions(image, conditions);
          }

          if (matches && collect.run(compositeHash, group.id, group.auto_collect_conditions, compositeHash).changes) {
            results.push({ group_id: group.id, group_name: group.name, images_added: 1, images_removed: 0, execution_time: 0 });
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

    const validTypes = [
      'prompt_contains', 'prompt_regex',
      'negative_prompt_contains', 'negative_prompt_regex',
      'ai_tool', 'ai_tool_group', 'model_name', 'lora_model',
      'auto_tag_rating', 'auto_tag_general',
      'auto_tag_character', 'auto_tag_model',
      'auto_tag_has_character', 'auto_tag_exists',
      'auto_tag_rating_score',
      'duplicate_exact', 'duplicate_near',
      'duplicate_similar', 'duplicate_custom'
    ];

    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i];

      if (!condition.type) {
        errors.push(`Condition ${i + 1}: type is required`);
        continue;
      }

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
