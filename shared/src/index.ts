/**
 * ComfyUI Image Manager - Shared Package
 * Shared types, utilities, and constants for backend and frontend
 */

// Export all types
export * from './types/index';

// Export all utilities
export * from './utils/index';
export {
  parsePrompt,
  parsePromptTerms,
  parsePromptWithLoRAs,
  removeWeights,
  normalizeSearchTerm,
  comparePrompts,
  deduplicatePrompts,
  splitMultiWordBrackets,
  convertNAISyntax,
  refinePrimaryPrompt,
  isLoRAModel,
  removeLoRAWeight,
  cleanPromptTerm,
} from './utils/promptParser';

// Export all constants
export * from './constants/index';

// Version info
export const VERSION = '1.0.0';
