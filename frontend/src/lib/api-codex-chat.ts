import { requestApiData, requestJson } from '@/lib/api-request'
import { buildApiUrl } from '@/lib/api-url'

export type CodexChatScope = 'read' | 'generate' | 'organize'

export interface CodexChatSettings {
  enabled: boolean
  scopes: CodexChatScope[]
  model: string
  availableScopes: CodexChatScope[]
}

export interface CodexChatStatus {
  enabled: boolean
  canUse: boolean
}

export interface CodexChatToolCall {
  id: string
  tool: string
  status: 'running' | 'completed' | 'failed'
  arguments: unknown
  summary: string | null
  historyIds: number[]
  compositeHashes: string[]
}

export interface CodexChatThread {
  id: number
  codex_thread_id: string | null
  title: string
  created_date: string
  updated_date: string
}

export interface CodexChatMessage {
  id: number
  thread_id: number
  role: 'user' | 'assistant'
  content: string
  tool_calls: CodexChatToolCall[]
  status: 'completed' | 'failed' | 'interrupted'
  error: string | null
  created_date: string
}

export interface CodexChatThreadDetail {
  thread: CodexChatThread
  messages: CodexChatMessage[]
  /** Partial reply of a turn still running on the server (after a reload). */
  running: { text: string; toolCalls: CodexChatToolCall[] } | null
}

export type CodexChatStreamEvent =
  | { type: 'user'; message: CodexChatMessage }
  | { type: 'delta'; text: string }
  | { type: 'tool'; call: CodexChatToolCall }
  | { type: 'done'; message: CodexChatMessage }
  | { type: 'error'; message: string }

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export function getCodexChatStatus() {
  return requestApiData<CodexChatStatus>('/api/codex-chat/status', { cache: 'no-store' })
}

export function getCodexChatSettings() {
  return requestApiData<CodexChatSettings>('/api/codex-chat/settings', { cache: 'no-store' })
}

export function updateCodexChatSettings(patch: Partial<Pick<CodexChatSettings, 'enabled' | 'scopes' | 'model'>>) {
  return requestApiData<CodexChatSettings>('/api/codex-chat/settings', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function listCodexChatThreads() {
  return requestApiData<CodexChatThread[]>('/api/codex-chat/threads', { cache: 'no-store' })
}

export function createCodexChatThread() {
  return requestApiData<CodexChatThread>('/api/codex-chat/threads', { method: 'POST' })
}

export function getCodexChatThread(threadId: number) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}`, { cache: 'no-store' })
}

export function deleteCodexChatThread(threadId: number) {
  return requestJson<{ success: boolean }>(`/api/codex-chat/threads/${threadId}`, { method: 'DELETE' })
}

export function interruptCodexChatThread(threadId: number) {
  return requestJson<{ success: boolean }>(`/api/codex-chat/threads/${threadId}/interrupt`, { method: 'POST' })
}

/**
 * Send a message and read the NDJSON turn stream. No timeout: a turn with generation jobs can run for minutes.
 * Aborting only stops reading; the server finishes and stores the reply.
 */
export async function streamCodexChatMessage(threadId: number, text: string, onEvent: (event: CodexChatStreamEvent) => void, signal?: AbortSignal) {
  const response = await fetch(buildApiUrl(`/api/codex-chat/threads/${threadId}/messages`), {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { ...JSON_HEADERS, Accept: 'application/x-ndjson' },
    body: JSON.stringify({ text }),
    signal,
  })

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error || `Request failed: ${response.status}`)
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }
    buffer += value
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (line) {
        onEvent(JSON.parse(line) as CodexChatStreamEvent)
      }
      newlineIndex = buffer.indexOf('\n')
    }
  }
}
