import crypto from 'crypto'
import type { ChatPageCommand, ChatPageCommandEvent, ChatPageSnapshot } from '@conai/shared'
import type { McpRequester } from '../../mcp/context'
import { publishRuntimeEvent } from '../runtime-events/runtimeEventBus'
import { ChatPageContextError, parseChatPageContext } from './chatPageContext'
import { RuntimeEventBroadcaster } from '../runtime-events/runtimeEventBroadcaster'

/**
 * Same-turn round trip to the person's connected page: a tool asks, the browser tab that holds the connection runs one
 * registered operation (or only reports its screen), and answers with the new screen. Only view and draft operations
 * travel this way; saves stay review cards. The browser is told what to run, never how: it looks the operation up in
 * its own registry, so nothing here can make a page run code it did not register.
 */

let timeoutMs = 20_000
/** Tests shorten the wait for a browser that never answers. */
export function setChatPageCommandTimeout(ms: number) { timeoutMs = ms }

export const newChatPageCommandId = () => crypto.randomUUID()

type Pending = { accountId: number | null; connectionId: string; resolve: (page: ChatPageSnapshot) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
const pending = new Map<string, Pending>()

/** The newest screen each connection reported. Tools read it so a reply sees what its own earlier steps changed. */
const latest = new Map<string, { accountId: number | null; page: ChatPageSnapshot; at: number }>()
const LATEST_MAX = 200
const LATEST_TTL_MS = 60 * 60_000

/** The connection each chat last sent with, so a task continuation (sent by the server) can reach the same tab. */
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

export function runChatPageCommand(requester: McpRequester, page: ChatPageSnapshot, threadId: number, command: ChatPageCommand, options: { waitMs?: number; commandId?: string } = {}): Promise<ChatPageSnapshot> {
  const commandId = options.commandId ?? crypto.randomUUID()
  const waitMs = options.waitMs ?? timeoutMs
  // No open stream for this account (the tab is closed, or hidden long enough to drop its stream): nothing would run
  // the command, so say so now instead of after the whole wait, and send nothing a reconnecting tab could replay late.
  if (RuntimeEventBroadcaster.reachesAccount(requester.accountId, 'generation-queue') === false) {
    return Promise.reject(new ChatPageContextError('연결된 페이지 탭이 지금 응답할 수 없어 (닫혔거나 오래 숨겨져 있어). 그 탭을 다시 열어 화면에 띄우면 이어서 할 수 있어.', 503))
  }
  return new Promise<ChatPageSnapshot>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(commandId)
      reject(new ChatPageContextError('페이지가 응답하지 않아. 채팅을 연 탭이 열려 있고 화면에 보이는지, 페이지 연결이 켜져 있는지 확인해줘.', 504))
    }, waitMs)
    timer.unref?.()
    pending.set(commandId, { accountId: requester.accountId, connectionId: page.connectionId, resolve, reject, timer })
    const payload: ChatPageCommandEvent = { ...command, commandId, connectionId: page.connectionId, instanceId: page.instanceId, threadId, expiresAt: Date.now() + waitMs }
    publishRuntimeEvent({ name: 'chat.page.command', topic: 'generation-queue', visibility: 'owner', accountId: requester.accountId, payload })
  })
}

/** The browser's answer. Its screen is validated like any connected page; its error text is shown to the model as data. */
export function resolveChatPageCommand(requester: McpRequester, commandId: string, body: unknown) {
  const entry = pending.get(commandId)
  if (!entry || entry.accountId !== requester.accountId) throw new ChatPageContextError('기다리는 페이지 작업이 없어.', 404)
  pending.delete(commandId)
  clearTimeout(entry.timer)
  const answer = (body && typeof body === 'object' ? body : {}) as { ok?: unknown; error?: unknown; page?: unknown }
  if (answer.ok !== true) {
    const message = typeof answer.error === 'string' && answer.error.trim() ? answer.error.trim().slice(0, 300) : '페이지 작업이 실패했어.'
    entry.reject(new ChatPageContextError(message, 409))
    return
  }
  try {
    const page = parseChatPageContext(answer.page, requester)
    if (!page || page.connectionId !== entry.connectionId) throw new ChatPageContextError('다른 연결의 페이지 정보야.', 409)
    rememberChatPage(requester, page)
    entry.resolve(page)
  } catch (error) {
    entry.reject(error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

/** The live screen when the tab answers quickly, else the newest one it reported (a page left in the background answers late). */
export async function captureChatPage(requester: McpRequester, page: ChatPageSnapshot, threadId: number): Promise<{ page: ChatPageSnapshot; live: boolean }> {
  const known = currentChatPage(requester, page)
  try { return { page: await runChatPageCommand(requester, known, threadId, { type: 'capture' }, { waitMs: Math.min(timeoutMs, 3000) }), live: true } }
  catch { return { page: known, live: false } }
}
