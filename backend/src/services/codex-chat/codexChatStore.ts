import { getUserSettingsDb } from '../../database/userSettingsDb'
import type { StoredFileEntry } from '@conai/shared'
import { FileStoreService, fileOwnerKey } from '../fileStoreService'
import { parseBlockEdits, type BlockEdit } from './chatBlockState'
import { parseFlagSnapshots, type ChatFlagSnapshot } from './chatFlags'
import { parseChatMediaAttachments, type ChatMediaAttachment } from './chatMediaAttachments'

export type { ChatToolCall as CodexChatToolCall } from '@conai/shared'
import type { ChatToolCall as CodexChatToolCall } from '@conai/shared'

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
  /** Codex chats: the last model request's input tokens (the live context size) and the model's window. */
  codex_context_tokens: number | null
  codex_context_window: number | null
  /** Codex chats: tokens the Codex thread has used in total. */
  codex_input_tokens: number | null
  codex_cached_input_tokens: number | null
  codex_output_tokens: number | null
  /** Codex chats: JSON keys of lore entries already given to the Codex thread since its last compaction. */
  codex_lore_sent: string | null
  /** `group`: several profiles answer by @mention, `profile_id` being the representative. */
  kind: 'direct' | 'group'
  /** Group rooms: bot-to-bot wakes per user message and messages handed to a woken member (null: defaults). */
  group_chain_limit: number | null
  group_window_limit: number | null
  /** This chat's author's note (null: the profile's default) and its depth in turns before the end (null: the profile's lore depth). */
  author_note: string | null
  author_note_depth: number | null
  /** This chat's reply length cap in tokens (null: the profile's max tokens). */
  max_tokens: number | null
  /** JSON ids of the chat flags switched on in this chat. */
  flag_ids: string | null
  /** JSON hand edits of the display block state (see chatBlockState). */
  block_edits: string | null
  /** The account's user profile (persona) in this chat; null is the plain user. */
  user_profile_id: number | null
  created_date: string
  updated_date: string
}

export type CodexChatMessageRecord = {
  alternatives: ChatMessageAlternative[]
  active_alternative: number
  attachments?: StoredFileEntry[]
  mediaAttachments?: ChatMediaAttachment[]
  id: number
  thread_id: number
  role: 'user' | 'assistant'
  content: string
  /** Group rooms: the profile that wrote this reply. Null for the user and in direct chats. */
  speaker_profile_id: number | null
  tool_calls: CodexChatToolCall[]
  status: 'completed' | 'failed' | 'interrupted'
  error: string | null
  /** LLM replies: the provider's finish_reason of the last round; 'length' means the token cap cut the reply. */
  finish_reason: string | null
  /** User messages: the chat flags that were on when it was sent. */
  flags?: ChatFlagSnapshot[]
  created_date: string
}

export type ChatMessageAlternative = {
  content: string
  tool_calls: CodexChatToolCall[]
  created_at: string
  status: CodexChatMessageRecord['status']
  error: string | null
  finish_reason?: string | null
}

type StoredMessageRow = Omit<CodexChatMessageRecord, 'tool_calls' | 'alternatives' | 'flags'> & { tool_calls: string | null; alternatives: string | null; flags: string | null; media_attachments: string | null }

const TITLE_MAX_LENGTH = 60

/** A new or emptied Codex thread starts with no usage and no lore in its memory. */
const RESET_CODEX_STATE = `codex_context_tokens = NULL, codex_context_window = NULL, codex_input_tokens = NULL,
  codex_cached_input_tokens = NULL, codex_output_tokens = NULL, codex_lore_sent = NULL`

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
    codex_thread_id = NULL, ${RESET_CODEX_STATE}, context_revision = context_revision + 1, updated_date = CURRENT_TIMESTAMP WHERE id = ?
  `).run(changedMessageId, changedMessageId, changedMessageId, threadId)
}

function removeMessagesAfter(threadId: number, messageId: number) {
  const db = getUserSettingsDb()
  db.prepare('DELETE FROM chat_file_attachments WHERE message_id IN (SELECT id FROM codex_chat_messages WHERE thread_id = ? AND id > ?)').run(threadId, messageId)
  db.prepare('DELETE FROM codex_chat_messages WHERE thread_id = ? AND id > ?').run(threadId, messageId)
  // Block state edits made after a removed message go with it.
  const row = db.prepare('SELECT block_edits FROM codex_chat_threads WHERE id = ?').get(threadId) as { block_edits: string | null } | undefined
  if (row?.block_edits) {
    const kept = parseBlockEdits(row.block_edits).filter((edit) => edit.afterMessageId <= messageId)
    db.prepare('UPDATE codex_chat_threads SET block_edits = ? WHERE id = ?').run(kept.length > 0 ? JSON.stringify(kept) : null, threadId)
  }
}

export const CodexChatStore = {
  searchMessages(accountId: number | null, query: string) {
    return getUserSettingsDb().prepare(`SELECT m.id AS messageId, m.thread_id AS threadId, t.title, t.profile_id AS profileId,
      m.role, m.created_date AS createdDate, substr(m.content, MAX(1, instr(lower(m.content), lower(?)) - 60), 220) AS excerpt
      FROM codex_chat_messages m JOIN codex_chat_threads t ON t.id = m.thread_id
      WHERE t.account_id IS ? AND instr(lower(m.content), lower(?)) > 0 ORDER BY m.id DESC LIMIT 50
    `).all(query, accountId, query) as Array<{ messageId: number; threadId: number; title: string; profileId: number | null; role: 'user' | 'assistant'; createdDate: string; excerpt: string }>
  },

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

  updateThreadContext(threadId: number, patch: { contextTurns?: number | null; summaryEnabled?: boolean | null; authorNote?: string | null; authorNoteDepth?: number | null; maxTokens?: number | null }) {
    const db = getUserSettingsDb()
    if (patch.contextTurns !== undefined) {
      db.prepare('UPDATE codex_chat_threads SET context_turns = ? WHERE id = ?').run(patch.contextTurns, threadId)
    }
    if (patch.maxTokens !== undefined) {
      db.prepare('UPDATE codex_chat_threads SET max_tokens = ? WHERE id = ?').run(patch.maxTokens, threadId)
    }
    if (patch.summaryEnabled !== undefined) {
      db.prepare('UPDATE codex_chat_threads SET summary_enabled = ? WHERE id = ?').run(patch.summaryEnabled === null ? null : patch.summaryEnabled ? 1 : 0, threadId)
    }
    if (patch.authorNote !== undefined) {
      db.prepare('UPDATE codex_chat_threads SET author_note = ? WHERE id = ?').run(patch.authorNote?.trim() || null, threadId)
    }
    if (patch.authorNoteDepth !== undefined) {
      db.prepare('UPDATE codex_chat_threads SET author_note_depth = ? WHERE id = ?').run(patch.authorNoteDepth, threadId)
    }
  },

  setBlockEdits(threadId: number, edits: BlockEdit[]) {
    getUserSettingsDb().prepare('UPDATE codex_chat_threads SET block_edits = ? WHERE id = ?').run(edits.length > 0 ? JSON.stringify(edits) : null, threadId)
  },

  setSummary(threadId: number, summary: string | null, untilMessageId: number | null, expectedRevision?: number) {
    return getUserSettingsDb().prepare(`
      UPDATE codex_chat_threads SET summary = ?, summary_until_message_id = ?, summary_updated_date = CURRENT_TIMESTAMP,
      context_revision = context_revision + 1 WHERE id = ? ${expectedRevision === undefined ? '' : 'AND context_revision = ?'}
    `).run(summary, untilMessageId, threadId, ...(expectedRevision === undefined ? [] : [expectedRevision])).changes > 0
  },

  setCodexThreadId(threadId: number, codexThreadId: string) {
    getUserSettingsDb().prepare(`
      UPDATE codex_chat_threads SET codex_thread_id = ?, ${RESET_CODEX_STATE}, updated_date = CURRENT_TIMESTAMP WHERE id = ?
    `).run(codexThreadId, threadId)
  },

  findThreadByCodexId(codexThreadId: string) {
    return getUserSettingsDb().prepare('SELECT * FROM codex_chat_threads WHERE codex_thread_id = ?').get(codexThreadId) as CodexChatThreadRecord | undefined
  },

  setCodexUsage(codexThreadId: string, usage: { contextTokens: number | null; contextWindow: number | null; inputTokens: number; cachedInputTokens: number; outputTokens: number }) {
    getUserSettingsDb().prepare(`
      UPDATE codex_chat_threads SET codex_context_tokens = ?, codex_context_window = ?, codex_input_tokens = ?, codex_cached_input_tokens = ?,
      codex_output_tokens = ? WHERE codex_thread_id = ?
    `).run(usage.contextTokens, usage.contextWindow, usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, codexThreadId)
  },

  /** Codex folded its memory up to `untilMessageId` (shown as the summary divider); lore must be given again. */
  markCodexCompacted(codexThreadId: string, untilMessageId: number | null) {
    getUserSettingsDb().prepare(`
      UPDATE codex_chat_threads SET summary_until_message_id = ?, summary_updated_date = CURRENT_TIMESTAMP, codex_lore_sent = NULL,
      context_revision = context_revision + 1 WHERE codex_thread_id = ?
    `).run(untilMessageId, codexThreadId)
  },

  setCodexLoreSent(threadId: number, keys: string[]) {
    getUserSettingsDb().prepare('UPDATE codex_chat_threads SET codex_lore_sent = ? WHERE id = ?').run(keys.length > 0 ? JSON.stringify(keys) : null, threadId)
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
      db.prepare('DELETE FROM chat_group_members WHERE thread_id = ?').run(threadId)
      db.prepare('DELETE FROM codex_chat_threads WHERE id = ?').run(threadId)
    })()
  },

  listMessages(threadId: number) {
    const attachments = FileStoreService.attachmentsForThread(threadId)
    const rows = getUserSettingsDb().prepare(`
      SELECT * FROM codex_chat_messages WHERE thread_id = ? ORDER BY id
    `).all(threadId) as StoredMessageRow[]
    return rows.map(({ media_attachments, ...row }) => ({ ...row, mediaAttachments: parseChatMediaAttachments(media_attachments), tool_calls: parseToolCalls(row.tool_calls), alternatives: parseAlternatives(row.alternatives), flags: parseFlagSnapshots(row.flags), attachments: attachments.get(row.id) ?? [] }))
  },

  latestMessageId(threadId: number) {
    const row = getUserSettingsDb().prepare('SELECT id FROM codex_chat_messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1').get(threadId) as { id: number } | undefined
    return row?.id ?? null
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
      db.prepare(`UPDATE codex_chat_threads SET summary = NULL, summary_until_message_id = NULL, summary_updated_date = NULL, block_edits = NULL,
        codex_thread_id = NULL, ${RESET_CODEX_STATE}, context_revision = context_revision + 1, updated_date = CURRENT_TIMESTAMP WHERE id = ?`).run(threadId)
      if (greeting) CodexChatStore.addMessage({ thread_id: threadId, role: 'assistant', content: greeting, tool_calls: [], status: 'completed', error: null })
    }).immediate()
  },

  addAlternative(threadId: number, messageId: number, alternative: ChatMessageAlternative) {
    const db = getUserSettingsDb()
    db.transaction(() => {
      const row = db.prepare("SELECT * FROM codex_chat_messages WHERE thread_id = ? AND id = ? AND role = 'assistant'").get(threadId, messageId) as StoredMessageRow | undefined
      if (!row) throw new Error('Assistant message not found')
      const alternatives = parseAlternatives(row.alternatives)
      if (!alternatives.length) alternatives.push({ content: row.content, tool_calls: parseToolCalls(row.tool_calls), created_at: row.created_date, status: row.status, error: row.error, finish_reason: row.finish_reason ?? null })
      alternatives.push(alternative)
      db.prepare(`UPDATE codex_chat_messages SET alternatives = ?, active_alternative = ?, content = ?, tool_calls = ?, status = ?, error = ?, finish_reason = ? WHERE id = ?`)
        .run(JSON.stringify(alternatives), alternatives.length - 1, alternative.content, JSON.stringify(alternative.tool_calls), alternative.status, alternative.error, alternative.finish_reason ?? null, messageId)
      invalidateContext(threadId, messageId)
    }).immediate()
  },

  selectAlternative(threadId: number, messageId: number, index: number) {
    const db = getUserSettingsDb()
    db.transaction(() => {
      const row = db.prepare("SELECT * FROM codex_chat_messages WHERE thread_id = ? AND id = ? AND role = 'assistant'").get(threadId, messageId) as StoredMessageRow | undefined
      const alternative = row ? parseAlternatives(row.alternatives)[index] : undefined
      if (!alternative) throw new Error('Alternative not found')
      db.prepare('UPDATE codex_chat_messages SET active_alternative = ?, content = ?, tool_calls = ?, status = ?, error = ?, finish_reason = ? WHERE id = ?')
        .run(index, alternative.content, JSON.stringify(alternative.tool_calls), alternative.status, alternative.error, alternative.finish_reason ?? null, messageId)
      invalidateContext(threadId, messageId)
    }).immediate()
  },

  addMessage(message: Pick<CodexChatMessageRecord, 'thread_id' | 'role' | 'content' | 'tool_calls' | 'status' | 'error' | 'flags' | 'mediaAttachments'> & { speaker_profile_id?: number | null; finish_reason?: string | null }, fileIds: string[] = []) {
    const db = getUserSettingsDb()
    return db.transaction(() => {
      const thread = CodexChatStore.findThreadById(message.thread_id)
      if (!thread) throw new Error('Chat thread not found')
      const attachments = FileStoreService.validateAttachments(fileOwnerKey(thread.account_id), fileIds)
      const result = db.prepare(`
        INSERT INTO codex_chat_messages (thread_id, role, content, tool_calls, status, error, speaker_profile_id, flags, finish_reason, media_attachments) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        message.thread_id,
        message.role,
        message.content,
        message.tool_calls.length > 0 ? JSON.stringify(message.tool_calls) : null,
        message.status,
        message.error,
        message.speaker_profile_id ?? null,
        message.flags?.length ? JSON.stringify(message.flags) : null,
        message.finish_reason ?? null,
        message.mediaAttachments?.length ? JSON.stringify(message.mediaAttachments) : null,
      )
      for (const file of attachments) db.prepare('INSERT INTO chat_file_attachments (message_id, file_id) VALUES (?, ?)').run(result.lastInsertRowid, file.id)
      CodexChatStore.touchThread(message.thread_id)
      return Number(result.lastInsertRowid)
    }).immediate()
  },
}
