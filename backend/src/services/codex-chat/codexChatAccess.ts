import crypto from 'crypto'
import type { Request } from 'express'
import type { McpRequester } from '../../mcp/context'
import { AuthAccount } from '../../models/AuthAccount'
import { hasConfiguredAuth } from '../../routes/auth-route-helpers'
import type { McpHttpAuthentication } from '../mcpHttpSettingsService'
import { isDirectLoopbackRequest } from '../../utils/bootstrapAccess'
import { loadCodexChatSettings } from './codexChatSettings'

const CHAT_MCP_TOKEN_PREFIX = 'conai_chat_'

/** Chat is admin-only for now. `null` is the trusted bootstrap owner (no accounts configured yet). */
export function isCodexChatAdmin(accountId: number | null) {
  if (accountId === null) {
    return !hasConfiguredAuth()
  }
  const account = AuthAccount.findById(accountId)
  return account?.account_type === 'admin' && account.status === 'active'
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
 * backend), and the grant is re-checked on every call: chat enabled, account still an active admin, current scopes.
 * Works while the public HTTP MCP endpoint is disabled.
 */
export function authenticateCodexChatMcpRequest(req: Request, candidate: string | null): McpHttpAuthentication | null {
  if (!candidate?.startsWith(CHAT_MCP_TOKEN_PREFIX) || !isDirectLoopbackRequest(req)) {
    return null
  }

  const requester = tokens.get(candidate)
  const settings = loadCodexChatSettings()
  if (!requester || !settings.enabled || settings.scopes.length === 0 || !isCodexChatAdmin(requester.accountId)) {
    return null
  }

  return {
    keyId: `codex-chat:${requester.accountId ?? 'bootstrap'}`,
    keyName: 'Codex chat',
    scopes: [...settings.scopes],
    requester,
    source: 'codex-chat',
  }
}
