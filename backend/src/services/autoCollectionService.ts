import { AutoCollectCondition, AutoCollectResult } from '@conai/shared';
import { AutoCollectionOrchestrator } from './autoCollection';

/** Stable facade for the auto-collection operations used by routes and media pipelines. */
export class AutoCollectionService {
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
}
