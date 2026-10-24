import { getUserSettingsDb } from '../../database/userSettingsDb'
import { publishRuntimeEvent } from '../runtime-events/runtimeEventBus'
import type { StoredFileEntry, ChatMessageRouting, ChatFileChange } from '@conai/shared'
import { FileStoreService, fileOwnerKey } from '../fileStoreService'
import { parseBlockEdits, type BlockEdit } from './chatBlockState'
import { parseFlagSnapshots, type ChatFlagSnapshot } from './chatFlags'
import { parseChatMediaAttachments, type ChatMediaAttachment } from './chatMediaAttachments'
import { ChatSummaryStore } from './chatMemory'
import { OwnedLorebookStore } from './chatLorebookFiles'
import { ChatProposalStore } from './chatProposals'
import { forgetThreadFileChanges } from './chatFileChanges'
import { notifySemanticChange } from '../embeddings/semanticSignal'
import { cancelAgentCallsForThread } from './chatAgentCalls'

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
  /** Group rooms: the judge preset that picks who answers and whether the room goes on (null: none). */
  judge_preset_id: number | null
  /** This chat's author's note (null: the profile's default) and its depth in turns before the end (null: the profile's lore depth). */
  author_note: string | null
  author_note_depth: number | null
  /** This chat's reply length cap in tokens (null: the profile's max tokens). */
  max_tokens: number | null
  reaction_enabled: 0 | 1
  reaction_model_slot_id: number | null
  /** JSON ids of the chat flags switched on in this chat. */
  flag_ids: string | null
  /** JSON hand edits of the display block state (see chatBlockState). */
  block_edits: string | null
  /** The account's user profile (persona) in this chat; null is the plain user. */
  user_profile_id: number | null
  /** JSON ids of the owner's account lorebooks linked to this chat only (see chatLorebookFiles). */
  lorebook_ids: string | null
  /** save_lore saves right away (1), leaves a card (0), or follows the chat settings (null). */
  lore_auto_save: 0 | 1 | null
  /** The writable linked folder new summary stretches are also kept in (see chatMinutes); null: none. */
  minutes_folder_id?: string | null
  /** Why the last background summary failed; null once one succeeds. */
  summary_error: string | null
  /** The chat list: shown first / kept out of the list (in the archive). */
  pinned: 0 | 1
  archived: 0 | 1
  /** Branches: the chat and message copied from, and why (null on older branches and other chats). */
  branched_from_thread_id: number | null
  branched_at_message_id: number | null
  branch_purpose: ChatBranchPurpose | null
  /** The owner has read up to this message; replies after it are unread (null: none read). */
  last_read_message_id: number | null
  created_date: string
  updated_date: string
}

/** `preserve`: the chat as it was before an edit rewrote it; `continue`: branched to go on from that point. */
export type ChatBranchPurpose = 'preserve' | 'continue'

/** Directory rows never read stored summaries, prompts, block edits or engine context. */
export type ChatThreadSummary = Pick<CodexChatThreadRecord,
  'id' | 'title' | 'engine' | 'profile_id' | 'kind' | 'pinned' | 'archived' |
  'branched_from_thread_id' | 'branched_at_message_id' | 'branch_purpose' | 'created_date' | 'updated_date'>

export type ChatThreadListOptions = {
  archive?: 'all' | 'active' | 'archived'
  pinned?: boolean
  kind?: 'direct' | 'group'
  query?: string
  pinnedFirst?: boolean
  limit?: number
  cursor?: string
  /** Legacy MCP offset, applied in SQL; new callers should use the activity cursor. */
  offset?: number
}

const THREAD_SUMMARY_COLUMNS = `t.id, t.title, t.engine, t.profile_id, t.kind, t.pinned, t.archived,
  t.branched_from_thread_id, t.branched_at_message_id, t.branch_purpose, t.created_date, t.updated_date`

function threadListFilter(accountId: number | null, options: ChatThreadListOptions) {
  const where = ['t.account_id IS ?']
  const values: Array<string | number | null> = [accountId]
  if (options.archive && options.archive !== 'all') {
    where.push('t.archived = ?')
    values.push(options.archive === 'archived' ? 1 : 0)
  }
  if (options.pinned !== undefined) { where.push('t.pinned = ?'); values.push(options.pinned ? 1 : 0) }
  if (options.kind) { where.push('t.kind = ?'); values.push(options.kind) }
  const search = options.query?.trim()
  if (search) {
    // Membership is searched inside an already account-scoped room, never used to grant room access.
    where.push(`(instr(lower(t.title), lower(?)) > 0
      OR (t.kind = 'direct' AND instr(lower(COALESCE((SELECT name FROM llm_chat_profiles WHERE id = t.profile_id), '#' || t.profile_id, '')), lower(?)) > 0)
      OR (t.kind = 'group' AND EXISTS (
        SELECT 1 FROM chat_group_members gm LEFT JOIN llm_chat_profiles p ON p.id = gm.profile_id
        WHERE gm.thread_id = t.id AND instr(lower(COALESCE(p.name, '#' || gm.profile_id)), lower(?)) > 0))
      OR (trim(t.title) = '' AND t.profile_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM chat_group_members gm WHERE gm.thread_id = t.id)
        AND instr('채팅 ' || t.id, ?) > 0))`)
    values.push(search, search, search, search)
  }
  if (options.cursor !== undefined) {
    let cursor: unknown
    try { cursor = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8')) } catch { /* Validated below. */ }
    if (!Array.isArray(cursor) || cursor.length !== 3 || (cursor[0] !== 0 && cursor[0] !== 1)
      || typeof cursor[1] !== 'string' || cursor[1].length > 100
      || !Number.isSafeInteger(cursor[2]) || cursor[2] < 1) throw new TypeError('Invalid thread cursor')
    if (options.pinnedFirst) {
      where.push('(t.pinned, t.updated_date, t.id) < (?, ?, ?)')
      values.push(cursor[0], cursor[1], cursor[2])
    } else {
      where.push('(t.updated_date, t.id) < (?, ?)')
      values.push(cursor[1], cursor[2])
    }
  }
  return { where: where.join(' AND '), values }
}

/** The chat list's line under a title: the latest message, flattened to plain text. */
export type ChatThreadPreview = { text: string; role: 'user' | 'assistant'; media: boolean; files: boolean }

const PREVIEW_MAX_LENGTH = 120

/** A message as one plain line: no fenced blocks (display blocks, code), reasoning, tags or markdown marks. */
export function previewText(content: string) {
  return content
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, ' ')
    .replace(/<[^>\n]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`#>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PREVIEW_MAX_LENGTH)
}

export type CodexChatMessageRecord = {
  routing?: ChatMessageRouting | null
  alternatives: ChatMessageAlternative[]
  active_alternative: number
  attachments?: StoredFileEntry[]
  mediaAttachments?: ChatMediaAttachment[]
  id: number
  thread_id: number
  role: 'user' | 'assistant'
  /** What the model sees (English in chats with a translation model). */
  content: string
  /** Chats with a translation model: what the reader sees (the user's own words, or the reply translated). */
  display_content?: string | null
  /** Group rooms: the profile that wrote this reply. Null for the user and in direct chats. */
  speaker_profile_id: number | null
  tool_calls: CodexChatToolCall[]
  status: 'completed' | 'failed' | 'interrupted'
  error: string | null
  /** LLM replies: the provider's finish_reason of the last round; 'length' means the token cap cut the reply. */
  finish_reason: string | null
  /** LLM replies: JSON of what the request for it carried (see ChatContextMeta). */
  context_meta?: string | null
  /** User messages: the chat flags that were on when it was sent. */
  flags?: ChatFlagSnapshot[]
  /** Replies: the text files their tools wrote (derived when reading; see chatFileChanges). */
  fileChanges?: ChatFileChange[]
  created_date: string
}

export type ChatMessageAlternative = {
  routing?: ChatMessageRouting | null
  content: string
  display_content?: string | null
  tool_calls: CodexChatToolCall[]
  created_at: string
  status: CodexChatMessageRecord['status']
  error: string | null
  finish_reason?: string | null
  context_meta?: string | null
}

type StoredMessageRow = Omit<CodexChatMessageRecord, 'tool_calls' | 'alternatives' | 'flags' | 'routing'> & { tool_calls: string | null; alternatives: string | null; flags: string | null; media_attachments: string | null; routing: string | null }

/** A bounded request's historical lookups stay in this thread and exclude the reply being replaced. */
export type ChatHistorySource = { threadId: number; excludeMessageId?: number; untilMessageId?: number }
/** Body-free turn boundaries and wake keys; sendability uses the same parsers as full message reads. */
export type ChatHistoryOutline = Pick<CodexChatMessageRecord, 'id' | 'role' | 'speaker_profile_id' | 'routing'> & { sendable: boolean }
// ECMAScript String.trim whitespace: SQL's default trim only removes ASCII spaces.
const MESSAGE_WHITESPACE = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
const CONTEXT_MESSAGE_COLUMNS = `id, thread_id, role, content, display_content, speaker_profile_id,
  tool_calls, status, error, finish_reason, flags, media_attachments, routing, created_date,
  active_alternative, NULL AS alternatives, NULL AS context_meta`

export function parseMessageRouting(value: string | null): ChatMessageRouting | null {
  try {
    const parsed = JSON.parse(value || 'null') as ChatMessageRouting | null
    return parsed && Array.isArray(parsed.recipients) ? parsed : null
  } catch { return null }
}

const TITLE_MAX_LENGTH = 60

/** A new or emptied Codex thread starts with no usage and no lore in its memory. */
const RESET_CODEX_STATE = `codex_context_tokens = NULL, codex_context_window = NULL, codex_input_tokens = NULL,
  codex_cached_input_tokens = NULL, codex_output_tokens = NULL, codex_lore_sent = NULL`

function parseToolCalls(value: string | null): CodexChatToolCall[] {
  if (!value) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.flatMap(normalizeToolCall) : []
  } catch {
    return []
  }
}

/** A stored call with its required fields filled, so one malformed row can't break the reader. */
function normalizeToolCall(value: unknown): CodexChatToolCall[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const call = value as Partial<CodexChatToolCall>
  const status = call.status === 'running' || call.status === 'failed' ? call.status : 'completed'
  return [{
    ...call,
    id: typeof call.id === 'string' ? call.id : '',
    tool: typeof call.tool === 'string' ? call.tool : '',
    status,
    arguments: call.arguments ?? null,
    summary: typeof call.summary === 'string' ? call.summary : null,
    historyIds: Array.isArray(call.historyIds) ? call.historyIds.filter((id): id is number => typeof id === 'number') : [],
    compositeHashes: Array.isArray(call.compositeHashes) ? call.compositeHashes.filter((hash): hash is string => typeof hash === 'string') : [],
  }]
}

function parseAlternatives(value: string | null): ChatMessageAlternative[] {
  try {
    const parsed: unknown = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Hydrate only the selected rows; a quoted message outside a page is still available in this thread. */
function readMessageRows(threadId: number, rows: StoredMessageRow[]): CodexChatMessageRecord[] {
  if (rows.length === 0) return []
  const attachments = FileStoreService.attachmentsForThread(threadId, { fromId: rows[0].id, untilId: rows[rows.length - 1].id })
  const ids = new Set(rows.map((row) => row.id))
  const parsed = rows.map(({ media_attachments, routing, ...row }) => ({
    ...row, routing: parseMessageRouting(routing), mediaAttachments: parseChatMediaAttachments(media_attachments),
    tool_calls: parseToolCalls(row.tool_calls), alternatives: parseAlternatives(row.alternatives),
    flags: parseFlagSnapshots(row.flags), attachments: attachments.get(row.id) ?? [],
  }))
  const references = [...new Set(parsed.flatMap((row) => row.routing?.replyTo ? [row.routing.replyTo.messageId] : []))].filter((id) => !ids.has(id))
  const db = getUserSettingsDb()
  for (let start = 0; start < references.length; start += 400) {
    const chunk = references.slice(start, start + 400)
    for (const row of db.prepare(`SELECT id FROM codex_chat_messages WHERE thread_id = ? AND id IN (${chunk.map(() => '?').join(',')})`).all(threadId, ...chunk) as Array<{ id: number }>) ids.add(row.id)
  }
  for (const row of parsed) {
    if (row.routing?.replyTo && !ids.has(row.routing.replyTo.messageId)) row.routing.replyTo = { ...row.routing.replyTo, excerpt: '', media: undefined, unavailable: true }
  }
  return parsed
}

/**
 * Any history rewrite invalidates summaries being computed from the old history, and the summary segments that
 * reach the changed message (a Codex chat's compaction divider likewise).
 */
function invalidateContext(threadId: number, changedMessageId: number) {
  getUserSettingsDb().prepare(`UPDATE codex_chat_threads SET
    summary = CASE WHEN summary_until_message_id >= ? THEN NULL ELSE summary END,
    summary_updated_date = CASE WHEN summary_until_message_id >= ? THEN NULL ELSE summary_updated_date END,
    summary_until_message_id = CASE WHEN summary_until_message_id >= ? THEN NULL ELSE summary_until_message_id END,
    codex_thread_id = NULL, ${RESET_CODEX_STATE}, context_revision = context_revision + 1, updated_date = CURRENT_TIMESTAMP WHERE id = ?
  `).run(changedMessageId, changedMessageId, changedMessageId, threadId)
  ChatSummaryStore.invalidateFrom(threadId, changedMessageId)
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
      m.role, m.created_date AS createdDate,
      CASE WHEN instr(lower(COALESCE(m.display_content, '')), lower(?)) > 0
        THEN substr(m.display_content, MAX(1, instr(lower(m.display_content), lower(?)) - 60), 220)
        ELSE substr(m.content, MAX(1, instr(lower(m.content), lower(?)) - 60), 220) END AS excerpt
      FROM codex_chat_messages m JOIN codex_chat_threads t ON t.id = m.thread_id
      WHERE t.account_id IS ? AND (instr(lower(m.content), lower(?)) > 0 OR instr(lower(COALESCE(m.display_content, '')), lower(?)) > 0)
      ORDER BY m.id DESC LIMIT 50
    `).all(query, query, query, accountId, query, query) as Array<{ messageId: number; threadId: number; title: string; profileId: number | null; role: 'user' | 'assistant'; createdDate: string; excerpt: string }>
  },

  /** The latest message of each chat as a list preview (text empty when it was only files or images). */
  listPreviews(threadIds: number[]) {
    const previews = new Map<number, ChatThreadPreview>()
    if (threadIds.length === 0) return previews
    const rows = getUserSettingsDb().prepare(`
      SELECT m.thread_id, m.role, COALESCE(NULLIF(m.display_content, ''), m.content) AS content,
        (m.media_attachments IS NOT NULL AND m.media_attachments NOT IN ('', '[]')) AS media,
        EXISTS (SELECT 1 FROM chat_file_attachments f WHERE f.message_id = m.id) AS files
      FROM codex_chat_messages m
      WHERE m.id IN (SELECT MAX(id) FROM codex_chat_messages WHERE thread_id IN (${threadIds.map(() => '?').join(', ')}) GROUP BY thread_id)
    `).all(...threadIds) as Array<{ thread_id: number; role: 'user' | 'assistant'; content: string; media: number; files: number }>
    for (const row of rows) previews.set(row.thread_id, { text: previewText(row.content), role: row.role, media: row.media === 1, files: row.files === 1 })
    return previews
  },

  /** Replies (assistant messages) after each chat's read mark. */
  countUnread(threadIds: number[]) {
    const counts = new Map<number, number>()
    if (threadIds.length === 0) return counts
    const rows = getUserSettingsDb().prepare(`
      SELECT t.id AS thread_id, COUNT(m.id) AS unread
      FROM codex_chat_threads t JOIN codex_chat_messages m ON m.thread_id = t.id AND m.role = 'assistant' AND m.id > COALESCE(t.last_read_message_id, 0)
      WHERE t.id IN (${threadIds.map(() => '?').join(', ')}) GROUP BY t.id
    `).all(...threadIds) as Array<{ thread_id: number; unread: number }>
    for (const row of rows) counts.set(row.thread_id, row.unread)
    return counts
  },

  /** Move the read mark forward to `messageId` (capped at the chat's latest message; never backwards). */
  markRead(threadId: number, messageId: number) {
    getUserSettingsDb().prepare(`
      UPDATE codex_chat_threads SET last_read_message_id = target.id
      FROM (SELECT MIN(?, COALESCE(MAX(id), 0)) AS id FROM codex_chat_messages WHERE thread_id = ?) AS target
      WHERE codex_chat_threads.id = ? AND COALESCE(last_read_message_id, 0) < target.id
    `).run(messageId, threadId, threadId)
  },

  /** Pin, archive or rename a chat from the chat list (rename keeps its place: the list sorts by activity). */
  updateListState(threadId: number, patch: { title?: string; pinned?: boolean; archived?: boolean }) {
    const db = getUserSettingsDb()
    if (patch.title !== undefined) db.prepare('UPDATE codex_chat_threads SET title = ? WHERE id = ?').run(patch.title.slice(0, TITLE_MAX_LENGTH), threadId)
    if (patch.pinned !== undefined) db.prepare('UPDATE codex_chat_threads SET pinned = ? WHERE id = ?').run(patch.pinned ? 1 : 0, threadId)
    if (patch.archived !== undefined) db.prepare('UPDATE codex_chat_threads SET archived = ? WHERE id = ?').run(patch.archived ? 1 : 0, threadId)
  },

  /** No limit retains the existing UI directory; paged callers enrich only the SQL-selected rows. */
  listThreads(accountId: number | null, options: ChatThreadListOptions = {}) {
    if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1)) throw new TypeError('Invalid thread limit')
    if (options.offset !== undefined && (!Number.isSafeInteger(options.offset) || options.offset < 0)) throw new TypeError('Invalid thread offset')
    if (options.cursor !== undefined && options.offset) throw new TypeError('Use either a thread cursor or an offset')
    const { where, values } = threadListFilter(accountId, options)
    return getUserSettingsDb().prepare(`
      SELECT ${THREAD_SUMMARY_COLUMNS} FROM codex_chat_threads t WHERE ${where}
      ORDER BY ${options.pinnedFirst ? 't.pinned DESC, ' : ''}t.updated_date DESC, t.id DESC
      ${options.limit !== undefined || options.offset ? 'LIMIT ? OFFSET ?' : ''}
    `).all(...values, ...(options.limit !== undefined || options.offset ? [options.limit ?? -1, options.offset ?? 0] : [])) as ChatThreadSummary[]
  },

  listThreadPage(accountId: number | null, options: ChatThreadListOptions = {}) {
    const limit = options.limit ?? 40
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Thread page limit must be 1-100')
    const rows = CodexChatStore.listThreads(accountId, { ...options, limit: limit + 1 })
    const threads = rows.slice(0, limit)
    const has_more = rows.length > limit
    const last = threads.at(-1)
    const { where, values } = threadListFilter(accountId, { ...options, cursor: undefined })
    const { total } = getUserSettingsDb().prepare(`SELECT COUNT(*) AS total FROM codex_chat_threads t WHERE ${where}`).get(...values) as { total: number }
    return {
      threads, total, has_more,
      next_cursor: has_more && last ? Buffer.from(JSON.stringify([last.pinned, last.updated_date, last.id])).toString('base64url') : null,
    }
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

  updateThreadContext(threadId: number, patch: { contextTurns?: number | null; summaryEnabled?: boolean | null; authorNote?: string | null; authorNoteDepth?: number | null; maxTokens?: number | null; reactionEnabled?: boolean; reactionModelSlotId?: number | null; loreAutoSave?: boolean | null }) {
    const db = getUserSettingsDb()
    if (patch.loreAutoSave !== undefined) {
      db.prepare('UPDATE codex_chat_threads SET lore_auto_save = ? WHERE id = ?').run(patch.loreAutoSave === null ? null : patch.loreAutoSave ? 1 : 0, threadId)
    }
    if (patch.reactionEnabled !== undefined) {
      db.prepare('UPDATE codex_chat_threads SET reaction_enabled = ? WHERE id = ?').run(patch.reactionEnabled ? 1 : 0, threadId)
    }
    if (patch.reactionModelSlotId !== undefined) {
      db.prepare('UPDATE codex_chat_threads SET reaction_model_slot_id = ? WHERE id = ?').run(patch.reactionModelSlotId, threadId)
    }
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

  setSummaryError(threadId: number, error: string | null) {
    getUserSettingsDb().prepare('UPDATE codex_chat_threads SET summary_error = ? WHERE id = ? AND summary_error IS NOT ?').run(error, threadId, error)
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

  /**
   * Every way a chat is deleted ends here. Its own lorebook goes with it, after the messages: their attachment rows
   * (which keep a file from being deleted) go with them. A book the chat should keep or merge is dealt with before
   * this (see the thread delete route); a kept book is no longer the chat's, so it stays.
   */
  deleteThread(threadId: number) {
    const db = getUserSettingsDb()
    db.transaction(() => {
      cancelAgentCallsForThread(threadId)
      db.prepare('DELETE FROM codex_chat_messages WHERE thread_id = ?').run(threadId)
      db.prepare('DELETE FROM chat_group_members WHERE thread_id = ?').run(threadId)
      ChatSummaryStore.clear(threadId)
      ChatProposalStore.deleteForThread(threadId)
      forgetThreadFileChanges(threadId)
      // chat_tasks is created on first use (see chatTasks.ts); deleted here without importing the task runner.
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_tasks'").get()) db.prepare('DELETE FROM chat_tasks WHERE thread_id = ?').run(threadId)
      // Its branches stay, as chats of their own.
      db.prepare('UPDATE codex_chat_threads SET branched_from_thread_id = NULL, branched_at_message_id = NULL WHERE branched_from_thread_id = ?').run(threadId)
      db.prepare('DELETE FROM codex_chat_threads WHERE id = ?').run(threadId)
    })()
    try {
      OwnedLorebookStore.threadDeleted(threadId)
    } catch (error) {
      console.warn(`[lorebook] Chat ${threadId}: its book could not be removed:`, error instanceof Error ? error.message : error)
    }
  },

  listMessages(threadId: number, options: { tail?: number; before?: number; after?: number } = {}) {
    const tail = options.tail
    if (tail !== undefined && (!Number.isSafeInteger(tail) || tail < 1)) throw new Error('Invalid message limit')
    if (options.before !== undefined && (!Number.isSafeInteger(options.before) || options.before < 1)) throw new Error('Invalid message cursor')
    if (options.after !== undefined && (!Number.isSafeInteger(options.after) || options.after < 0)) throw new Error('Invalid message cursor')
    const rows = getUserSettingsDb().prepare(`SELECT * FROM codex_chat_messages WHERE thread_id = ?${options.before === undefined ? '' : ' AND id < ?'}${options.after === undefined ? '' : ' AND id > ?'} ORDER BY id ${tail === undefined ? '' : 'DESC LIMIT ?'}`)
      .all(threadId, ...(options.before === undefined ? [] : [options.before]), ...(options.after === undefined ? [] : [options.after]), ...(tail === undefined ? [] : [tail])) as StoredMessageRow[]
    return readMessageRows(threadId, tail === undefined ? rows : rows.reverse())
  },

  hasMessagesBefore(threadId: number, before: number) {
    return Boolean(getUserSettingsDb().prepare('SELECT 1 FROM codex_chat_messages WHERE thread_id = ? AND id < ? LIMIT 1').get(threadId, before))
  },

  /** Explicit historical range for summaries and orders; never includes alternatives/diagnostics or later turns. */
  listContextRange(threadId: number, afterId: number, untilId = Number.MAX_SAFE_INTEGER) {
    const rows = getUserSettingsDb().prepare(`SELECT ${CONTEXT_MESSAGE_COLUMNS} FROM codex_chat_messages WHERE thread_id = ? AND id > ? AND id <= ? ORDER BY id`)
      .all(threadId, afterId, untilId) as StoredMessageRow[]
    return readMessageRows(threadId, rows)
  },

  /** All unsummarized rows, plus the exact recent suffix needed by lore/judges and the last user's flags.
   * Diagnostics and alternative bodies are not completion input; consumers needing those use the source below. */
  listContextMessages(source: ChatHistorySource, options: { afterId: number; recentMessages: number; textMessages: number }) {
    const db = getUserSettingsDb()
    const args = [source.threadId, source.excludeMessageId ?? -1, source.untilMessageId ?? Number.MAX_SAFE_INTEGER]
    const boundary = (filter: string, count: number, extra: string[] = []) =>
      (db.prepare(`SELECT id FROM codex_chat_messages WHERE thread_id = ? AND id != ? AND id <= ? ${filter} ORDER BY id DESC LIMIT 1 OFFSET ?`)
        .get(...args, ...extra, Math.max(0, count - 1)) as { id: number } | undefined)?.id ?? 0
    const recent = boundary('', options.recentMessages)
    // Both original-language judging and model-language semantic retrieval filter blank text before taking a suffix.
    const text = boundary('AND length(trim(content, ?)) > 0', options.textMessages, [MESSAGE_WHITESPACE])
    const original = boundary("AND length(trim(CASE WHEN role = 'user' THEN COALESCE(display_content, content) ELSE content END, ?)) > 0", options.textMessages, [MESSAGE_WHITESPACE])
    const user = boundary("AND role = 'user'", 1)
    const from = Math.min(options.afterId + 1, recent, text, original, user)
    const rows = db.prepare(`SELECT ${CONTEXT_MESSAGE_COLUMNS} FROM codex_chat_messages WHERE thread_id = ? AND id != ? AND id <= ? AND id >= ? ORDER BY id`)
      .all(...args, from) as StoredMessageRow[]
    return readMessageRows(source.threadId, rows)
  },

  /** Positions, not bodies: quote neighbours retain the same turn boundaries outside a request window. */
  listHistoryOutline(source: ChatHistorySource): ChatHistoryOutline[] {
    const rows = getUserSettingsDb().prepare(`SELECT id, role, speaker_profile_id, routing,
      length(trim(content, ?)) > 0 AS has_text,
      CASE WHEN length(trim(content, ?)) = 0 THEN tool_calls END AS tool_calls,
      CASE WHEN length(trim(content, ?)) = 0 THEN media_attachments END AS media_attachments,
      EXISTS(SELECT 1 FROM chat_file_attachments a JOIN stored_file_entries e ON e.id = a.file_id AND e.deleted_at IS NULL WHERE a.message_id = m.id) AS has_files
      FROM codex_chat_messages m WHERE thread_id = ? AND id != ? AND id <= ? ORDER BY id`)
      .all(MESSAGE_WHITESPACE, MESSAGE_WHITESPACE, MESSAGE_WHITESPACE, source.threadId, source.excludeMessageId ?? -1, source.untilMessageId ?? Number.MAX_SAFE_INTEGER) as Array<{
        id: number; role: CodexChatMessageRecord['role']; speaker_profile_id: number | null; routing: string | null
        has_text: number; has_files: number; tool_calls: string | null; media_attachments: string | null
      }>
    return rows.map((row) => ({
      id: row.id, role: row.role, speaker_profile_id: row.speaker_profile_id, routing: parseMessageRouting(row.routing),
      sendable: Boolean(row.has_text || row.has_files || parseToolCalls(row.tool_calls).length || parseChatMediaAttachments(row.media_attachments).length),
    }))
  },

  /** A session's recap is a bounded text-only window, including assistant-only openings. */
  readSessionRecap(source: ChatHistorySource, before: number, limit: number) {
    const db = getUserSettingsDb()
    const args = [source.threadId, source.excludeMessageId ?? -1, source.untilMessageId ?? Number.MAX_SAFE_INTEGER, before, MESSAGE_WHITESPACE]
    const where = 'thread_id = ? AND id != ? AND id <= ? AND id < ? AND length(trim(content, ?)) > 0'
    const messages = db.prepare(`SELECT role, content, routing FROM codex_chat_messages WHERE ${where} ORDER BY id DESC LIMIT ?`)
      .all(...args, limit) as Array<Pick<CodexChatMessageRecord, 'role' | 'content'> & { routing: string | null }>
    return { messages: messages.reverse().map(message => ({ ...message, routing: parseMessageRouting(message.routing) })) }
  },

  /** Session outcomes need forty assistant IDs/tool records, never transcript bodies or alternatives. */
  listOutcomeMessages(source: ChatHistorySource, limit: number, before?: number, speakerId?: number) {
    const rows = getUserSettingsDb().prepare(`SELECT role, routing, tool_calls FROM codex_chat_messages
      WHERE thread_id = ? AND id != ? AND id <= ? AND role = 'assistant'${before === undefined ? '' : ' AND id < ?'}${speakerId === undefined ? '' : ' AND speaker_profile_id = ?'}
      ORDER BY id DESC LIMIT ?`).all(source.threadId, source.excludeMessageId ?? -1, source.untilMessageId ?? Number.MAX_SAFE_INTEGER, ...(before === undefined ? [] : [before]), ...(speakerId === undefined ? [] : [speakerId]), limit) as Array<{ role: 'assistant'; routing: string | null; tool_calls: string | null }>
    return rows.reverse().map((row) => ({ role: row.role, routing: parseMessageRouting(row.routing), tool_calls: parseToolCalls(row.tool_calls) }))
  },

  listMessagePositions(source: ChatHistorySource) {
    return getUserSettingsDb().prepare('SELECT id, role FROM codex_chat_messages WHERE thread_id = ? AND id != ? AND id <= ? ORDER BY id')
      .all(source.threadId, source.excludeMessageId ?? -1, source.untilMessageId ?? Number.MAX_SAFE_INTEGER) as Array<Pick<CodexChatMessageRecord, 'id' | 'role'>>
  },

  /** Lore timers count every message, but only need activation records inside their configured horizon. */
  readLoreTiming(source: ChatHistorySource, horizon: number) {
    const db = getUserSettingsDb()
    const args = [source.threadId, source.excludeMessageId ?? -1, source.untilMessageId ?? Number.MAX_SAFE_INTEGER]
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM codex_chat_messages WHERE thread_id = ? AND id != ? AND id <= ?').get(...args) as { count: number }
    const messages = db.prepare(`SELECT role, speaker_profile_id, '' AS content,
      CASE WHEN json_valid(context_meta) THEN json_object('loreEntries', json_extract(context_meta, '$.loreEntries')) ELSE NULL END AS context_meta
      FROM codex_chat_messages WHERE thread_id = ? AND id != ? AND id <= ? ORDER BY id DESC LIMIT ?`)
      .all(...args, horizon) as Array<Pick<CodexChatMessageRecord, 'role' | 'speaker_profile_id' | 'content' | 'context_meta'>>
    return { messages: messages.reverse(), messageCount: count }
  },

  /** After-reply judges need only the last nonblank original-language texts, not tools or attachments. */
  listJudgeMessages(threadId: number, limit: number, untilId = Number.MAX_SAFE_INTEGER): CodexChatMessageRecord[] {
    const rows = getUserSettingsDb().prepare(`SELECT id, thread_id, role, content, display_content, speaker_profile_id
      FROM codex_chat_messages WHERE thread_id = ? AND id <= ? AND length(trim(CASE WHEN role = 'user' THEN COALESCE(display_content, content) ELSE content END, ?)) > 0
      ORDER BY id DESC LIMIT ?`).all(threadId, untilId, MESSAGE_WHITESPACE, limit) as Array<Pick<CodexChatMessageRecord, 'id' | 'thread_id' | 'role' | 'content' | 'display_content' | 'speaker_profile_id'>>
    return rows.reverse().map((row) => ({ ...row, tool_calls: [], alternatives: [], active_alternative: 0, status: 'completed', error: null, finish_reason: null, created_date: '' }))
  },

  trailingReplyCount(threadId: number) {
    return (getUserSettingsDb().prepare(`SELECT COUNT(*) AS count FROM codex_chat_messages
      WHERE thread_id = ? AND role = 'assistant' AND id > COALESCE((SELECT MAX(id) FROM codex_chat_messages WHERE thread_id = ? AND role = 'user'), 0)`)
      .get(threadId, threadId) as { count: number }).count
  },

  findMessage(threadId: number, messageId: number) {
    const row = getUserSettingsDb().prepare('SELECT * FROM codex_chat_messages WHERE thread_id = ? AND id = ?').get(threadId, messageId) as StoredMessageRow | undefined
    return row ? readMessageRows(threadId, [row])[0] : undefined
  },

  latestMessage(threadId: number) {
    return CodexChatStore.listMessages(threadId, { tail: 1 })[0]
  },

  latestUserMessageId(threadId: number) {
    return (getUserSettingsDb().prepare("SELECT id FROM codex_chat_messages WHERE thread_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1").get(threadId) as { id: number } | undefined)?.id ?? null
  },

  /** Active routing only, scoped to this thread; variants do not own the current generation result. */
  findMessageByReplyId(threadId: number, replyId: string, role?: CodexChatMessageRecord['role']) {
    const row = getUserSettingsDb().prepare(`SELECT id FROM codex_chat_messages
      WHERE thread_id = ? AND CASE WHEN json_valid(routing) THEN json_type(routing, '$.recipients') = 'array' AND json_extract(routing, '$.replyId') = ? ELSE 0 END
      ${role === undefined ? '' : 'AND role = ?'} ORDER BY id LIMIT 1`).get(threadId, replyId, ...(role === undefined ? [] : [role])) as { id: number } | undefined
    return row ? CodexChatStore.findMessage(threadId, row.id) : undefined
  },

  messageCount(threadId: number) {
    return (getUserSettingsDb().prepare('SELECT COUNT(*) AS count FROM codex_chat_messages WHERE thread_id = ?').get(threadId) as { count: number }).count
  },

  /** Display state needs fenced replies, without tool outputs, alternatives, attachments or diagnostics. */
  listBlockMessages(threadId: number, untilId = Number.MAX_SAFE_INTEGER) {
    return getUserSettingsDb().prepare("SELECT id, role, content, speaker_profile_id FROM codex_chat_messages WHERE thread_id = ? AND id <= ? AND role = 'assistant' AND instr(content, '```') > 0 ORDER BY id")
      .all(threadId, untilId) as Array<Pick<CodexChatMessageRecord, 'id' | 'role' | 'content' | 'speaker_profile_id'>>
  },

  latestMessageId(threadId: number, before?: number) {
    const row = getUserSettingsDb().prepare(`SELECT id FROM codex_chat_messages WHERE thread_id = ?${before === undefined ? '' : ' AND id < ?'} ORDER BY id DESC LIMIT 1`).get(threadId, ...(before === undefined ? [] : [before])) as { id: number } | undefined
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

  /** The model's (English) text of a user message translated after it was stored; the reader keeps their own words. */
  setUserMessageTranslation(threadId: number, messageId: number, content: string, displayContent: string | null, flags?: ChatFlagSnapshot[], error: string | null = null) {
    getUserSettingsDb().prepare("UPDATE codex_chat_messages SET content = ?, display_content = COALESCE(?, display_content), flags = COALESCE(?, flags), error = ? WHERE thread_id = ? AND id = ? AND role = 'user'").run(content, displayContent, flags ? JSON.stringify(flags) : null, error, threadId, messageId)
    notifySemanticChange('message')
  },

  editUserMessage(threadId: number, messageId: number, content: string, displayContent: string | null = null, flags?: ChatFlagSnapshot[], error: string | null = null) {
    const db = getUserSettingsDb()
    db.transaction(() => {
      const updated = db.prepare("UPDATE codex_chat_messages SET content = ?, display_content = ?, flags = COALESCE(?, flags), error = ? WHERE thread_id = ? AND id = ? AND role = 'user'").run(content, displayContent, flags ? JSON.stringify(flags) : null, error, threadId, messageId)
      if (!updated.changes) throw new Error('User message not found')
      removeMessagesAfter(threadId, messageId)
      invalidateContext(threadId, messageId)
    }).immediate()
    notifySemanticChange('message')
  },

  /**
   * Replace a reply's text by hand (its shown variant too); later messages stay. The reader's translation goes with
   * the old text, so the edit is what both the reader and the model see from now on.
   */
  editAssistantMessage(threadId: number, messageId: number, content: string) {
    const db = getUserSettingsDb()
    db.transaction(() => {
      const row = db.prepare("SELECT alternatives, active_alternative FROM codex_chat_messages WHERE thread_id = ? AND id = ? AND role = 'assistant'").get(threadId, messageId) as { alternatives: string | null; active_alternative: number } | undefined
      if (!row) throw new Error('Assistant message not found')
      const alternatives = parseAlternatives(row.alternatives)
      if (alternatives[row.active_alternative]) alternatives[row.active_alternative] = { ...alternatives[row.active_alternative], content, display_content: null }
      db.prepare('UPDATE codex_chat_messages SET content = ?, display_content = NULL, alternatives = ? WHERE id = ?')
        .run(content, alternatives.length > 0 ? JSON.stringify(alternatives) : null, messageId)
      invalidateContext(threadId, messageId)
    }).immediate()
    notifySemanticChange('message')
  },

  /**
   * Add `suffix` to the end of a reply (its shown variant and the reader's translation too) when its text is still
   * `expected`; false when it changed meanwhile (regenerated, edited, switched). The summary is left as it is: what is
   * added are block fences, which the history leaves out (see stripBlockFences). Announced like a new reply.
   */
  appendToReply(threadId: number, messageId: number, expected: string, suffix: string) {
    const db = getUserSettingsDb()
    const accountId = db.transaction(() => {
      const row = db.prepare("SELECT m.content, m.display_content, m.alternatives, m.active_alternative, t.account_id FROM codex_chat_messages m JOIN codex_chat_threads t ON t.id = m.thread_id WHERE m.thread_id = ? AND m.id = ? AND m.role = 'assistant'").get(threadId, messageId) as { content: string; display_content: string | null; alternatives: string | null; active_alternative: number; account_id: number | null } | undefined
      if (!row || row.content !== expected) return undefined
      const content = `${row.content.trimEnd()}${suffix}`
      const display = row.display_content === null ? null : `${row.display_content.trimEnd()}${suffix}`
      const alternatives = parseAlternatives(row.alternatives)
      if (alternatives[row.active_alternative]) alternatives[row.active_alternative] = { ...alternatives[row.active_alternative], content, display_content: display }
      db.prepare('UPDATE codex_chat_messages SET content = ?, display_content = ?, alternatives = ? WHERE id = ?')
        .run(content, display, alternatives.length > 0 ? JSON.stringify(alternatives) : null, messageId)
      return row.account_id
    }).immediate()
    if (accountId === undefined) return false
    notifySemanticChange('message')
    publishRuntimeEvent({ name: 'chat.message.updated', topic: 'generation-queue', visibility: 'owner', accountId,
      payload: { threadId, messageId, requestedByAccountId: accountId } })
    return true
  },

  clearThread(threadId: number, opening: (() => void) | '') {
    const db = getUserSettingsDb()
    db.transaction(() => {
      db.prepare('DELETE FROM chat_generation_links WHERE thread_id = ?').run(threadId)
      db.prepare('DELETE FROM chat_deferred_generations WHERE thread_id = ?').run(threadId)
      removeMessagesAfter(threadId, 0)
      ChatSummaryStore.clear(threadId)
      db.prepare(`UPDATE codex_chat_threads SET summary = NULL, summary_until_message_id = NULL, summary_updated_date = NULL, summary_error = NULL, block_edits = NULL,
        codex_thread_id = NULL, ${RESET_CODEX_STATE}, context_revision = context_revision + 1, updated_date = CURRENT_TIMESTAMP WHERE id = ?`).run(threadId)
      if (opening) opening()
    }).immediate()
  },

  addAlternative(threadId: number, messageId: number, alternative: ChatMessageAlternative) {
    const db = getUserSettingsDb()
    db.transaction(() => {
      const row = db.prepare("SELECT * FROM codex_chat_messages WHERE thread_id = ? AND id = ? AND role = 'assistant'").get(threadId, messageId) as StoredMessageRow | undefined
      if (!row) throw new Error('Assistant message not found')
      const alternatives = parseAlternatives(row.alternatives)
      if (!alternatives.length) alternatives.push({ content: row.content, display_content: row.display_content ?? null, tool_calls: parseToolCalls(row.tool_calls), created_at: row.created_date, status: row.status, error: row.error, finish_reason: row.finish_reason ?? null, routing: parseMessageRouting(row.routing), context_meta: row.context_meta ?? null })
      alternatives.push(alternative)
      db.prepare(`UPDATE codex_chat_messages SET alternatives = ?, active_alternative = ?, content = ?, display_content = ?, tool_calls = ?, status = ?, error = ?, finish_reason = ?, context_meta = ? WHERE id = ?`)
        .run(JSON.stringify(alternatives), alternatives.length - 1, alternative.content, alternative.display_content ?? null, JSON.stringify(alternative.tool_calls), alternative.status, alternative.error, alternative.finish_reason ?? null, alternative.context_meta ?? null, messageId)
      invalidateContext(threadId, messageId)
      if (alternative.routing !== undefined) CodexChatStore.setMessageRouting(threadId, messageId, alternative.routing)
    }).immediate()
    notifySemanticChange('message')
  },

  selectAlternative(threadId: number, messageId: number, index: number) {
    const db = getUserSettingsDb()
    db.transaction(() => {
      const row = db.prepare("SELECT * FROM codex_chat_messages WHERE thread_id = ? AND id = ? AND role = 'assistant'").get(threadId, messageId) as StoredMessageRow | undefined
      const alternative = row ? parseAlternatives(row.alternatives)[index] : undefined
      if (!alternative) throw new Error('Alternative not found')
      db.prepare('UPDATE codex_chat_messages SET active_alternative = ?, content = ?, display_content = ?, tool_calls = ?, status = ?, error = ?, finish_reason = ?, context_meta = ? WHERE id = ?')
        .run(index, alternative.content, alternative.display_content ?? null, JSON.stringify(alternative.tool_calls), alternative.status, alternative.error, alternative.finish_reason ?? null, alternative.context_meta ?? null, messageId)
      invalidateContext(threadId, messageId)
      CodexChatStore.setMessageRouting(threadId, messageId, alternative.routing ?? null)
    }).immediate()
    notifySemanticChange('message')
  },

  /** Generation jobs a reply started now belong to another reply id (a continuation of it). */
  moveGenerationLinks(threadId: number, fromReplyId: string, toReplyId: string) {
    const db = getUserSettingsDb()
    db.transaction(() => {
      db.prepare(`INSERT OR IGNORE INTO chat_generation_reactions (reply_id, thread_id, state, attempts, message_id, updated_at)
        SELECT ?, thread_id, state, attempts, message_id, updated_at FROM chat_generation_reactions WHERE thread_id = ? AND reply_id = ?`)
        .run(toReplyId, threadId, fromReplyId)
      db.prepare('UPDATE chat_generation_links SET reply_id = ? WHERE thread_id = ? AND reply_id = ?').run(toReplyId, threadId, fromReplyId)
      db.prepare('UPDATE chat_deferred_generations SET reply_id = ? WHERE thread_id = ? AND reply_id = ?').run(toReplyId, threadId, fromReplyId)
    }).immediate()
  },

  /** What the request for a reply carried, on the reply and on its shown variant (so switching variants keeps each one's). */
  setContextMeta(messageId: number, meta: unknown) {
    const db = getUserSettingsDb()
    const json = JSON.stringify(meta)
    db.transaction(() => {
      const row = db.prepare('SELECT alternatives, active_alternative FROM codex_chat_messages WHERE id = ?').get(messageId) as { alternatives: string | null; active_alternative: number } | undefined
      if (!row) return
      const alternatives = parseAlternatives(row.alternatives)
      if (alternatives[row.active_alternative]) alternatives[row.active_alternative] = { ...alternatives[row.active_alternative], context_meta: json }
      db.prepare('UPDATE codex_chat_messages SET context_meta = ?, alternatives = ? WHERE id = ?').run(json, alternatives.length > 0 ? JSON.stringify(alternatives) : row.alternatives, messageId)
    })()
  },

  setMessageRouting(threadId: number, messageId: number, routing: ChatMessageRouting | null) {
    const db = getUserSettingsDb()
    db.prepare('UPDATE codex_chat_messages SET routing = ? WHERE thread_id = ? AND id = ?').run(routing ? JSON.stringify(routing) : null, threadId, messageId)
    if (routing?.replyId) db.prepare('UPDATE chat_generation_links SET message_id = ? WHERE thread_id = ? AND reply_id = ?').run(messageId, threadId, routing.replyId)
  },

  /**
   * The reply id an assistant message acts under (see ChatExecutionContext.replyId), given one first when it has none
   * (a greeting, an imported or old message): its shown variant keeps the same, so switching variants keeps it too.
   */
  ensureReplyId(threadId: number, messageId: number, newId: () => string) {
    const db = getUserSettingsDb()
    return db.transaction(() => {
      const row = db.prepare("SELECT routing, alternatives, active_alternative FROM codex_chat_messages WHERE thread_id = ? AND id = ? AND role = 'assistant'").get(threadId, messageId) as { routing: string | null; alternatives: string | null; active_alternative: number } | undefined
      if (!row) throw new Error('Assistant message not found')
      const routing = parseMessageRouting(row.routing)
      if (routing?.replyId) return routing.replyId
      const next: ChatMessageRouting = { ...(routing ?? { replyTo: null, recipients: ['user'] }), replyId: newId() }
      const alternatives = parseAlternatives(row.alternatives)
      if (alternatives[row.active_alternative]) {
        alternatives[row.active_alternative] = { ...alternatives[row.active_alternative], routing: next }
        db.prepare('UPDATE codex_chat_messages SET alternatives = ? WHERE id = ?').run(JSON.stringify(alternatives), messageId)
      }
      CodexChatStore.setMessageRouting(threadId, messageId, next)
      return next.replyId as string
    }).immediate()
  },

  /**
   * Tool calls an order made in a reply's name (see chatOrderRunner), added to that reply: to the message when it shows
   * the variant with that reply id, else to that variant. False when neither is there any more. Announced like an edit.
   */
  appendReplyToolCalls(threadId: number, messageId: number, replyId: string, calls: CodexChatToolCall[]) {
    const db = getUserSettingsDb()
    const accountId = db.transaction(() => {
      const row = db.prepare("SELECT m.routing, m.tool_calls, m.alternatives, m.active_alternative, t.account_id FROM codex_chat_messages m JOIN codex_chat_threads t ON t.id = m.thread_id WHERE m.thread_id = ? AND m.id = ? AND m.role = 'assistant'").get(threadId, messageId) as { routing: string | null; tool_calls: string | null; alternatives: string | null; active_alternative: number; account_id: number | null } | undefined
      if (!row) return undefined
      const alternatives = parseAlternatives(row.alternatives)
      const shown = parseMessageRouting(row.routing)?.replyId === replyId
      const index = shown ? row.active_alternative : alternatives.findIndex((alternative) => alternative.routing?.replyId === replyId)
      if (!shown && index < 0) return undefined
      if (alternatives[index]) alternatives[index] = { ...alternatives[index], tool_calls: [...alternatives[index].tool_calls, ...calls] }
      if (shown) db.prepare('UPDATE codex_chat_messages SET tool_calls = ? WHERE id = ?').run(JSON.stringify([...parseToolCalls(row.tool_calls), ...calls]), messageId)
      if (alternatives.length > 0) db.prepare('UPDATE codex_chat_messages SET alternatives = ? WHERE id = ?').run(JSON.stringify(alternatives), messageId)
      return row.account_id
    }).immediate()
    if (accountId === undefined) return false
    publishRuntimeEvent({ name: 'chat.message.updated', topic: 'generation-queue', visibility: 'owner', accountId,
      payload: { threadId, messageId, requestedByAccountId: accountId } })
    return true
  },

  addMessage(message: Pick<CodexChatMessageRecord, 'thread_id' | 'role' | 'content' | 'display_content' | 'tool_calls' | 'status' | 'error' | 'flags' | 'mediaAttachments' | 'routing'> & { speaker_profile_id?: number | null; finish_reason?: string | null }, fileIds: string[] = [], options: { notify?: boolean } = {}) {
    const db = getUserSettingsDb()
    const saved = db.transaction(() => {
      const thread = CodexChatStore.findThreadById(message.thread_id)
      if (!thread) throw new Error('Chat thread not found')
      const attachments = FileStoreService.validateAttachments(fileOwnerKey(thread.account_id), fileIds)
      const result = db.prepare(`
        INSERT INTO codex_chat_messages (thread_id, role, content, display_content, tool_calls, status, error, speaker_profile_id, flags, finish_reason, media_attachments) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        message.thread_id,
        message.role,
        message.content,
        message.display_content ?? null,
        message.tool_calls.length > 0 ? JSON.stringify(message.tool_calls) : null,
        message.status,
        message.error,
        message.speaker_profile_id ?? null,
        message.flags?.length ? JSON.stringify(message.flags) : null,
        message.finish_reason ?? null,
        message.mediaAttachments?.length ? JSON.stringify(message.mediaAttachments) : null,
      )
      for (const file of attachments) db.prepare('INSERT INTO chat_file_attachments (message_id, file_id) VALUES (?, ?)').run(result.lastInsertRowid, file.id)
      if (message.routing) CodexChatStore.setMessageRouting(message.thread_id, Number(result.lastInsertRowid), message.routing)
      CodexChatStore.touchThread(message.thread_id)
      // Writing a message means the owner has seen everything before it.
      if (message.role === 'user') CodexChatStore.markRead(message.thread_id, Number(result.lastInsertRowid))
      return { id: Number(result.lastInsertRowid), accountId: thread.account_id }
    }).immediate()
    if (options.notify !== false) CodexChatStore.notifyMessageAdded({ ...saved, threadId: message.thread_id, role: message.role })
    return saved.id
  },

  /** Owners of an outer transaction suppress addMessage notifications and call this only after commit. */
  notifyMessageAdded(message: { id: number; threadId: number; accountId: number | null; role: CodexChatMessageRecord['role'] }) {
    notifySemanticChange('message')
    if (message.role === 'assistant') {
      publishRuntimeEvent({ name: 'chat.message.created', topic: 'generation-queue', visibility: 'owner', accountId: message.accountId,
        payload: { threadId: message.threadId, messageId: message.id, requestedByAccountId: message.accountId } })
    }
  },
}
