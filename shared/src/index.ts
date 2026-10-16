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
export { IMAGE_VIEW_PERMISSION } from './constants/imagePermissions';
export { PERMISSION_CATALOG, PERMISSION_KEYS, PAGE_PERMISSION_RULES, withPagePermissions, type PermissionKey, type PermissionSection, type PagePermissionKey } from './constants/permissions';

// Version info
export const VERSION = '26.10.10';

export * from './utils/minimaxDirectorResolution';
export * from './types/fileStore';
export * from './types/workspace';
export * from './types/posts';
export * from './types/contentEvaluation';
export { TOPIC_EVALUATION_LIMITS } from './types/contentEvaluation';
export * from './types/chatAssets'
export * from './utils/chatPortrait'
export * from './constants/pageSettings'
export * from './types/agentCli'
export * from './utils/spriteSampling'
export * from './types/plugin'
export * from './types/loreTranslation'
export * from './utils/pluginNativeApi'
export * from './constants/generationLayout';
