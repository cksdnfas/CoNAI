import { AuthAccount } from '../models/AuthAccount';
import { hasConfiguredAuth } from '../services/auth/sessionAccess';
import { isRequesterAdmin, keyGroupPermissionKeys, keyHasGroup, requesterPermissionKeys, requireContextRight, requireRequesterRight, withRequesterPermissionGrant } from '../middleware/featureAccess';
import { ChatProfileStore, isVisionTool, profileSeesImages } from '../services/codex-chat/chatProfiles';
import { requireChatMcpAccountAccess } from '../services/codex-chat/codexChatAccess';
import { requireActiveChatReply } from '../services/codex-chat/chatReplyRegistry';
import { isAgentRoom } from '../services/codex-chat/chatRoomWake';
import { CONTENT_PERMISSIONS, isProposalTool, scopeRequirement, type ContentRight } from '@conai/shared';
import { BoardCallRooms } from '../services/posts/boardCallRooms';
import { validateMcpToolArguments } from './requestSecurity';
import { currentMcpChatPage } from './context';
import { findExternalMcpTool } from '../services/externalMcp/externalMcpServers';
import { findPluginServerTool } from '../services/plugins/pluginServerTools';
import { CHAT_BLOCKED_TOOLS, CHAT_PAGE_TOOLS, CHAT_ROOM_TOOLS, CHAT_SETTINGS_TOOLS, CHAT_VISION_BUILTIN_TOOLS, GENERATION_PRESET_BLOCKED_TOOLS, GROUP_ONLY_CHAT_TOOLS, isPublicChatPage, getMcpToolScope, isChatGenerationTool, isChatMcpSource, isConnectedChatPageTool, isMcpToolAllowed, nativeMcpToolNames, type McpRequestContext, type McpRequester } from './context';

/**
 * Tools that need only a signed-in account (or an HTTP key): the chat's and plugin pages' own plumbing, the jobs and
 * chats the caller owns, the posts and comments the writer owns, web research (the profile's switch decides) and the
 * guides. Their scope is still the chat profile's setting.
 */
const SIGNED_IN_TOOLS = new Set([
  'list_plugin_pages', 'run_plugin_action', 'get_plugin_action', 'cancel_plugin_action',
  'list_chat_rooms', 'view_media_frames', 'get_generation_job', 'wait_generation_job', 'read_chat_attachment',
  'get_current_page', 'page_fill', 'page_act', 'read_page_data', 'propose_page_action', 'get_app_guide',
  'resolve_image_group_path', 'get_codex_generation_options', 'web_search', 'web_read',
  'posts_create', 'posts_update', 'posts_delete', 'posts_restore_revision', 'posts_assess', 'posts_propose_knowledge',
  'post_comment', 'post_comment_edit', 'post_comment_delete',
]);

/**
 * Tools that make new things from library media or audio (copies, sprite sheets, audio takes, exports): no edit, as
 * with generating, but reading their inputs. REST asks the same (the batch-resize, sprite and audio routes).
 */
const READ_INPUT_TOOLS = new Set([
  'resize_images', 'crop_images', 'convert_images', 'save_video_frame', 'clip_video', 'join_videos',
  'extract_sprite_sheet', 'extract_sprite_sheets_batch', 'normalize_sprite_sheets', 'normalize_sprite_sources', 'create_sprite_animation',
  'order_audio', 'wait_audio_order', 'cancel_audio_order', 'retry_audio_order_job', 'export_audio_selected',
]);

/** Tools without a scope: the chat's own (nothing), and its linked files and project workspace (read or edit). */
const UNSCOPED_TOOL_RIGHTS: Record<string, ContentRight | null> = {
  call_agent: null, chat_reply_to: null, room_call_member: null, room_history_search: null, room_history_read: null,
  task_propose: null, task_status: null, task_update: null, task_wait: null, task_finish: null, get_proposal_status: null,
  offer_choices: null, show_form: null, read_lore_file: null, save_lore: null, edit_lore_file: null, use_skill: null,
  get_chat_settings: null, propose_chat_settings: null,
  workspace_list: 'read', workspace_read: 'read', workspace_search: 'read', workspace_apply: 'edit',
  linked_list: 'read', linked_search: 'read', linked_read: 'read', linked_view: 'read', linked_write: 'edit', linked_edit: 'edit',
};

type ToolRequirement = ContentRight | 'signedIn' | 'admin';

/** What the caller must hold for a tool: its scope decides (scopeRequirement). Undefined: unclassified, so refused. */
export function toolRequirement(toolName: string): ToolRequirement | undefined {
  if (ADMIN_ONLY_TOOLS.has(toolName)) return 'admin';
  if (Object.prototype.hasOwnProperty.call(UNSCOPED_TOOL_RIGHTS, toolName)) return UNSCOPED_TOOL_RIGHTS[toolName] ?? 'signedIn';
  const scope = getMcpToolScope(toolName);
  if (!scope) return undefined;
  if (scope === 'configure') return 'admin';
  if (READ_INPUT_TOOLS.has(toolName)) return 'read';
  // External MCP and plugin server tools: their server's scope and the profile decide, not the library rights.
  if (SIGNED_IN_TOOLS.has(toolName) || findExternalMcpTool(toolName) || findPluginServerTool(toolName)) return 'signedIn';
  return scopeRequirement(scope);
}

function meets(requirement: ToolRequirement | undefined, keys: ReadonlySet<string>, admin: boolean): boolean {
  if (requirement === undefined) return false;
  if (requirement === 'admin') return admin;
  return requirement === 'signedIn' || admin || keys.has(CONTENT_PERMISSIONS[requirement]);
}

/** Whether an account holding these keys may use the tool (its chat profile's grant aside). */
export function accountMeetsTool(toolName: string, permissionKeys: readonly string[], isAdmin: boolean): boolean {
  return meets(toolRequirement(toolName), new Set(permissionKeys), isAdmin);
}

/** Every native tool (scoped or not); external MCP and plugin server tools come from their registries. */
export function nativeToolNames(): string[] {
  return [...nativeMcpToolNames(), ...Object.keys(UNSCOPED_TOOL_RIGHTS)];
}

/**
 * A turn answering a posts board call reads posts and comments other people wrote, so plugin actions, lore edits and
 * the room's own history stay closed. The shared file store is open as in any chat (an owner-run instance policy);
 * linked files and the project workspace still follow the profile (see placesForRequest and chatWorkspace).
 */
const BOARD_CALL_BLOCKED_TOOLS = new Set(['run_plugin_action', 'get_plugin_action', 'cancel_plugin_action', 'list_plugin_pages', 'edit_lore_file', 'room_history_search', 'room_history_read']);
/** Posts tools a board-call turn never gets: comments it answers are other people's text, and these cannot be taken back easily. */
const BOARD_CALL_BLOCKED_POST_TOOLS = new Set(['posts_delete', 'posts_restore_revision', 'post_comment_delete']);

/**
 * Writes the web allows administrators only; HTTP keys hold no administrator role. Board categories and comment
 * hiding are for administrators acting as themselves (postTools registers them only then).
 */
const ADMIN_ONLY_TOOLS = new Set(['set_live_wallpaper', 'save_wallpaper_schedule', 'post_comment_hide', 'posts_category_create', 'posts_category_update', 'posts_category_delete']);
export const isAdminOnlyTool = (toolName: string) => ADMIN_ONLY_TOOLS.has(toolName);

/**
 * Keys a shared plugin page lends for one tool (services/plugins/pluginPublicScope registers this; until then none, so
 * an unregistered build fails closed). Role checks (configure scope, administrator-only tools) are never lent.
 */
type PublicPluginToolKeys = (scope: NonNullable<McpRequestContext['pluginPublicScope']>, toolName: string) => readonly string[];
// `var` without an initializer on purpose: the registering module loads inside this module's import cycle, before this
// line runs; a `let` would be in its temporal dead zone then, and an initializer would erase the registration.
// eslint-disable-next-line no-var
var publicPluginToolKeys: PublicPluginToolKeys | undefined;
export function setPublicPluginToolKeys(next: PublicPluginToolKeys) { publicPluginToolKeys = next; }
const lentKeysFor = (scope: NonNullable<McpRequestContext['pluginPublicScope']>, toolName: string) => publicPluginToolKeys?.(scope, toolName) ?? [];
function lentToolKeys(context: McpRequestContext, toolName: string): readonly string[] {
  return context.source === 'plugin' && context.pluginPublicScope && context.requester ? lentKeysFor(context.pluginPublicScope, toolName) : [];
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

/** What the account itself must hold for the tool's scope (a shared plugin page may lend read or edit). */
function accountHoldsTool(context: McpRequestContext, toolName: string): boolean {
  const { keys, admin, profile } = factsFor(context);
  const requirement = toolRequirement(toolName);
  if (!meets(requirement, keys, admin) && !meets(requirement, new Set([...keys, ...lentToolKeys(context, toolName)]), admin)) return false;
  if (isChatMcpSource(context.source) && CHAT_PAGE_TOOLS.has(toolName) && !profile?.pageAssist) return false;
  if (profile && isVisionTool(toolName) && !profileSeesImages(profile)) return false;
  if (profile && (toolName === 'save_lore' || toolName === 'edit_lore_file') && !profile.allowLoreProposals) return false;
  return true;
}

/** An HTTP MCP key's request: no account, a permission group instead (see McpRequestContext.keyGroup). */
function isKeyContext(context: McpRequestContext) {
  return !context.requester && context.keyGroup !== undefined;
}

/** What the key's permission group must hold: what an account of that group would need (never the administrator role). */
const keyListingFacts = new WeakMap<McpRequestContext, { at: number; keys: Set<string>; grouped: boolean }>();
function keyHoldsTool(context: McpRequestContext, toolName: string): boolean {
  let facts = keyListingFacts.get(context);
  if (!facts || Date.now() - facts.at >= 1000) {
    facts = { at: Date.now(), keys: new Set(keyGroupPermissionKeys(context.keyGroup ?? null)), grouped: keyHasGroup(context.keyGroup ?? null) };
    keyListingFacts.set(context, facts);
  }
  const requirement = toolRequirement(toolName);
  // A key is "signed in" only through its group: a groupless key gets nothing that needs signing in.
  return (requirement !== 'signedIn' || facts.grouped) && meets(requirement, facts.keys, false);
}

/**
 * The one decision on whether a tool is offered and may run: the account holds what the web would require, the chat's
 * own tools are always there, and everything else follows the profile's scopes and tool list. Ordinary page connections
 * keep those grants; public pages retain their restricted tools. Page content never supplies authorization.
 * `requireMcpToolAccess` re-runs this before each call, then rechecks the account with explicit errors.
 */
export function isContextToolAllowed(context: McpRequestContext, toolName: string, accountChecks = true): boolean {
  const publicPage = isPublicChatPage(context);
  if (toolName === 'read_chat_attachment' && (!context.requester || !isChatMcpSource(context.source) || !context.chatContext
    || publicPage || BoardCallRooms.runFor(context.chatContext.threadId, context.chatContext.profileId) !== null)) return false;
  if (toolName === 'call_agent' && (!context.chatContext || context.scopes.length === 0
    || (context.toolAllowlist && !context.toolAllowlist.includes(toolName))
    || publicPage
    || BoardCallRooms.runFor(context.chatContext.threadId, context.chatContext.profileId) !== null)) return false;
  if (context.chatContext && (toolName === 'call_agent' || toolName === 'task_propose' || isProposalTool(toolName)) && isAgentRoom(context.chatContext.threadId)) return false;
  if (context.research && !context.research.allowsTool(toolName)) return false;
  if (['list_plugin_drafts', 'create_plugin_draft', 'read_plugin_draft', 'edit_plugin_draft', 'prepare_plugin_install', 'check_plugin_updates'].includes(toolName)) {
    if (!context.requester || !isChatMcpSource(context.source) || context.chatContext?.kind !== 'direct' || BoardCallRooms.runFor(context.chatContext.threadId, context.chatContext.profileId) !== null) return false;
  }
  if (toolName.startsWith('workspace_')) {
    if (publicPage) return false;
    const writes = toolName === 'workspace_apply' || toolName === 'workspace_publish_resources';
    if (context.source === 'plugin') return !!context.workspace && !!context.requester && context.scopes.includes(writes ? 'organize' : 'read') && (!context.toolAllowlist || context.toolAllowlist.includes(toolName)) && (!writes || context.workspace.write) && toolRequirement(toolName) !== undefined && (!accountChecks || accountHoldsTool(context, toolName));
    if (!context.workspaces?.length || !context.chatContext || !isChatMcpSource(context.source)) return false;
    if (writes && !context.workspaces.some((binding) => binding.write)) return false;
    return toolRequirement(toolName) !== undefined && (!accountChecks || accountHoldsTool(context, toolName));
  }
  if ((BOARD_CALL_BLOCKED_TOOLS.has(toolName) || BOARD_CALL_BLOCKED_POST_TOOLS.has(toolName)) && context.chatContext && BoardCallRooms.runFor(context.chatContext.threadId, context.chatContext.profileId) !== null) return false;
  if (context.requester && toolRequirement(toolName) === undefined) return false;
  if (isKeyContext(context) && (toolRequirement(toolName) === undefined || (accountChecks && !keyHoldsTool(context, toolName)))) return false;
  if (isChatMcpSource(context.source) && CHAT_BLOCKED_TOOLS.has(toolName)) return false;
  if (accountChecks && context.requester && !accountHoldsTool(context, toolName)) return false;
  if ((toolName === 'edit_lore_file' || toolName.startsWith('linked_') || toolName.startsWith('room_history_')) && publicPage) return false;
  if (CHAT_SETTINGS_TOOLS.has(toolName)) return Boolean(context.chatContext) && !publicPage && BoardCallRooms.runFor(context.chatContext!.threadId, context.chatContext!.profileId) === null;
  if (CHAT_ROOM_TOOLS.has(toolName)) return Boolean(context.chatContext) && (!GROUP_ONLY_CHAT_TOOLS.has(toolName) || context.chatContext?.kind === 'group');
  if (CHAT_VISION_BUILTIN_TOOLS.has(toolName) && context.chatContext) return true;
  if ((context.generationPresetIds?.length ?? 0) > 0 && GENERATION_PRESET_BLOCKED_TOOLS.has(toolName)) return false;
  // A connected page lists its domain tools directly, but they still follow the profile's tool list and scopes below.
  if (CHAT_PAGE_TOOLS.has(toolName) && isConnectedChatPageTool(context, toolName) && (!accountChecks || !context.requester || factsFor(context).profile?.pageAssist)) return true;
  if (isChatMcpSource(context.source) && CHAT_PAGE_TOOLS.has(toolName)) return false;
  if (publicPage && !isChatGenerationTool(toolName)) return false;
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
  if (context.composerPreview || context.profilePreview) throw new Error('Composer tool listings cannot execute tools.');
  if (!isContextToolAllowed(context, toolName, false)) throw new Error('Unknown or not permitted tool.');
  refreshMcpRequester(context.requester);
  // A shared plugin page lends this tool's keys to the viewer (live: stopping the share revokes them mid-call too). The
  // grant rides on the requester, so the handler's own rechecks see it; the scope is re-read, never trusted from a copy.
  const scope = context.pluginPublicScope;
  if (scope && lentToolKeys(context, toolName).length) context.requester = withRequesterPermissionGrant(context.requester!, () => lentKeysFor(scope, toolName));
  if (isChatMcpSource(context.source)) {
    requireChatMcpAccountAccess(context, toolName);
    if (execution !== 'queued') {
      if (execution === 'reply') requireActiveChatReply(context.chatContext);
      const pluginPageAction = (toolName === 'page_act' || toolName === 'propose_page_action') && currentMcpChatPage(context)?.kind === 'extension';
      // upload_image carries its own media payload: it needs editing (checked below), not reading.
      const onManagedMedia = toolName === 'upload_image' ? undefined : () => requireRequesterRight(context.requester, 'read');
      validateMcpToolArguments(params, onManagedMedia, pluginPageAction || findExternalMcpTool(toolName) !== null || findPluginServerTool(toolName) !== null, { toolName });
    }
  }
  // The account's rights (an HTTP key: its permission group's) for the tool's scope.
  if (context.requester || isKeyContext(context)) {
    const requirement = toolRequirement(toolName);
    if (requirement === undefined) throw new Error('Unclassified account-bound tool.');
    if (requirement === 'admin' && !(context.requester && isRequesterAdmin(context.requester))) {
      throw new Error(toolName === 'set_live_wallpaper' || toolName === 'save_wallpaper_schedule'
        ? 'Administrator access required: only administrators can switch the live wallpaper or save its schedule, as in the wallpaper editor. list_wallpapers still reads the current state.'
        : 'Administrator access required.');
    }
    if (requirement === 'signedIn' && !context.requester && !keyHasGroup(context.keyGroup ?? null)) throw new Error('Permission required: this key has no permission group.');
    if (requirement !== 'admin' && requirement !== 'signedIn') requireContextRight(context, requirement);
    if (toolName === 'resolve_image_group_path') requireContextRight(context, params.create === false ? 'read' : 'edit');
    if (toolName === 'move_image_groups' && params.preview !== true && params.merge_token) requireContextRight(context, 'delete');
    // Generating into an existing group is part of generating (as on REST); a group path may create a group.
    if ((getMcpToolScope(toolName) === 'generate' || isChatGenerationTool(toolName)) && params.group_path) requireContextRight(context, 'edit');
  }
}
