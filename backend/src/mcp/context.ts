import type { McpHttpScope } from '@conai/shared';
import type { AuthAccountType } from '../types/authAccount';

/** Account that owns the jobs and history a request creates (set for Codex chat sessions). */
export interface McpRequester {
  accountId: number | null;
  accountType: AuthAccountType | null;
}

export interface McpRequestContext {
  scopes: McpHttpScope[];
  keyId?: string;
  keyName?: string;
  baseUrl?: string;
  requester?: McpRequester;
  /** `codex-chat`: an agent acting inside the app on a user's behalf. */
  source?: 'http' | 'codex-chat';
}

/** Codex chat must not spend paid NovelAI multi-sample generations on its own; one image per request is free. */
export function assertChatNaiSampleCount(context: McpRequestContext, nSamples: unknown) {
  if (context.source === 'codex-chat' && typeof nSamples === 'number' && nSamples > 1) {
    throw new Error('n_samples must be 1 in Codex chat (2+ samples cost Anlas). Submit separate requests for more images.');
  }
}

export const ALL_MCP_HTTP_SCOPES: McpHttpScope[] = ['read', 'generate', 'organize', 'backup', 'restore'];

const TOOL_SCOPES: Record<string, McpHttpScope> = {
  list_workflows: 'read',
  list_comfyui_servers: 'read',
  get_generation_routing_options: 'read',
  get_codex_generation_options: 'read',
  get_generation_history_request: 'read',
  list_prompt_presets: 'read',
  get_workflow_details: 'read',
  list_graph_workflows: 'read',
  get_graph_workflow_details: 'read',
  get_graph_workflow_execution: 'read',
  search_images: 'read',
  get_image_metadata: 'read',
  get_generation_history: 'read',
  search_images_by_tags: 'read',
  list_image_groups: 'read',
  get_image_groups: 'read',
  get_prompt_group_structure: 'read',
  get_unclassified_prompts: 'read',
  get_prompts_in_group: 'read',
  list_backups: 'read',
  search_prompts: 'read',
  get_most_used_prompts: 'read',
  list_prompt_groups: 'read',
  list_custom_dropdown_lists: 'read',
  search_custom_dropdown_items: 'read',
  search_wildcards: 'read',
  get_generation_job: 'read',
  get_generation_artifacts: 'read',
  refresh_artifact_download: 'read',
  generate_comfyui: 'generate',
  generate_comfyui_all_servers: 'generate',
  generate_nai: 'generate',
  execute_graph_workflow: 'generate',
  submit_generation_job: 'generate',
  cancel_generation_job: 'generate',
  create_prompt_group: 'organize',
  create_prompt_preset: 'organize',
  batch_create_groups: 'organize',
  resolve_image_group_path: 'organize',
  add_images_to_group: 'organize',
  move_images_between_groups: 'organize',
  remove_images_from_group: 'organize',
  assign_prompts_to_group: 'organize',
  move_prompts_between_groups: 'organize',
  backup_prompt_data: 'backup',
  export_workflow_definition: 'backup',
  restore_prompt_data: 'restore',
  import_workflow_definition: 'restore',
  restore_deleted_workflow: 'restore',
};

export function isMcpToolAllowed(toolName: string, scopes: readonly McpHttpScope[]): boolean {
  const requiredScope = TOOL_SCOPES[toolName];
  return requiredScope !== undefined && scopes.includes(requiredScope);
}
