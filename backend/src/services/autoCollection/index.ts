/**
 * Auto Collection Module
 *
 * Central export point for auto-collection functionality
 * Provides backward-compatible interface with original AutoCollectionService
 */

export { AutoCollectionOrchestrator } from './autoCollectionOrchestrator';
export { evaluateCondition, checkImageMatchesConditions, getSupportedConditionTypes } from './conditionEvaluator';
export type { ConditionEvaluator, EvaluableImage } from './types';

// Re-export evaluators for advanced usage
export { RegexEvaluator, AutoTagEvaluator, DuplicateEvaluator } from './evaluators';
