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
export { IMAGE_VIEW_PERMISSION, IMAGE_PERMISSION_CATALOG } from './constants/imagePermissions';
export { FEATURE_READ_PERMISSION_CATALOG } from './constants/featurePermissions';

// Version info
export const VERSION = '26.9.29';

export * from './utils/minimaxDirectorResolution';
export * from './types/fileStore';
export * from './types/chatAssets'
export * from './utils/chatPortrait'
