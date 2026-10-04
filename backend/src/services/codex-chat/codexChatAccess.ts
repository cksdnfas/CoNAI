import crypto from 'crypto'
import type { Request } from 'express'
import type { McpRequester } from '../../mcp/context'
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

const tokens = new Map<string, { requester: McpRequester; scopes: ChatScope[]; toolAllowlist: string[] | null; roomTools: boolean }>()

/**
 * One token per chat app-server process; it lets that process reach `/mcp` as the chatting account with the
 * scopes its profiles were given (processes are keyed by account + scopes).
 */
export function issueCodexChatMcpToken(requester: McpRequester, scopes: ChatScope[], toolAllowlist: string[] | null, roomTools = false) {
  const token = `${CHAT_MCP_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
  tokens.set(token, { requester, scopes: [...scopes], toolAllowlist: toolAllowlist ? [...toolAllowlist] : null, roomTools })
  return token
}

export function revokeCodexChatMcpToken(token: string) {
  tokens.delete(token)
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
  }
}
