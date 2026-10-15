import type { McpHttpScope, ChatExecutionContext, FileWriteSource } from '@conai/shared';
import type { AuthAccountType } from '../types/authAccount';
import { findExternalMcpTool } from '../services/externalMcp/externalMcpServers';
import { findPluginServerTool } from '../services/plugins/pluginServerTools';

/** Account that owns the jobs and history a request creates (set for Codex chat sessions). */
export interface McpRequester {
  accountId: number | null;
  accountType: AuthAccountType | null;
}

/** Who a file tool's write is recorded as (see FileStoreRevisions): the chat reply it ran in, or the MCP key's account. */
export function fileWriteSource(context: McpRequestContext): FileWriteSource {
  const accountId = context.requester?.accountId ?? null;
  const chat = context.chatContext;
  return chat ? { via: 'chat', accountId, threadId: chat.threadId, profileId: chat.profileId, ...(chat.replyId ? { replyId: chat.replyId } : {}) } : { via: 'mcp', accountId };
}

export interface McpRequestContext {
  /** Internal native-tool bridge; prevents recursive plugin registration. */
  omitPluginTools?: boolean;
  /** Server-resolved project; never accepted from model arguments. */
  workspace?: import('@conai/shared').WorkspaceBinding | null;
  chatContext?: ChatExecutionContext;
  scopes: McpHttpScope[];
  keyId?: string;
  keyName?: string;
  /**
   * HTTP MCP keys (no requester): the key's permission group, whose feature keys decide its tools as an account's
   * groups do (null: no group, so no tools). Undefined for every other caller.
   */
  keyGroup?: string | null;
  baseUrl?: string;
  requester?: McpRequester;
  /** `codex-chat` / `llm-chat`: an agent acting inside the app on a user's behalf. */
  source?: 'http' | 'codex-chat' | 'llm-chat' | 'plugin';
  /** Chat profiles can narrow the tools further than the scopes (null/undefined: every tool the scopes allow). */
  toolAllowlist?: string[] | null;
  /**
   * Chat profiles with generation presets: each becomes a `generate_image` tool, and the free-form generation and
   * execution tools are withheld so the model draws only through the presets. Authorized reads stay available.
   */
  generationPresetIds?: number[];
  /** Server-issued snapshot; edited presets require a fresh bridge/session before execution. */
  generationPresetSnapshot?: string;
  /**
   * The content rating ceiling of the model behind this request (a rating tier id; null: none). Unset: derived
   * from the chat profile, if any (chatContentRating.ts).
   */
  contentRatingLimit?: number | null;
  /** false: a chat source lists every tool directly instead of behind open_tools / run_tool (the admin tool picker). */
  toolCatalog?: boolean;
  /** Internal API-chat callback; never accepted from HTTP input. */
  toolCatalogBudget?: () => number;
}

/** The tool name of the n-th generation preset a chat profile links (generate_image, generate_image_2, …). */
export function chatGenerationToolName(index: number) {
  return index === 0 ? 'generate_image' : `generate_image_${index + 1}`;
}

export function isChatGenerationTool(toolName: string) {
  return /^generate_image(_\d+)?$/.test(toolName);
}

/** Presets constrain generation, not authorized workflow discovery or diagnostics. */
export const GENERATION_PRESET_BLOCKED_TOOLS = new Set([
  'generate_nai', 'generate_comfyui', 'generate_comfyui_all_servers', 'submit_generation_job', 'execute_graph_workflow',
]);

export function isChatMcpSource(source: McpRequestContext['source']) {
  return source === 'codex-chat' || source === 'llm-chat';
}

/**
 * Withheld from chat agents: a chat reply must not block on a generation job (Codex jobs can run for minutes).
 * The job is linked to the reply at submission and the app attaches the result when it lands.
 */
export const CHAT_BLOCKED_TOOLS = new Set(['wait_generation_job', 'wait_audio_order', 'execute_graph_workflow', 'import_workflow_definition']);
/** A page grants a bounded input task; explicitly linked generation presets keep their independent grant. */
export const CHAT_PAGE_TOOLS = new Set(['get_current_page', 'page_fill', 'page_act', 'get_workflow_editor', 'list_workflow_modules', 'workflow_edit', 'read_page_data', 'propose_page_action']);

/**
 * Tools a connected page of one kind adds to the page tools: the sprite page works through its own engine tools, so
 * connecting it must not hide them. The audio page adds its workspace, review and comment tools. Without the page
 * they follow the profile grants through the catalog. The account's feature keys still apply to each call.
 */
export const CHAT_PAGE_KIND_TOOLS: Partial<Record<string, ReadonlySet<string>>> = {
  extension: new Set(['list_plugin_pages', 'run_plugin_action', 'get_plugin_action', 'cancel_plugin_action']),
  sprite: new Set(['get_video_info', 'get_sprite_job', 'extract_sprite_sheet', 'extract_sprite_sheets_batch', 'normalize_sprite_sheets', 'create_sprite_animation', 'download_sprite_frames']),
  audio: new Set([
    'list_audio_projects', 'list_audio_groups', 'list_audio_candidates', 'get_audio_candidate', 'list_audio_group_comments',
    'create_audio_project', 'update_audio_project', 'create_audio_group', 'update_audio_group', 'move_audio_candidates', 'import_audio',
    'list_audio_folders', 'create_audio_folder', 'update_audio_folder',
    'set_audio_candidate_review', 'delete_audio_candidate', 'create_audio_group_comment', 'update_audio_group_comment', 'delete_audio_group_comment',
    'set_audio_group_comment_status', 'list_audio_workflows', 'order_audio', 'get_audio_order', 'cancel_audio_order', 'retry_audio_order_job',
    'edit_audio_candidate', 'delete_unselected_audio_candidates', 'export_audio_selected', 'get_audio_download',
  ]),
};

/** Page tools are enabled by the user's explicit connection, independently of general profile tools. */
export function isConnectedChatPageTool(context: McpRequestContext, toolName: string) {
  const page = context.chatContext?.page;
  return isChatMcpSource(context.source) && context.chatContext?.kind === 'direct' && !!page
    && (CHAT_PAGE_TOOLS.has(toolName) || Boolean(CHAT_PAGE_KIND_TOOLS[page.kind]?.has(toolName)));
}

/** Chat agents must not spend paid NovelAI multi-sample generations on their own; one image per request is free. */
export function assertChatNaiSampleCount(context: McpRequestContext, nSamples: unknown) {
  if ((isChatMcpSource(context.source) || context.source === 'plugin') && typeof nSamples === 'number' && nSamples > 1) {
    throw new Error('n_samples must be 1 in chat (2+ samples cost Anlas). Submit separate requests for more images.');
  }
}

export const ALL_MCP_HTTP_SCOPES: McpHttpScope[] = ['read', 'generate', 'organize', 'backup', 'restore'];

const TOOL_SCOPES: Record<string, McpHttpScope> = {
  workspace_publish_resources: 'organize',
  list_group_resources: 'read',
  list_plugin_pages: 'read',
  run_plugin_action: 'read',
  get_plugin_action: 'read',
  cancel_plugin_action: 'read',
  web_search: 'read',
  web_read: 'read',
  get_app_guide: 'read',
  get_current_page: 'read',
  page_fill: 'read',
  page_act: 'read',
  read_page_data: 'read',
  propose_page_action: 'read',
  get_workflow_editor: 'read',
  list_workflow_modules: 'read',
  workflow_edit: 'read',
  list_files: 'read',
  get_file_info: 'read',
  read_file_text: 'read',
  search_files: 'read',
  list_file_versions: 'read',
  read_file_version: 'read',
  posts_categories: 'read',
  posts_search: 'read',
  posts_read: 'read',
  posts_create: 'organize',
  posts_update: 'organize',
  post_comment: 'organize',
  posts_tags: 'read',
  posts_revisions: 'read',
  posts_delete: 'organize',
  posts_restore_revision: 'organize',
  posts_assess: 'organize',
  posts_propose_knowledge: 'organize',
  post_comment_edit: 'organize',
  post_comment_delete: 'organize',
  post_comment_hide: 'organize',
  posts_category_create: 'organize',
  posts_category_update: 'organize',
  posts_category_delete: 'organize',
  list_emoticon_groups: 'read',
  list_emoticons: 'read',
  view_images: 'read',
  view_media_frames: 'read',
  set_emoticon_keywords: 'organize',
  set_emoticon_group: 'organize',
  create_file_folder: 'organize',
  write_text_file: 'organize',
  update_file_text: 'organize',
  edit_file_text: 'organize',
  rename_file: 'organize',
  move_files: 'organize',
  delete_files: 'organize',
  restore_file_version: 'organize',
  list_workflows: 'read',
  list_comfyui_servers: 'read',
  get_generation_routing_options: 'read',
  get_codex_generation_options: 'read',
  get_generation_history_request: 'read',
  list_prompt_presets: 'read',
  get_workflow_details: 'read',
  check_comfy_workflow: 'read',
  list_graph_workflows: 'read',
  get_graph_workflow_details: 'read',
  get_graph_workflow_execution: 'read',
  list_chat_rooms: 'read',
  search_images: 'read',
  get_image_metadata: 'read',
  get_generation_history: 'read',
  search_images_by_tags: 'read',
  search_images_by_meaning: 'read',
  find_similar_images: 'read',
  list_image_groups: 'read',
  get_image_groups: 'read',
  get_image_group: 'read',
  get_prompt_group_structure: 'read',
  get_prompts_in_group: 'read',
  list_backups: 'read',
  search_prompts: 'read',
  get_most_used_prompts: 'read',
  list_prompt_groups: 'read',
  list_custom_dropdown_lists: 'read',
  search_custom_dropdown_items: 'read',
  search_wildcards: 'read',
  get_generation_job: 'read',
  wait_generation_job: 'read',
  get_generation_artifacts: 'read',
  refresh_artifact_download: 'read',
  get_media_download: 'read',
  get_video_info: 'read',
  get_sprite_job: 'read',
  download_sprite_frames: 'read',
  extract_sprite_sheet: 'generate',
  extract_sprite_sheets_batch: 'generate',
  normalize_sprite_sheets: 'generate',
  create_sprite_animation: 'generate',
  resize_images: 'generate',
  generate_comfyui: 'generate',
  generate_comfyui_all_servers: 'generate',
  generate_nai: 'generate',
  execute_graph_workflow: 'generate',
  submit_generation_job: 'generate',
  cancel_generation_job: 'generate',
  create_prompt_preset: 'organize',
  batch_create_groups: 'organize',
  resolve_image_group_path: 'organize',
  add_images_to_group: 'organize',
  move_images_between_groups: 'organize',
  create_image_group: 'organize',
  update_image_group: 'organize',
  run_group_auto_collect: 'organize',
  remove_images_from_group: 'organize',
  move_prompts_between_groups: 'organize',
  backup_prompt_data: 'backup',
  export_workflow_definition: 'backup',
  restore_prompt_data: 'restore',
  import_workflow_definition: 'restore',
  restore_deleted_workflow: 'restore',
  // Audio workspace, including user-requested review and comment changes.
  list_audio_projects: 'read',
  list_audio_groups: 'read',
  list_audio_candidates: 'read',
  get_audio_candidate: 'read',
  list_audio_group_comments: 'read',
  create_audio_project: 'organize',
  update_audio_project: 'organize',
  create_audio_group: 'organize',
  update_audio_group: 'organize',
  list_audio_folders: 'read',
  create_audio_folder: 'organize',
  update_audio_folder: 'organize',
  move_audio_candidates: 'organize',
  import_audio: 'organize',
  set_audio_group_comment_status: 'organize',
  set_audio_candidate_review: 'organize',
  delete_audio_candidate: 'organize',
  create_audio_group_comment: 'organize',
  update_audio_group_comment: 'organize',
  delete_audio_group_comment: 'organize',
  edit_audio_candidate: 'organize',
  delete_unselected_audio_candidates: 'organize',
  // Whole effect / folder / project deletes require the general organize grant.
  delete_audio_group: 'organize',
  delete_audio_folder: 'organize',
  delete_audio_project: 'organize',
  export_audio_selected: 'organize',
  get_audio_download: 'read',
  list_audio_workflows: 'read',
  get_audio_order: 'read',
  order_audio: 'generate',
  wait_audio_order: 'generate',
  cancel_audio_order: 'generate',
  retry_audio_order_job: 'generate',
  // Chat-only: HTTP keys never hold `configure` (admin chat accounts only), and propose_* only shows a card a person saves.
  get_chat_setup_guide: 'configure',
  list_chat_profiles: 'configure',
  get_chat_profile: 'configure',
  list_display_blocks: 'configure',
  get_display_block: 'configure',
  propose_display_block: 'configure',
  propose_chat_profile: 'configure',
  propose_profile_update: 'configure',
  propose_profile_assets: 'configure',
  get_asset_batch: 'configure',
};

/**
 * Tools over the caller's own chat (its room, its history, its attached lorebooks), offered to chat agents in a chat
 * regardless of scopes; not CoNAI actions, so they do not bring the app tool guidance along.
 */
export const CHAT_ROOM_TOOLS = new Set(['chat_reply_to', 'room_call_member', 'room_history_search', 'room_history_read', 'read_lore_file', 'save_lore', 'edit_lore_file', 'linked_list', 'linked_search', 'linked_read', 'linked_write', 'linked_edit', 'task_propose', 'task_status', 'task_update', 'task_wait', 'task_finish', 'get_proposal_status', 'offer_choices']);

/**
 * The room tools only a group room offers. A direct chat keeps chat_reply_to (it quotes an earlier message of the
 * chat, see offersChatReplyTo), the lorebook tools and the history tools (its own history, and that of the chats
 * sharing its knowledge: see chatHistorySearch).
 */
export const GROUP_ONLY_CHAT_TOOLS = new Set(['room_call_member']);

/**
 * Tools every chat whose model sees images has, whatever the profile's scopes and tool list and the account's chat
 * scopes (the vision switch still applies: isVisionTool). What they open is checked item by item instead: library media
 * needs images.view, a stored file its owner.
 */
export const CHAT_VISION_BUILTIN_TOOLS = new Set(['view_media_frames']);

/**
 * The chat's own settings (linked lorebooks, record book, linked files, minutes) and how its features work: offered in
 * every chat regardless of scopes like the room tools, but not listed directly (the tool catalog keeps them under
 * `chat`), since they matter only when the person asks.
 */
export const CHAT_SETTINGS_TOOLS = new Set(['get_chat_settings', 'propose_chat_settings']);

/** The chat's own tools, which do not count as the profile having tools (no tool guidance, no tool budget). */
export function isChatOwnTool(toolName: string) {
  return CHAT_ROOM_TOOLS.has(toolName) || CHAT_VISION_BUILTIN_TOOLS.has(toolName) || CHAT_SETTINGS_TOOLS.has(toolName);
}

export function getMcpToolScope(toolName: string): McpHttpScope | null {
  if (isChatGenerationTool(toolName)) return 'generate';
  // An external MCP server's tools take the scope its administrator gave it, a plugin's the scope its module gave.
  return TOOL_SCOPES[toolName] ?? findExternalMcpTool(toolName)?.scope ?? findPluginServerTool(toolName)?.scope ?? null;
}

export function isMcpToolAllowed(toolName: string, scopes: readonly McpHttpScope[]): boolean {
  const requiredScope = TOOL_SCOPES[toolName] ?? findExternalMcpTool(toolName)?.scope ?? findPluginServerTool(toolName)?.scope;
  return requiredScope !== undefined && scopes.includes(requiredScope);
}
