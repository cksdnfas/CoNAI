import { getUserSettingsDb } from '../../database/userSettingsDb'
import type { StoredFileEntry } from '@conai/shared'
import { FileStoreService, fileOwnerKey } from '../fileStoreService'

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
  /** LLM chats only: the tool result text (truncated) replayed to the model in later turns. */
  output?: string
  /** Generation queue jobs the call submitted or read; their results are attached when the thread is read. */
  jobIds?: number[]
  /** Read-only, set when the thread is read: jobs still running that have no history row yet (shown as placeholders). */
  pendingJobIds?: number[]
}

export type ChatEngine = 'codex' | 'llm'

export type CodexChatThreadRecord = {
  id: number
  account_id: number | null
  codex_thread_id: string | null
  title: string
  engine: ChatEngine
  profile_id: number | null
  /** Per-thread overrides (null inherits the profile, then the global LLM chat settings). */
  context_turns: number | null
  summary_enabled: 0 | 1 | null
  summary: string | null
  /** The last message folded into `summary`. */
  summary_until_message_id: number | null
  summary_updated_date: string | null
  context_revision: number
  created_date: string
  updated_date: string
}

export type CodexChatMessageRecord = {
  alternatives: ChatMessageAlternative[]
  active_alternative: number
  attachments?: StoredFileEntry[]
  id: number
  thread_id: number
  role: 'user' | 'assistant'
  content: string
  tool_calls: CodexChatToolCall[]
  status: 'completed' | 'failed' | 'interrupted'
  error: string | null
  created_date: string
}

export type ChatMessageAlternative = {
  content: string
  tool_calls: CodexChatToolCall[]
  created_at: string
  status: CodexChatMessageRecord['status']
  error: string | null
}

type StoredMessageRow = Omit<CodexChatMessageRecord, 'tool_calls' | 'alternatives'> & { tool_calls: string | null; alternatives: string | null }

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

function parseAlternatives(value: string | null): ChatMessageAlternative[] {
  try {
    const parsed: unknown = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Any history rewrite invalidates summaries being computed from the old history. */
function invalidateContext(threadId: number, changedMessageId: number) {
  getUserSettingsDb().prepare(`UPDATE codex_chat_threads SET
    summary = CASE WHEN summary_until_message_id >= ? THEN NULL ELSE summary END,
    summary_updated_date = CASE WHEN summary_until_message_id >= ? THEN NULL ELSE summary_updated_date END,
    summary_until_message_id = CASE WHEN summary_until_message_id >= ? THEN NULL ELSE summary_until_message_id END,
    codex_thread_id = NULL, context_revision = context_revision + 1, updated_date = CURRENT_TIMESTAMP WHERE id = ?
  `).run(changedMessageId, changedMessageId, changedMessageId, threadId)
}

function removeMessagesAfter(threadId: number, messageId: number) {
  const db = getUserSettingsDb()
  db.prepare('DELETE FROM chat_file_attachments WHERE message_id IN (SELECT id FROM codex_chat_messages WHERE thread_id = ? AND id > ?)').run(threadId, messageId)
  db.prepare('DELETE FROM codex_chat_messages WHERE thread_id = ? AND id > ?').run(threadId, messageId)
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

  findThreadById(threadId: number) {
    return getUserSettingsDb().prepare('SELECT * FROM codex_chat_threads WHERE id = ?').get(threadId) as CodexChatThreadRecord | undefined
  },

  createThread(accountId: number | null, title: string, engine: ChatEngine = 'codex', profileId: number | null = null) {
    const result = getUserSettingsDb().prepare(`
      INSERT INTO codex_chat_threads (account_id, title, engine, profile_id) VALUES (?, ?, ?, ?)
    `).run(accountId, title.slice(0, TITLE_MAX_LENGTH), engine, profileId)
    return Number(result.lastInsertRowid)
  },

  updateThreadContext(threadId: number, patch: { contextTurns?: number | null; summaryEnabled?: boolean | null }) {
    const db = getUserSettingsDb()
    if (patch.contextTurns !== undefined) {
      db.prepare('UPDATE codex_chat_threads SET context_turns = ? WHERE id = ?').run(patch.contextTurns, threadId)
    }
    if (patch.summaryEnabled !== undefined) {
      db.prepare('UPDATE codex_chat_threads SET summary_enabled = ? WHERE id = ?').run(patch.summaryEnabled === null ? null : patch.summaryEnabled ? 1 : 0, threadId)
    }
  },

  setSummary(threadId: number, summary: string | null, untilMessageId: number | null, expectedRevision?: number) {
    return getUserSettingsDb().prepare(`
      UPDATE codex_chat_threads SET summary = ?, summary_until_message_id = ?, summary_updated_date = CURRENT_TIMESTAMP,
      context_revision = context_revision + 1 WHERE id = ? ${expectedRevision === undefined ? '' : 'AND context_revision = ?'}
    `).run(summary, untilMessageId, threadId, ...(expectedRevision === undefined ? [] : [expectedRevision])).changes > 0
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
    const attachments = FileStoreService.attachmentsForThread(threadId)
    const rows = getUserSettingsDb().prepare(`
      SELECT * FROM codex_chat_messages WHERE thread_id = ? ORDER BY id
    `).all(threadId) as StoredMessageRow[]
    return rows.map((row) => ({ ...row, tool_calls: parseToolCalls(row.tool_calls), alternatives: parseAlternatives(row.alternatives), attachments: attachments.get(row.id) ?? [] }))
  },

  truncateAfter(threadId: number, messageId: number) {
    const db = getUserSettingsDb()
    db.transaction(() => {
      if (!db.prepare('SELECT 1 FROM codex_chat_messages WHERE thread_id = ? AND id = ?').get(threadId, messageId)) throw new Error('Message not found')
      removeMessagesAfter(threadId, messageId)
      invalidateContext(threadId, messageId + 1)
    }).immediate()
  },

  prepareRegeneration(threadId: number, messageId: number) {
    invalidateContext(threadId, messageId)
  },

  editUserMessage(threadId: number, messageId: number, content: string) {
    const db = getUserSettingsDb()
    db.transaction(() => {
      const updated = db.prepare("UPDATE codex_chat_messages SET content = ? WHERE thread_id = ? AND id = ? AND role = 'user'").run(content, threadId, messageId)
      if (!updated.changes) throw new Error('User message not found')
      removeMessagesAfter(threadId, messageId)
      invalidateContext(threadId, messageId)
    }).immediate()
  },

  clearThread(threadId: number, greeting: string) {
    const db = getUserSettingsDb()
    db.transaction(() => {
      removeMessagesAfter(threadId, 0)
      db.prepare(`UPDATE codex_chat_threads SET summary = NULL, summary_until_message_id = NULL, summary_updated_date = NULL,
        codex_thread_id = NULL, context_revision = context_revision + 1, updated_date = CURRENT_TIMESTAMP WHERE id = ?`).run(threadId)
      if (greeting) CodexChatStore.addMessage({ thread_id: threadId, role: 'assistant', content: greeting, tool_calls: [], status: 'completed', error: null })
    }).immediate()
  },

  addAlternative(threadId: number, messageId: number, alternative: ChatMessageAlternative) {
    const db = getUserSettingsDb()
    db.transaction(() => {
      const row = db.prepare("SELECT * FROM codex_chat_messages WHERE thread_id = ? AND id = ? AND role = 'assistant'").get(threadId, messageId) as StoredMessageRow | undefined
      if (!row) throw new Error('Assistant message not found')
      const alternatives = parseAlternatives(row.alternatives)
      if (!alternatives.length) alternatives.push({ content: row.content, tool_calls: parseToolCalls(row.tool_calls), created_at: row.created_date, status: row.status, error: row.error })
      alternatives.push(alternative)
      db.prepare(`UPDATE codex_chat_messages SET alternatives = ?, active_alternative = ?, content = ?, tool_calls = ?, status = ?, error = ? WHERE id = ?`)
        .run(JSON.stringify(alternatives), alternatives.length - 1, alternative.content, JSON.stringify(alternative.tool_calls), alternative.status, alternative.error, messageId)
      invalidateContext(threadId, messageId)
    }).immediate()
  },

  selectAlternative(threadId: number, messageId: number, index: number) {
    const db = getUserSettingsDb()
    db.transaction(() => {
      const row = db.prepare("SELECT * FROM codex_chat_messages WHERE thread_id = ? AND id = ? AND role = 'assistant'").get(threadId, messageId) as StoredMessageRow | undefined
      const alternative = row ? parseAlternatives(row.alternatives)[index] : undefined
      if (!alternative) throw new Error('Alternative not found')
      db.prepare('UPDATE codex_chat_messages SET active_alternative = ?, content = ?, tool_calls = ?, status = ?, error = ? WHERE id = ?')
        .run(index, alternative.content, JSON.stringify(alternative.tool_calls), alternative.status, alternative.error, messageId)
      invalidateContext(threadId, messageId)
    }).immediate()
  },

  addMessage(message: Pick<CodexChatMessageRecord, 'thread_id' | 'role' | 'content' | 'tool_calls' | 'status' | 'error'>, fileIds: string[] = []) {
    const db = getUserSettingsDb()
    return db.transaction(() => {
      const thread = CodexChatStore.findThreadById(message.thread_id)
      if (!thread) throw new Error('Chat thread not found')
      const attachments = FileStoreService.validateAttachments(fileOwnerKey(thread.account_id), fileIds)
      const result = db.prepare(`
        INSERT INTO codex_chat_messages (thread_id, role, content, tool_calls, status, error) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        message.thread_id,
        message.role,
        message.content,
        message.tool_calls.length > 0 ? JSON.stringify(message.tool_calls) : null,
        message.status,
        message.error,
      )
      for (const file of attachments) db.prepare('INSERT INTO chat_file_attachments (message_id, file_id) VALUES (?, ?)').run(result.lastInsertRowid, file.id)
      CodexChatStore.touchThread(message.thread_id)
      return Number(result.lastInsertRowid)
    }).immediate()
  },
}
