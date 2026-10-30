import type { ChatPageSnapshot } from '@conai/shared'
import type { McpRequester } from '../../mcp/context'

/** Lightweight shared state: permission/catalog code must not load the command bridge and its registrars. */
const latest = new Map<string, { accountId: number | null; page: ChatPageSnapshot; at: number }>()
const LATEST_MAX = 200
const LATEST_TTL_MS = 60 * 60_000
const threadConnections = new Map<number, string>()

export function lastChatPageForThread(requester: McpRequester, threadId: number): ChatPageSnapshot | undefined {
  const connectionId = threadConnections.get(threadId)
  const live = connectionId ? latest.get(connectionId) : undefined
  return live && live.accountId === requester.accountId ? live.page : undefined
}

export function rememberChatPage(requester: McpRequester, page: ChatPageSnapshot | undefined, threadId?: number) {
  if (!page) return
  if (threadId !== undefined) { threadConnections.delete(threadId); threadConnections.set(threadId, page.connectionId); if (threadConnections.size > LATEST_MAX) threadConnections.delete(threadConnections.keys().next().value!) }
  const now = Date.now()
  latest.delete(page.connectionId)
  latest.set(page.connectionId, { accountId: requester.accountId, page, at: now })
  for (const [key, entry] of latest) {
    if (latest.size <= LATEST_MAX && now - entry.at < LATEST_TTL_MS) break
    latest.delete(key)
  }
}

/** The connection's newest screen for this account, or the screen the request started with. */
export function currentChatPage(requester: McpRequester, page: ChatPageSnapshot): ChatPageSnapshot {
  const live = latest.get(page.connectionId)
  return live && live.accountId === requester.accountId ? live.page : page
}
