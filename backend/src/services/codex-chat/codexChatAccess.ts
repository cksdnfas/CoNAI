import crypto from 'crypto'
import type { Request } from 'express'
import type { McpRequester } from '../../mcp/context'
import { AuthAccount } from '../../models/AuthAccount'
import { hasConfiguredAuth } from '../../routes/auth-route-helpers'
import { AuthAccessControlService } from '../authAccessControlService'
import type { McpHttpAuthentication } from '../mcpHttpSettingsService'
import { isDirectLoopbackRequest } from '../../utils/bootstrapAccess'
import { CODEX_CHAT_SCOPES, loadCodexChatSettings, type CodexChatScope } from './codexChatSettings'

const CHAT_MCP_TOKEN_PREFIX = 'conai_chat_'

export const CHAT_PERMISSION_KEYS = {
  codex: 'chat.codex.use',
  llm: 'chat.llm.use',
} as const

const CHAT_TOOL_PERMISSION_KEYS: Record<CodexChatScope, string> = {
  read: 'chat.tools.read',
  generate: 'chat.tools.generate',
  organize: 'chat.tools.organize',
}

export type ChatAccess = {
  codex: boolean
  llm: boolean
  /** MCP scopes this account may hand to a chat agent; a chat's own scope setting is intersected with it. */
  scopes: CodexChatScope[]
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
    scopes: CODEX_CHAT_SCOPES.filter((scope) => has(CHAT_TOOL_PERMISSION_KEYS[scope])),
  }
}

/** A chat's configured scopes, narrowed to what the chatting account may use. */
export function intersectChatScopes(configured: readonly CodexChatScope[], access: ChatAccess) {
  return configured.filter((scope) => access.scopes.includes(scope))
}

const tokens = new Map<string, McpRequester>()

/** One token per chat app-server process; it lets that process reach `/mcp` as the chatting account. */
export function issueCodexChatMcpToken(requester: McpRequester) {
  const token = `${CHAT_MCP_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
  tokens.set(token, requester)
  return token
}

export function revokeCodexChatMcpToken(token: string) {
  tokens.delete(token)
}

/**
 * Authenticate an internal chat token. Only direct loopback requests qualify (the app-server runs next to the
 * backend), and the grant is re-checked on every call: chat enabled, the account still holds `chat.codex.use`, and the
 * scopes are the chat setting narrowed to the account's `chat.tools.*` keys.
 * Works while the public HTTP MCP endpoint is disabled.
 */
export function authenticateCodexChatMcpRequest(req: Request, candidate: string | null): McpHttpAuthentication | null {
  if (!candidate?.startsWith(CHAT_MCP_TOKEN_PREFIX) || !isDirectLoopbackRequest(req)) {
    return null
  }

  const requester = tokens.get(candidate)
  const settings = loadCodexChatSettings()
  if (!requester || !settings.enabled) {
    return null
  }
  const access = resolveChatAccess(requester.accountId)
  const scopes = intersectChatScopes(settings.scopes, access)
  if (!access.codex || scopes.length === 0) {
    return null
  }

  return {
    keyId: `codex-chat:${requester.accountId ?? 'bootstrap'}`,
    keyName: 'Codex chat',
    scopes,
    requester,
    source: 'codex-chat',
  }
}
