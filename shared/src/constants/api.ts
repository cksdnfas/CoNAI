/**
 * API routes and endpoints constants
 */

export const API_PREFIX = '/api' as const;

export const API_ROUTES = {
  IMAGES: `${API_PREFIX}/images`,
  GROUPS: `${API_PREFIX}/groups`,
  PROMPT_COLLECTION: `${API_PREFIX}/prompt-collection`,
  PROMPT_GROUPS: `${API_PREFIX}/prompt-groups`,
  NEGATIVE_PROMPT_GROUPS: `${API_PREFIX}/negative-prompt-groups`,
  SETTINGS: `${API_PREFIX}/settings`,
  WORKFLOWS: `${API_PREFIX}/workflows`,
  COMFYUI_SERVERS: `${API_PREFIX}/comfyui-servers`,
} as const;
