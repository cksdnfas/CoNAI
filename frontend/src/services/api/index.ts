/**
 * API Services Index
 *
 * Central export point for all API services.
 * Maintains backward compatibility with the original api.ts structure.
 *
 * Usage:
 *   import { imageApi, groupApi } from '@/services/api';
 *   import { API_BASE_URL } from '@/services/api';
 */

// Re-export API client and base URL
export { default as api, API_BASE_URL } from './apiClient';
export { default } from './apiClient';

// Re-export all domain APIs (refactored from monolithic api.ts)
export { imageApi } from './imageApi';
export { groupApi } from './groupApi';
export { promptCollectionApi, promptGroupApi } from './promptApi';
export { uploadApi } from './uploadApi';
export { generationHistoryApi } from './generationHistoryApi';
export { naiApi } from './naiApi';

// Re-export existing API modules
export { workflowApi } from './workflowApi';
export type { Workflow, MarkedField, GenerationHistory } from './workflowApi';

// For backward compatibility, also export as default object
import { imageApi } from './imageApi';
import { groupApi } from './groupApi';
import { promptCollectionApi, promptGroupApi } from './promptApi';
import { uploadApi } from './uploadApi';
import { generationHistoryApi } from './generationHistoryApi';
import { naiApi } from './naiApi';
import { workflowApi } from './workflowApi';

export const allApis = {
  imageApi,
  groupApi,
  promptCollectionApi,
  promptGroupApi,
  uploadApi,
  generationHistoryApi,
  naiApi,
  workflowApi,
};
