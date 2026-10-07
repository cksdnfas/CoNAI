import { AuthAccount } from '../models/AuthAccount';
import { hasConfiguredAuth } from '../routes/auth-route-helpers';
import { requireRequesterPermission } from '../middleware/featureAccess';
import { requireChatMcpAccountAccess } from '../services/codex-chat/codexChatAccess';
import { requireActiveChatReply } from '../services/codex-chat/chatReplyRegistry';
import { validateMcpToolArguments } from './requestSecurity';
import { CHAT_BLOCKED_TOOLS, CHAT_PAGE_TOOLS, CHAT_ROOM_TOOLS, GENERATION_PRESET_BLOCKED_TOOLS, GROUP_ONLY_CHAT_TOOLS, getMcpToolScope, isChatGenerationTool, isChatMcpSource, isMcpToolAllowed, type McpRequestContext, type McpRequester } from './context';

export const TOOL_FEATURE_PERMISSIONS: Record<string, string | readonly string[]> = {
  search_prompts: 'prompts.view', get_most_used_prompts: 'prompts.view', list_prompt_groups: 'prompts.view',
  list_prompt_presets: 'prompts.view', get_prompt_group_structure: 'prompts.view', get_unclassified_prompts: 'prompts.view',
  get_prompts_in_group: 'prompts.view', backup_prompt_data: 'prompts.view', list_backups: 'prompts.view',
  create_prompt_preset: 'prompts.create', create_prompt_group: 'prompts.create', batch_create_groups: 'prompts.create',
  assign_prompts_to_group: 'prompts.update', move_prompts_between_groups: 'prompts.update',
  restore_prompt_data: ['prompts.create', 'prompts.update', 'prompts.delete'], search_wildcards: 'wildcards.view',
  list_workflows: 'workflows.view', get_workflow_details: 'workflows.view', list_comfyui_servers: 'workflows.view',
  list_custom_dropdown_lists: 'workflows.view', search_custom_dropdown_items: 'workflows.view',
  get_workflow_editor: 'workflows.view', list_workflow_modules: 'workflows.view', propose_workflow_changes: 'workflows.view',
  list_graph_workflows: 'workflows.view', get_graph_workflow_details: 'workflows.view',
  get_graph_workflow_execution: ['workflows.view', 'images.view'], export_workflow_definition: 'workflows.view',
  import_workflow_definition: 'workflows.update', restore_deleted_workflow: 'workflows.update',
  get_generation_routing_options: 'workflows.view', get_generation_history_request: 'images.view',
  refresh_artifact_download: 'images.view',
  search_images: 'images.view', get_image_metadata: 'images.view', get_generation_history: 'images.view',
  search_images_by_tags: 'images.view', view_images: 'images.view', list_emoticons: 'images.view',
  list_emoticon_groups: 'images.view', list_image_groups: 'images.view', get_image_groups: 'images.view',
  add_images_to_group: ['images.view', 'groups.update'], remove_images_from_group: ['images.view', 'groups.update'], move_images_between_groups: ['images.view', 'groups.update'],
  set_emoticon_keywords: ['images.view', 'groups.update'], set_emoticon_group: ['images.view', 'groups.update'],
  get_generation_artifacts: 'images.view', get_generation_job: [], wait_generation_job: [],
  list_files: 'files.view', get_file_info: 'files.view', read_file_text: 'files.view',
  create_file_folder: ['files.view', 'files.organize'], rename_file: ['files.view', 'files.organize'], move_files: ['files.view', 'files.organize'], delete_files: ['files.view', 'files.delete'],
  generate_nai: 'generation.execute', generate_comfyui: ['generation.execute', 'workflows.view'], generate_comfyui_all_servers: ['generation.execute', 'workflows.view'],
  submit_generation_job: 'generation.execute', cancel_generation_job: 'generation.execute', execute_graph_workflow: 'generation.execute',
  get_codex_generation_options: 'generation.execute', resolve_image_group_path: [],
  chat_reply_to: [], room_call_member: [], room_history_search: [], room_history_read: [], read_lore_file: [], save_lore: [],
  get_current_page: [], propose_page_changes: [], read_page_data: [], propose_page_action: [],
  get_chat_setup_guide: [], list_chat_profiles: [], get_chat_profile: [], list_display_blocks: [], get_display_block: [],
  propose_display_block: [], propose_chat_profile: [], propose_profile_update: [], propose_profile_assets: [],
};

/** Initial server-issued grant. No branch bypasses the allowlist or page boundary. */
export function isContextToolAllowed(context: McpRequestContext, toolName: string): boolean {
  if (context.requester && !isChatGenerationTool(toolName) && TOOL_FEATURE_PERMISSIONS[toolName] === undefined) return false;
  if (context.toolAllowlist && !context.toolAllowlist.includes(toolName)) return false;
  if (context.chatContext?.page && !CHAT_PAGE_TOOLS.has(toolName) && !isChatGenerationTool(toolName)) return false;
  if (isChatMcpSource(context.source) && CHAT_BLOCKED_TOOLS.has(toolName)) return false;
  const presetMode = (context.generationPresetIds?.length ?? 0) > 0;
  if (CHAT_ROOM_TOOLS.has(toolName)) return Boolean(context.chatContext)
    && (context.chatRoomTools === 'all' || (context.chatRoomTools === 'call' && ['room_call_member', 'chat_reply_to'].includes(toolName)))
    && (!GROUP_ONLY_CHAT_TOOLS.has(toolName) || context.chatContext?.kind === 'group');
  if (isChatGenerationTool(toolName)) return presetMode && context.scopes.includes('generate');
  return isMcpToolAllowed(toolName, context.scopes) && !(presetMode && GENERATION_PRESET_BLOCKED_TOOLS.has(toolName));
}

/** Never accept a cached or browser-supplied account role as execution authority. */
export function refreshMcpRequester(requester: McpRequester | undefined): void {
  if (!requester) return;
  if (requester.accountId === null) {
    if (hasConfiguredAuth()) throw new Error('An active account is required.');
    requester.accountType = 'admin';
    return;
  }
  const account = AuthAccount.findById(requester.accountId);
  if (!account || account.status !== 'active') throw new Error('An active account is required.');
  requester.accountType = account.account_type;
}

/** Shared website ownership boundary; unbound external MCP keys keep their own contract. */
export function requireMcpResourceOwner(context: McpRequestContext, record: { requested_by_account_id?: number | null; requested_by_account_type?: string | null } | null | undefined, history = false): void {
  if (!context.requester) return;
  refreshMcpRequester(context.requester);
  const requester = context.requester;
  if (!record || (requester.accountType !== 'admin' && (record.requested_by_account_id !== requester.accountId
    || (history && record.requested_by_account_type !== requester.accountType)))) throw new Error('Resource is not accessible to this account.');
}

/** One decision point for both in-process LLM and HTTP Codex tools, immediately before their handlers. */
export function requireMcpToolAccess(context: McpRequestContext, toolName: string, params: Record<string, unknown> = {}, execution: 'reply' | 'queued' = 'reply'): void {
  if (!isContextToolAllowed(context, toolName)) throw new Error('Unknown or not permitted tool.');
  refreshMcpRequester(context.requester);
  if (isChatMcpSource(context.source)) {
    requireChatMcpAccountAccess(context, toolName);
    if (execution === 'reply') {
      requireActiveChatReply(context.chatContext);
      validateMcpToolArguments(params, () => requireRequesterPermission(context.requester, 'images.view'));
    }
  }
  if (context.requester) {
    const required = isChatGenerationTool(toolName) ? ['generation.execute'] : TOOL_FEATURE_PERMISSIONS[toolName];
    if (required === undefined) throw new Error('Unclassified account-bound tool.');
    for (const permission of typeof required === 'string' ? [required] : required) requireRequesterPermission(context.requester, permission);
    if (getMcpToolScope(toolName) === 'configure' && context.requester.accountType !== 'admin') throw new Error('Administrator access required.');
    if (toolName === 'resolve_image_group_path') requireRequesterPermission(context.requester, params.create === false ? 'images.view' : 'groups.create');
    if (toolName === 'add_images_to_group' || getMcpToolScope(toolName) === 'generate' || isChatGenerationTool(toolName)) {
      if (params.group_id || params.group_path) requireRequesterPermission(context.requester, 'groups.update');
      if (params.group_path) requireRequesterPermission(context.requester, 'groups.create');
    }
  }
}
