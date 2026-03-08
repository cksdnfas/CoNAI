/**
 * Condition Evaluator Facade
 *
 * Factory pattern implementation for condition evaluation.
 * Routes condition evaluation to appropriate strategy evaluator.
 */

import { AutoCollectCondition } from '@conai/shared';
import { ConditionEvaluator, EvaluableImage } from './types';
import { RegexEvaluator, AutoTagEvaluator, DuplicateEvaluator } from './evaluators';

/**
 * Factory for creating and managing condition evaluators
 */
class ConditionEvaluatorFactory {
  private evaluators: Map<AutoCollectCondition['type'], ConditionEvaluator>;

  constructor() {
    this.evaluators = new Map();
    this.registerEvaluators();
  }

  /**
   * Register all evaluators with their handled condition types
   */
  private registerEvaluators(): void {
    const evaluatorInstances = [
      new RegexEvaluator(),
      new AutoTagEvaluator(),
      new DuplicateEvaluator()
    ];

    for (const evaluator of evaluatorInstances) {
      const types = evaluator.getHandledTypes();
      for (const type of types) {
        this.evaluators.set(type, evaluator);
      }
    }
  }

  /**
   * Get evaluator for specific condition type
   * @param type - Condition type
   * @returns Appropriate evaluator or null if not found
   */
  getEvaluator(type: AutoCollectCondition['type']): ConditionEvaluator | null {
    return this.evaluators.get(type) || null;
  }

  /**
   * Check if condition type is supported
   */
  isSupported(type: AutoCollectCondition['type']): boolean {
    return this.evaluators.has(type);
  }

  /**
   * Get all supported condition types
   */
  getSupportedTypes(): AutoCollectCondition['type'][] {
    return Array.from(this.evaluators.keys());
  }
}

// Singleton instance
const factory = new ConditionEvaluatorFactory();

/**
 * Evaluate a single condition against an image
 * This replaces the 160-line switch statement with Strategy pattern
 *
 * @param image - Image to evaluate
 * @param condition - Condition to check
 * @returns Promise resolving to true if condition matches
 */
export async function evaluateCondition(
  image: EvaluableImage,
  condition: AutoCollectCondition
): Promise<boolean> {
  const evaluator = factory.getEvaluator(condition.type);

  if (!evaluator) {
    console.warn(`No evaluator found for condition type: ${condition.type}`);
    return false;
  }

  try {
    return await evaluator.evaluate(image, condition);
  } catch (error) {
    console.error(`Error evaluating condition type ${condition.type}:`, error);
    return false;
  }
}

/**
 * Check if image matches any of the conditions (OR logic)
 *
 * @param image - Image to evaluate
 * @param conditions - Array of conditions
 * @returns Promise resolving to true if any condition matches
 */
export async function checkImageMatchesConditions(
  image: EvaluableImage,
  conditions: AutoCollectCondition[]
): Promise<boolean> {
  if (!conditions || conditions.length === 0) {
    return false;
  }

  for (const condition of conditions) {
    if (await evaluateCondition(image, condition)) {
      return true; // OR logic - one match is enough
    }
  }

  return false;
}

/**
 * Get all supported condition types
 * Useful for validation and documentation
 */
export function getSupportedConditionTypes(): AutoCollectCondition['type'][] {
  return factory.getSupportedTypes();
}

/**
 * Validate if condition type is supported
 */
export function isConditionTypeSupported(type: AutoCollectCondition['type']): boolean {
  return factory.isSupported(type);
}
