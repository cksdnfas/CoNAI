import crypto from 'crypto'
import type { ChatExecutionContext } from '@conai/shared'
import type { Request } from 'express'
import { getMcpToolScope, isChatGenerationTool, CHAT_ROOM_TOOLS, type McpRequester, type McpRequestContext } from '../../mcp/context'
import { AuthAccount } from '../../models/AuthAccount'
import { hasConfiguredAuth } from '../../routes/auth-route-helpers'
import { AuthAccessControlService } from '../authAccessControlService'
import type { McpHttpAuthentication } from '../mcpHttpSettingsService'
import { isDirectLoopbackRequest } from '../../utils/bootstrapAccess'
import { CHAT_SCOPES, loadChatSettings, type ChatScope } from './chatSettings'

const CHAT_MCP_TOKEN_PREFIX = 'conai_chat_'

export const CHAT_PERMISSION_KEYS = {
  codex: 'chat.codex.use',
  llm: 'chat.llm.use',
} as const

const CHAT_TOOL_PERMISSION_KEYS: Record<ChatScope, string> = {
  read: 'chat.tools.read',
  generate: 'chat.tools.generate',
  organize: 'chat.tools.organize',
  configure: 'chat.tools.configure',
}

export type ChatAccess = {
  codex: boolean
  llm: boolean
  /** MCP scopes this account may hand to a chat agent; a chat's own scope setting is intersected with it. */
  scopes: ChatScope[]
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
    codex: has(CHAT_PERMISSION_KEYS.codex),
    llm: has(CHAT_PERMISSION_KEYS.llm),
    scopes: CHAT_SCOPES.filter((scope) => has(CHAT_TOOL_PERMISSION_KEYS[scope])),
  }
}

/** A chat's configured scopes, narrowed to what the chatting account may use. */
export function intersectChatScopes(configured: readonly ChatScope[], access: ChatAccess) {
  return configured.filter((scope) => access.scopes.includes(scope))
}

/** Recheck account revocation for in-process API LLM tools as well as loopback Codex tools. */
export function requireChatMcpAccountAccess(context: McpRequestContext, toolName: string) {
  if (!context.requester || !loadChatSettings().enabled) throw new Error('채팅이 꺼졌거나 사용할 권한이 없어.')
  const access = resolveChatAccess(context.requester.accountId)
  if (context.source === 'codex-chat' ? !access.codex : !access.llm) throw new Error('채팅 권한이 변경됐어.')
  const scope = isChatGenerationTool(toolName) ? 'generate' : getMcpToolScope(toolName)
  if (!CHAT_ROOM_TOOLS.has(toolName) && (!scope || !access.scopes.includes(scope as ChatScope))) throw new Error('이 도구를 사용할 권한이 변경됐어.')
}

const tokens = new Map<string, { requester: McpRequester; scopes: ChatScope[]; toolAllowlist: string[] | null; roomTools: boolean; generationPresetIds: number[]; chatContext?: ChatExecutionContext }>()

/**
 * One token per chat app-server process; it lets that process reach `/mcp` as the chatting account with the
 * scopes its profiles were given (processes are keyed by account + scopes).
 */
export function issueCodexChatMcpToken(requester: McpRequester, scopes: ChatScope[], toolAllowlist: string[] | null, roomTools = false, generationPresetIds: number[] = [], chatContext?: ChatExecutionContext) {
  const token = `${CHAT_MCP_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
  tokens.set(token, { requester, scopes: [...scopes], toolAllowlist: toolAllowlist ? [...toolAllowlist] : null, roomTools, generationPresetIds: [...generationPresetIds], chatContext })
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
  if (!access.codex || (scopes.length === 0 && !grant.roomTools)) {
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
    chatContext: grant.chatContext ? { ...grant.chatContext } : undefined,
  }
}
