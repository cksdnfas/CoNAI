import crypto from 'crypto'
import type { ChatExecutionContext } from '@conai/shared'
import type { Request } from 'express'
import { getMcpToolScope, isChatGenerationTool, isConnectedChatPageTool, chatGenerationToolName, CHAT_ROOM_TOOLS, GENERATION_PRESET_BLOCKED_TOOLS, type McpRequester, type McpRequestContext } from '../../mcp/context'
import { AuthAccount } from '../../models/AuthAccount'
import { hasConfiguredAuth } from '../../routes/auth-route-helpers'
import { AuthAccessControlService } from '../authAccessControlService'
import type { McpHttpAuthentication } from '../mcpHttpSettingsService'
import { isDirectLoopbackRequest } from '../../utils/bootstrapAccess'
import { CHAT_SCOPES, loadChatSettings, type ChatScope } from './chatSettings'
import { ChatProfileStore, type ChatProfile } from './chatProfiles'
import { ChatGenerationPresetStore } from './chatGenerationPresets'
import { CodexChatStore } from './codexChatStore'
import { ChatGroupStore } from './chatGroupStore'
import { requireChatPageAccess } from './chatPageContext'

const CHAT_MCP_TOKEN_PREFIX = 'conai_chat_'

export const CHAT_DIAGNOSTICS_PERMISSION_KEYS = {
  view: 'chat.diagnostics.view', content: 'chat.diagnostics.content', prompts: 'chat.diagnostics.prompts',
} as const
export type ChatDiagnosticsScope = 'none' | 'view' | 'content' | 'prompts'

export function diagnosticsScopeOf(permissionKeys: readonly string[]): ChatDiagnosticsScope {
  if (!permissionKeys.includes(CHAT_DIAGNOSTICS_PERMISSION_KEYS.view)) return 'none'
  if (!permissionKeys.includes(CHAT_DIAGNOSTICS_PERMISSION_KEYS.content)) return 'view'
  return permissionKeys.includes(CHAT_DIAGNOSTICS_PERMISSION_KEYS.prompts) ? 'prompts' : 'content'
}

export function narrowDiagnosticsScope(scope: ChatDiagnosticsScope, profileScope: 'view' | 'content' | null | undefined): ChatDiagnosticsScope {
  if (scope === 'none' || scope === 'view' || !profileScope) return scope
  return profileScope === 'view' ? 'view' : 'content'
}

export const CHAT_PERMISSION_KEYS = {
  codex: 'chat.codex.use',
  llm: 'chat.llm.use',
  claude: 'chat.claude.use',
} as const

const CHAT_TOOL_PERMISSION_KEYS: Record<ChatScope, string> = {
  read: 'chat.tools.read',
  generate: 'chat.tools.generate',
  organize: 'chat.tools.organize',
  configure: 'chat.tools.configure',
}

export type ChatAccess = {
  claude: boolean
  codex: boolean
  llm: boolean
  /** MCP scopes this account may hand to a chat agent; a chat's own scope setting is intersected with it. */
  scopes: ChatScope[]
  diagnostics: ChatDiagnosticsScope
}

/**
 * What one account may do with chat, from its permission keys (admins hold every key through the seeded admin
 * group). `null` is the trusted bootstrap owner, allowed everything only while no accounts are configured.
 */
export function resolveChatAccess(accountId: number | null): ChatAccess {
  let permissionKeys: string[]
  if (accountId === null) {
    permissionKeys = hasConfiguredAuth() ? [] : AuthAccessControlService.resolveBootstrapAccess().permissionKeys
  } else {
    const account = AuthAccount.findById(accountId)
    permissionKeys = account?.status === 'active' ? AuthAccessControlService.resolveForAccountId(accountId).permissionKeys : []
  }

  const has = (key: string) => permissionKeys.includes(key)
  return {
    claude: has(CHAT_PERMISSION_KEYS.claude),
    codex: has(CHAT_PERMISSION_KEYS.codex),
    llm: has(CHAT_PERMISSION_KEYS.llm),
    scopes: CHAT_SCOPES.filter((scope) => has(CHAT_TOOL_PERMISSION_KEYS[scope])),
    diagnostics: loadChatSettings().diagnostics.enabled ? diagnosticsScopeOf(permissionKeys) : 'none',
  }
}

/** A chat's configured scopes, narrowed to what the chatting account may use. */
export function intersectChatScopes(configured: readonly ChatScope[], access: ChatAccess) {
  return configured.filter((scope) => access.scopes.includes(scope))
}

/** Linking a generation preset explicitly enables that tool, independently of the general tool selection. */
export function resolveChatProfileToolGrant(profile: Pick<ChatProfile, 'mcpEnabled' | 'mcpScopes' | 'toolAllowlist' | 'generationPresetIds'>, access: ChatAccess) {
  const presetTools = profile.generationPresetIds.map((_, index) => chatGenerationToolName(index))
  const configured: ChatScope[] = [...new Set<ChatScope>([...profile.mcpScopes, ...(presetTools.length ? ['generate' as const] : [])])]
  return {
    scopes: profile.mcpEnabled ? intersectChatScopes(configured, access) : [],
    toolAllowlist: profile.toolAllowlist === null ? null : [...new Set([...profile.toolAllowlist, ...presetTools])],
  }
}

/** Recheck account revocation for in-process API LLM tools as well as loopback Codex tools. */
export function requireChatMcpAccountAccess(context: McpRequestContext, toolName: string) {
  if (!context.requester || !loadChatSettings().enabled) throw new Error('채팅이 꺼졌거나 사용할 권한이 없어.')
  const access = resolveChatAccess(context.requester.accountId)
  const profileEngine = context.chatContext ? ChatProfileStore.find(context.chatContext.profileId)?.engine : 'llm'
  if (context.source === 'codex-chat' ? !access.codex : profileEngine === 'claude' ? !access.claude : !access.llm) throw new Error('채팅 권한이 변경됐어.')
  const scope = isChatGenerationTool(toolName) ? 'generate' : getMcpToolScope(toolName)
  const pageTool = isConnectedChatPageTool(context, toolName)
  if (!pageTool && !CHAT_ROOM_TOOLS.has(toolName) && (!scope || !access.scopes.includes(scope as ChatScope))) throw new Error('이 도구를 사용할 권한이 변경됐어.')
  const chat = context.chatContext
  const profile = chat ? ChatProfileStore.find(chat.profileId) : null
  const thread = chat ? CodexChatStore.findThread(chat.threadId, context.requester.accountId) : null
  if (!chat || !profile?.isEnabled || (context.source === 'codex-chat' ? profile.engine !== 'codex' : profile.engine !== 'llm' && profile.engine !== 'claude') || !thread
    || (chat.kind === 'group' ? !ChatGroupStore.member(chat.threadId, chat.profileId) : thread.profile_id !== chat.profileId)) {
    throw new Error('이 채팅의 프로필 또는 방 접근 권한이 변경됐어.')
  }
  if (pageTool) {
    requireChatPageAccess(context.requester, chat.page!)
  } else {
    const grant = resolveChatProfileToolGrant(profile, access)
    if (grant.toolAllowlist && !grant.toolAllowlist.includes(toolName)) throw new Error('프로필에서 이 도구를 더 이상 허용하지 않아.')
    if (!CHAT_ROOM_TOOLS.has(toolName) && !grant.scopes.includes(scope as ChatScope)) throw new Error('프로필의 도구 사용 설정이 변경됐어.')
  }
  if (toolName === 'view_images' && !profile.visionEnabled) throw new Error('프로필의 이미지 조회가 꺼져 있어.')
  if (toolName === 'save_lore' && !profile.allowLoreProposals) throw new Error('프로필의 로어 제안이 꺼져 있어.')
  if (profile.generationPresetIds.length > 0 && GENERATION_PRESET_BLOCKED_TOOLS.has(toolName)) throw new Error('생성 프리셋만 사용할 수 있어.')
  if (isChatGenerationTool(toolName)) {
    const index = (context.generationPresetIds ?? []).findIndex((_, index) => chatGenerationToolName(index) === toolName)
    if (index < 0 || profile.generationPresetIds[index] !== context.generationPresetIds?.[index]
      || context.generationPresetSnapshot !== JSON.stringify(ChatGenerationPresetStore.resolve(context.generationPresetIds ?? []))) {
      throw new Error('생성 프리셋이 변경됐어. 새 답변에서 다시 사용해 줘.')
    }
  }
}

const tokens = new Map<string, { requester: McpRequester; scopes: ChatScope[]; toolAllowlist: string[] | null; roomTools: boolean; generationPresetIds: number[]; generationPresetSnapshot: string; chatContext?: ChatExecutionContext }>()

/**
 * One token per chat app-server process; it lets that process reach `/mcp` as the chatting account with the
 * scopes its profiles were given (processes are keyed by account + scopes).
 */
export function issueCodexChatMcpToken(requester: McpRequester, scopes: ChatScope[], toolAllowlist: string[] | null, roomTools = false, generationPresetIds: number[] = [], chatContext?: ChatExecutionContext) {
  const token = `${CHAT_MCP_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
  tokens.set(token, { requester: { ...requester }, scopes: [...scopes], toolAllowlist: toolAllowlist ? [...toolAllowlist] : null, roomTools, generationPresetIds: [...generationPresetIds], generationPresetSnapshot: JSON.stringify(ChatGenerationPresetStore.resolve(generationPresetIds)), chatContext })
  return token
}

export function revokeCodexChatMcpToken(token: string) {
  tokens.delete(token)
}

export function setCodexChatExecution(token: string, context: ChatExecutionContext) {
  const grant = tokens.get(token)
  if (!grant || grant.chatContext?.threadId !== context.threadId || grant.chatContext.profileId !== context.profileId) throw new Error('Codex chat binding mismatch')
  grant.chatContext = { ...context }
}

/**
 * Authenticate an internal chat token. Only direct loopback requests qualify (the app-server runs next to the
 * backend), and the grant is re-checked on every call: chat enabled, the account still holds `chat.codex.use`, and the
 * scopes are the profile's, narrowed to the account's current `chat.tools.*` keys.
 * Works while the public HTTP MCP endpoint is disabled.
 */
export function authenticateCodexChatMcpRequest(req: Request, candidate: string | null): McpHttpAuthentication | null {
  if (!candidate?.startsWith(CHAT_MCP_TOKEN_PREFIX) || !isDirectLoopbackRequest(req)) {
    return null
  }

  const grant = tokens.get(candidate)
  if (!grant || !loadChatSettings().enabled) {
    return null
  }
  const { requester } = grant
  const access = resolveChatAccess(requester.accountId)
  const scopes = intersectChatScopes(grant.scopes, access)
  if (!access.codex || (scopes.length === 0 && !grant.roomTools && !(grant.chatContext?.kind === 'direct' && grant.chatContext.page))) {
    return null
  }

  return {
    keyId: `codex-chat:${requester.accountId ?? 'bootstrap'}`,
    keyName: 'Codex chat',
    scopes,
    requester,
    source: 'codex-chat',
    toolAllowlist: grant.toolAllowlist,
    chatRoomTools: grant.roomTools,
    generationPresetIds: grant.generationPresetIds,
    generationPresetSnapshot: grant.generationPresetSnapshot,
    chatContext: grant.chatContext ? { ...grant.chatContext } : undefined,
  }
}
