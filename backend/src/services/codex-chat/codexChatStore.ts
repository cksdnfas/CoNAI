import { getUserSettingsDb } from '../../database/userSettingsDb'

export type CodexChatToolCall = {
  id: string
  tool: string
  status: 'running' | 'completed' | 'failed'
  arguments: unknown
  /** Short text of the tool result or error, for display. */
  summary: string | null
  /** Generation history rows the call created or referenced (rendered as thumbnails). */
  historyIds: number[]
  /** Library images the call returned. */
  compositeHashes: string[]
}

export type CodexChatThreadRecord = {
  id: number
  account_id: number | null
  codex_thread_id: string | null
  title: string
  created_date: string
  updated_date: string
}

export type CodexChatMessageRecord = {
  id: number
  thread_id: number
  role: 'user' | 'assistant'
  content: string
  tool_calls: CodexChatToolCall[]
  status: 'completed' | 'failed' | 'interrupted'
  error: string | null
  created_date: string
}

type StoredMessageRow = Omit<CodexChatMessageRecord, 'tool_calls'> & { tool_calls: string | null }

const TITLE_MAX_LENGTH = 60

function parseToolCalls(value: string | null): CodexChatToolCall[] {
  if (!value) {
    return []
  }
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as CodexChatToolCall[] : []
  } catch {
    return []
  }
}

export const CodexChatStore = {
  listThreads(accountId: number | null) {
    return getUserSettingsDb().prepare(`
      SELECT * FROM codex_chat_threads WHERE account_id IS ? ORDER BY updated_date DESC, id DESC
    `).all(accountId) as CodexChatThreadRecord[]
  },

  findThread(threadId: number, accountId: number | null) {
    return getUserSettingsDb().prepare(`
      SELECT * FROM codex_chat_threads WHERE id = ? AND account_id IS ?
    `).get(threadId, accountId) as CodexChatThreadRecord | undefined
  },

  createThread(accountId: number | null, title: string) {
    const result = getUserSettingsDb().prepare(`
      INSERT INTO codex_chat_threads (account_id, title) VALUES (?, ?)
    `).run(accountId, title.slice(0, TITLE_MAX_LENGTH))
    return Number(result.lastInsertRowid)
  },

  setCodexThreadId(threadId: number, codexThreadId: string) {
    getUserSettingsDb().prepare(`
      UPDATE codex_chat_threads SET codex_thread_id = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?
    `).run(codexThreadId, threadId)
  },

  renameThread(threadId: number, title: string) {
    getUserSettingsDb().prepare(`
      UPDATE codex_chat_threads SET title = ? WHERE id = ?
    `).run(title.slice(0, TITLE_MAX_LENGTH), threadId)
  },

  touchThread(threadId: number) {
    getUserSettingsDb().prepare('UPDATE codex_chat_threads SET updated_date = CURRENT_TIMESTAMP WHERE id = ?').run(threadId)
  },

  deleteThread(threadId: number) {
    const db = getUserSettingsDb()
    db.transaction(() => {
      db.prepare('DELETE FROM codex_chat_messages WHERE thread_id = ?').run(threadId)
      db.prepare('DELETE FROM codex_chat_threads WHERE id = ?').run(threadId)
    })()
  },

  listMessages(threadId: number) {
    const rows = getUserSettingsDb().prepare(`
      SELECT * FROM codex_chat_messages WHERE thread_id = ? ORDER BY id
    `).all(threadId) as StoredMessageRow[]
    return rows.map((row) => ({ ...row, tool_calls: parseToolCalls(row.tool_calls) }))
  },

  addMessage(message: Pick<CodexChatMessageRecord, 'thread_id' | 'role' | 'content' | 'tool_calls' | 'status' | 'error'>) {
    const result = getUserSettingsDb().prepare(`
      INSERT INTO codex_chat_messages (thread_id, role, content, tool_calls, status, error) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      message.thread_id,
      message.role,
      message.content,
      message.tool_calls.length > 0 ? JSON.stringify(message.tool_calls) : null,
      message.status,
      message.error,
    )
    CodexChatStore.touchThread(message.thread_id)
    return Number(result.lastInsertRowid)
  },
}
