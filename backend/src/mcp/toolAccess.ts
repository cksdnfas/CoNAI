import { AuthAccount } from '../models/AuthAccount';
import { hasConfiguredAuth } from '../routes/auth-route-helpers';
import { isRequesterAdmin, requesterPermissionKeys, requireRequesterPermission } from '../middleware/featureAccess';
import { ChatProfileStore, isVisionTool, profileSeesImages } from '../services/codex-chat/chatProfiles';
import { requireChatMcpAccountAccess } from '../services/codex-chat/codexChatAccess';
import { requireActiveChatReply } from '../services/codex-chat/chatReplyRegistry';
import { BoardCallRooms } from '../services/posts/boardCallRooms';
import { validateMcpToolArguments } from './requestSecurity';
import { CHAT_BLOCKED_TOOLS, CHAT_ROOM_TOOLS, CHAT_VISION_BUILTIN_TOOLS, GENERATION_PRESET_BLOCKED_TOOLS, GROUP_ONLY_CHAT_TOOLS, getMcpToolScope, isChatGenerationTool, isChatMcpSource, isConnectedChatPageTool, isMcpToolAllowed, type McpRequestContext, type McpRequester } from './context';

export const TOOL_FEATURE_PERMISSIONS: Record<string, string | readonly string[]> = {
  search_prompts: 'prompts.view', get_most_used_prompts: 'prompts.view', list_prompt_groups: 'prompts.view',
  list_prompt_presets: 'prompts.view', get_prompt_group_structure: 'prompts.view', get_unclassified_prompts: 'prompts.view',
  get_prompts_in_group: 'prompts.view', backup_prompt_data: 'prompts.view', list_backups: 'prompts.view',
  create_prompt_preset: 'prompts.edit', create_prompt_group: 'prompts.edit', batch_create_groups: 'prompts.edit',
  assign_prompts_to_group: 'prompts.edit', move_prompts_between_groups: 'prompts.edit',
  restore_prompt_data: 'prompts.edit', search_wildcards: 'wildcards.view',
  list_workflows: 'workflows.view', get_workflow_details: 'workflows.view', list_comfyui_servers: 'workflows.view',
  list_custom_dropdown_lists: 'workflows.view', search_custom_dropdown_items: 'workflows.view',
  get_workflow_editor: 'workflows.view', list_workflow_modules: 'workflows.view', workflow_edit: 'workflows.view',
  list_graph_workflows: 'workflows.view', get_graph_workflow_details: 'workflows.view',
  get_graph_workflow_execution: ['workflows.view', 'images.view'], export_workflow_definition: 'workflows.view',
  import_workflow_definition: 'workflows.edit', restore_deleted_workflow: 'workflows.edit',
  get_generation_routing_options: 'workflows.view', get_generation_history_request: 'images.view',
  refresh_artifact_download: 'images.view', get_media_download: 'images.view',
  search_images: 'images.view', get_image_metadata: 'images.view', get_generation_history: 'images.view',
  search_images_by_tags: 'images.view', view_images: 'images.view', view_media_frames: [], list_emoticons: 'images.view',
  list_emoticon_groups: 'images.view', list_image_groups: 'images.view', get_image_groups: 'images.view', get_image_group: 'images.view',
  add_images_to_group: 'images.edit', remove_images_from_group: 'images.edit', move_images_between_groups: 'images.edit',
  create_image_group: 'images.edit', update_image_group: 'images.edit', run_group_auto_collect: 'images.edit',
  set_emoticon_keywords: 'images.edit', set_emoticon_group: 'images.edit',
  get_generation_artifacts: 'images.view', get_generation_job: [], wait_generation_job: [],
  get_video_info: 'images.view', get_sprite_job: 'images.view', wait_sprite_job: 'images.view', download_sprite_frames: 'images.view',
  extract_sprite_sheet: ['images.edit', 'images.upload'], extract_sprite_sheets_batch: ['images.edit', 'images.upload'],
  normalize_sprite_sheets: ['images.edit', 'images.upload'], create_sprite_animation: ['images.edit', 'images.upload'],
  resize_images: ['images.edit', 'images.upload'],
  list_files: 'files.view', get_file_info: 'files.view', read_file_text: 'files.view', search_files: 'files.view',
  posts_categories: 'posts.view', posts_search: 'posts.view', posts_read: 'posts.view',
  posts_create: ['posts.view', 'posts.write'], posts_update: ['posts.view', 'posts.write'], post_comment: ['posts.view', 'posts.comment'],
  create_file_folder: ['files.view', 'files.edit'], write_text_file: ['files.view', 'files.edit'], update_file_text: ['files.view', 'files.edit'], edit_file_text: ['files.view', 'files.edit'], rename_file: ['files.view', 'files.edit'], move_files: ['files.view', 'files.edit'], delete_files: ['files.view', 'files.delete'],
  generate_nai: 'generation.execute', generate_comfyui: 'generation.execute', generate_comfyui_all_servers: 'generation.execute',
  submit_generation_job: 'generation.execute', cancel_generation_job: 'generation.execute', execute_graph_workflow: 'generation.execute',
  get_codex_generation_options: 'generation.execute', resolve_image_group_path: [],
  list_audio_projects: 'audio.view', list_audio_groups: 'audio.view', list_audio_candidates: 'audio.view',
  get_audio_candidate: 'audio.view', list_audio_group_comments: 'audio.view',
  create_audio_project: ['audio.view', 'audio.edit'], update_audio_project: ['audio.view', 'audio.edit'],
  create_audio_group: ['audio.view', 'audio.edit'], update_audio_group: ['audio.view', 'audio.edit'],
  list_audio_folders: 'audio.view', create_audio_folder: ['audio.view', 'audio.edit'], update_audio_folder: ['audio.view', 'audio.edit'],
  move_audio_candidates: ['audio.view', 'audio.edit'], import_audio: ['audio.view', 'audio.edit'],
  set_audio_group_comment_status: ['audio.view', 'audio.edit'],
  edit_audio_candidate: ['audio.view', 'audio.edit'], delete_unselected_audio_candidates: ['audio.view', 'audio.edit'],
  export_audio_selected: 'audio.view', get_audio_download: 'audio.view',
  list_audio_workflows: 'audio.view', get_audio_order: 'audio.view',
  order_audio: ['audio.view', 'audio.edit', 'generation.execute'], wait_audio_order: 'audio.view',
  cancel_audio_order: ['audio.view', 'audio.edit'], retry_audio_order_job: ['audio.view', 'audio.edit', 'generation.execute'],
  chat_reply_to: [], room_call_member: [], task_propose: [], task_status: [], task_update: [], task_wait: [], task_finish: [], get_proposal_status: [], offer_choices: [], room_history_search: [], room_history_read: [], read_lore_file: [], save_lore: [], edit_lore_file: [],
  linked_list: 'files.view', linked_search: 'files.view', linked_read: 'files.view', linked_write: ['files.view', 'files.edit'], linked_edit: ['files.view', 'files.edit'],
  get_current_page: [], page_fill: [], page_act: [], read_page_data: [], propose_page_action: [],
  get_chat_setup_guide: [], list_chat_profiles: [], get_chat_profile: [], list_display_blocks: [], get_display_block: [],
  propose_display_block: [], propose_chat_profile: [], propose_profile_update: [], propose_profile_assets: [], get_asset_batch: [],
};

const PAGE_SAFE_SCOPES = new Set(['read', 'configure']);

/**
 * A turn answering a posts board call reads posts and comments other people wrote: whatever they ask, it must not
 * reach the caller's private file store.
 */
const BOARD_CALL_BLOCKED_TOOLS = new Set(['list_files', 'get_file_info', 'read_file_text', 'search_files', 'write_text_file', 'update_file_text', 'edit_file_text', 'create_file_folder', 'rename_file', 'move_files', 'delete_files', 'edit_lore_file', 'linked_list', 'linked_search', 'linked_read', 'linked_write', 'linked_edit']);
const PAGE_PRIVATE_FILE_TOOLS = new Set(['list_files', 'get_file_info', 'read_file_text', 'search_files']);

/**
 * Page text may steer the reply, so a connected page keeps only tools that change nothing by themselves: library and
 * catalog reads, and the setup proposals that merely show a card for an administrator to save. Private file contents
 * stay out, and a public workflow page (written by someone else) keeps nothing beyond its own page tools.
 */
function pageKeepsTool(path: string, toolName: string) {
  if (path.startsWith('/public/')) return false;
  return PAGE_SAFE_SCOPES.has(getMcpToolScope(toolName) ?? '') && !PAGE_PRIVATE_FILE_TOOLS.has(toolName);
}

function requiredToolKeys(toolName: string): readonly string[] {
  const required = isChatGenerationTool(toolName) ? 'generation.execute' : TOOL_FEATURE_PERMISSIONS[toolName] ?? [];
  return typeof required === 'string' ? [required] : required;
}

/**
 * Listing asks this once per tool (80-odd) for one context, so the account and profile are read once per context for a
 * moment. Calls never use it: requireMcpToolAccess rechecks the account directly.
 */
const listingFacts = new WeakMap<McpRequestContext, { at: number; keys: Set<string>; admin: boolean; profile: ReturnType<typeof ChatProfileStore.find> }>();
function factsFor(context: McpRequestContext) {
  const cached = listingFacts.get(context);
  if (cached && Date.now() - cached.at < 1000) return cached;
  const requester = context.requester!;
  const facts = {
    at: Date.now(),
    keys: new Set(requesterPermissionKeys(requester)),
    admin: isRequesterAdmin(requester),
    profile: context.chatContext ? ChatProfileStore.find(context.chatContext.profileId) : null,
  };
  listingFacts.set(context, facts);
  return facts;
}

/** What the account itself must hold: the same key the web needs for that action, and the admin role for chat setup. */
function accountHoldsTool(context: McpRequestContext, toolName: string): boolean {
  const { keys, admin, profile } = factsFor(context);
  if (!requiredToolKeys(toolName).every((key) => keys.has(key))) return false;
  if (getMcpToolScope(toolName) === 'configure' && !admin) return false;
  if (profile && isVisionTool(toolName) && !profileSeesImages(profile)) return false;
  if (profile && (toolName === 'save_lore' || toolName === 'edit_lore_file') && !profile.allowLoreProposals) return false;
  return true;
}

/**
 * The one decision on whether a tool is offered and may run: the account holds what the web would require, the chat's
 * own tools are always there, and everything else follows the profile's scopes and tool list. A connected page narrows
 * the reply to its own tools (and linked generation presets), because page text is untrusted input that must not steer
 * the bot into unrelated actions. `requireMcpToolAccess` re-runs this before each call, then rechecks the account with
 * explicit errors.
 */
export function isContextToolAllowed(context: McpRequestContext, toolName: string, accountChecks = true): boolean {
  if (BOARD_CALL_BLOCKED_TOOLS.has(toolName) && context.chatContext && BoardCallRooms.runFor(context.chatContext.threadId, context.chatContext.profileId) !== null) return false;
  if (context.requester && !isChatGenerationTool(toolName) && TOOL_FEATURE_PERMISSIONS[toolName] === undefined) return false;
  if (isChatMcpSource(context.source) && CHAT_BLOCKED_TOOLS.has(toolName)) return false;
  if (accountChecks && context.requester && !accountHoldsTool(context, toolName)) return false;
  // Page text may steer the reply: lore files are not rewritten from it (save_lore still leaves an undoable entry), and
  // linked private files stay out like the file store tools.
  if ((toolName === 'edit_lore_file' || toolName.startsWith('linked_')) && context.chatContext?.page) return false;
  if (CHAT_ROOM_TOOLS.has(toolName)) return Boolean(context.chatContext) && (!GROUP_ONLY_CHAT_TOOLS.has(toolName) || context.chatContext?.kind === 'group');
  if (CHAT_VISION_BUILTIN_TOOLS.has(toolName) && context.chatContext) return true;
  if (isConnectedChatPageTool(context, toolName)) return true;
  if (context.chatContext?.page && !isChatGenerationTool(toolName) && !pageKeepsTool(context.chatContext.page.path, toolName)) return false;
  if (context.toolAllowlist && !context.toolAllowlist.includes(toolName)) return false;
  const presetMode = (context.generationPresetIds?.length ?? 0) > 0;
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

/**
 * One decision point for both in-process LLM and HTTP Codex tools, immediately before their handlers. `after-reply`:
 * a picture an `after` generation preset queues once the reply that asked for it ended (chatGenerationPrompting).
 */
export function requireMcpToolAccess(context: McpRequestContext, toolName: string, params: Record<string, unknown> = {}, execution: 'reply' | 'after-reply' | 'queued' = 'reply'): void {
  if (!isContextToolAllowed(context, toolName, false)) throw new Error('Unknown or not permitted tool.');
  refreshMcpRequester(context.requester);
  if (isChatMcpSource(context.source)) {
    requireChatMcpAccountAccess(context, toolName);
    if (execution !== 'queued') {
      if (execution === 'reply') requireActiveChatReply(context.chatContext);
      validateMcpToolArguments(params, () => requireRequesterPermission(context.requester, 'images.view'));
    }
  }
  if (context.requester) {
    if (!isChatGenerationTool(toolName) && TOOL_FEATURE_PERMISSIONS[toolName] === undefined) throw new Error('Unclassified account-bound tool.');
    for (const permission of requiredToolKeys(toolName)) requireRequesterPermission(context.requester, permission);
    if (getMcpToolScope(toolName) === 'configure' && context.requester.accountType !== 'admin') throw new Error('Administrator access required.');
    if (toolName === 'resolve_image_group_path') requireRequesterPermission(context.requester, params.create === false ? 'images.view' : 'images.edit');
    if (toolName === 'add_images_to_group' || getMcpToolScope(toolName) === 'generate' || isChatGenerationTool(toolName)) {
      if (params.group_id || params.group_path) requireRequesterPermission(context.requester, 'images.edit');
    }
  }
}
