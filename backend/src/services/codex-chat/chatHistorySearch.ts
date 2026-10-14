import { getUserSettingsDb } from '../../database/userSettingsDb'
import { parseSearchTerms } from '../fileStoreSearch'
import { normalizeLinkedFiles } from './chatLinkedFiles'
import { normalizeLorebookIds } from './chatLorebook'
import { EMBEDDING_MODEL_KEY, embedQuery, embeddingFeatureOn } from '../aiWorker/textEmbeddingService'
import { indexMessagesNow } from '../embeddings/semanticIndex'
import { fuseRanks, SEMANTIC_SPACES, standouts } from '../embeddings/rankFusion'
import { vectorStore } from '../vectors/vectorStore'

/**
 * Searching past conversation: the chat's own messages, and the chats connected to it. Two chats are connected when
 * they share a piece of knowledge they write to or read from — an account lorebook or a linked file store folder or
 * file, linked to the chat itself or to its profile (a room: its members') — so a planning chat and the meeting room
 * working on the same book and folder can look up each other's talk, while unrelated chats stay apart. Only the chat
 * owner's chats, read-only.
 */

export const HISTORY_SEARCH_LIMIT = 20
const EXCERPT_BEFORE = 80
const EXCERPT_LENGTH = 240

type ThreadLinkRow = { id: number; kind: string | null; profile_id: number | null; lorebook_ids: string | null; linked_files: string | null }

/** Knowledge keys of every profile with links: `book:<id>` (account books only, a global book is everyone's) and `file:<id>`. */
function profileKeys(accountBooks: Set<number>) {
  const rows = getUserSettingsDb().prepare("SELECT id, lorebook_ids, linked_files FROM llm_chat_profiles WHERE (lorebook_ids IS NOT NULL AND lorebook_ids != '[]') OR (linked_files IS NOT NULL AND linked_files != '[]')")
    .all() as Array<{ id: number; lorebook_ids: string | null; linked_files: string | null }>
  return new Map(rows.map((row) => [row.id, keysOf(row.lorebook_ids, row.linked_files, accountBooks)]))
}

function keysOf(lorebookIds: string | null, linkedFiles: string | null, accountBooks: Set<number>) {
  return [
    ...normalizeLorebookIds(lorebookIds).filter((id) => accountBooks.has(id)).map((id) => `book:${id}`),
    ...normalizeLinkedFiles(linkedFiles).map((link) => `file:${link.id}`),
  ]
}

/**
 * The owner's chats connected to `threadId` (not counting itself), newest first. Keys are compared as stored: links
 * the owner can no longer use still connect, as the knowledge they shared is the reason to look.
 */
export function connectedThreadIds(threadId: number, accountId: number | null): number[] {
  const db = getUserSettingsDb()
  const accountBooks = new Set((db.prepare("SELECT id FROM chat_lorebooks WHERE kind = 'account'").all() as Array<{ id: number }>).map((row) => row.id))
  const profiles = profileKeys(accountBooks)
  const threads = db.prepare('SELECT id, kind, profile_id, lorebook_ids, linked_files FROM codex_chat_threads WHERE account_id IS ? ORDER BY updated_date DESC, id DESC').all(accountId) as ThreadLinkRow[]
  const members = new Map<number, number[]>()
  const groupIds = threads.filter((thread) => thread.kind === 'group').map((thread) => thread.id)
  if (groupIds.length > 0) {
    const rows = db.prepare(`SELECT thread_id, profile_id FROM chat_group_members WHERE thread_id IN (${groupIds.map(() => '?').join(', ')})`).all(...groupIds) as Array<{ thread_id: number; profile_id: number }>
    for (const row of rows) members.set(row.thread_id, [...(members.get(row.thread_id) ?? []), row.profile_id])
  }
  const keysFor = (thread: ThreadLinkRow) => {
    const speakers = thread.kind === 'group' ? members.get(thread.id) ?? [] : thread.profile_id !== null ? [thread.profile_id] : []
    return new Set([...keysOf(thread.lorebook_ids, thread.linked_files, accountBooks), ...speakers.flatMap((id) => profiles.get(id) ?? [])])
  }
  const self = threads.find((thread) => thread.id === threadId)
  if (!self) return []
  const own = keysFor(self)
  if (own.size === 0) return []
  return threads.filter((thread) => thread.id !== threadId && [...keysFor(thread)].some((key) => own.has(key))).map((thread) => thread.id)
}

/**
 * Whether a direct chat works with knowledge it shares (an account book or linked files, its own or its profile's):
 * only such a chat gets the history tools, so a plain chat keeps its short tool list.
 */
export function sharesKnowledge(thread: { id: number; account_id: number | null; profile_id: number | null }): boolean {
  const db = getUserSettingsDb()
  const row = db.prepare('SELECT lorebook_ids, linked_files FROM codex_chat_threads WHERE id = ?').get(thread.id) as { lorebook_ids: string | null; linked_files: string | null } | undefined
  const session = db.prepare("SELECT 1 FROM codex_chat_threads t LEFT JOIN llm_chat_profiles p ON p.id = t.profile_id WHERE t.id = ? AND (t.engine = 'codex' OR p.engine IN ('codex', 'claude') OR p.llm_runtime = 'pi')").get(thread.id)
  if (session) return true
  if (normalizeLinkedFiles(row?.linked_files ?? null).length > 0) return true
  const profile = thread.profile_id === null ? undefined : db.prepare('SELECT lorebook_ids, linked_files FROM llm_chat_profiles WHERE id = ?').get(thread.profile_id) as { lorebook_ids: string | null; linked_files: string | null } | undefined
  if (normalizeLinkedFiles(profile?.linked_files ?? null).length > 0) return true
  const books = [...normalizeLorebookIds(row?.lorebook_ids ?? null), ...normalizeLorebookIds(profile?.lorebook_ids ?? null)]
  if (books.length === 0) return false
  return Boolean(db.prepare(`SELECT 1 FROM chat_lorebooks WHERE kind = 'account' AND id IN (${books.map(() => '?').join(', ')})`).get(...books))
}

export type HistoryHit = { chat_id: number; message_id: number; role: 'user' | 'assistant'; speaker_profile_id: number | null; at: string; excerpt: string; routing: string | null }

/** Messages embedded on the spot before a search (newest first); older ones are left to the background pass. */
const INDEX_BEFORE_SEARCH = 32
/** A search may wait for the model to load (a tool call, not a reply in progress). */
const SEARCH_QUERY_WAIT_MS = 20_000
const SEMANTIC_MIN_SCORE = 0.6
const SEMANTIC_MIN_LEAD = 0.04

/**
 * Searching with text embeddings on: messages holding the words (searchChatMessages) and messages close in meaning,
 * the two rankings fused, best first. Without embeddings (or when they fail) it is searchChatMessages, newest first.
 */
export type HistorySearchStatus = { mode: 'keyword' | 'hybrid'; semantic: 'disabled' | 'unavailable' | 'partial' | 'ready' | 'not_indexed'; indexedMessages: number; totalMessages: number; keywordTermsLimited?: boolean }

export async function searchChatHistory(threadIds: number[], query: string, limit: number, report?: (status: HistorySearchStatus) => void, signal?: AbortSignal): Promise<HistoryHit[]> {
  const capped = Math.min(Math.max(1, limit), HISTORY_SEARCH_LIMIT)
  const status: HistorySearchStatus = { mode: 'keyword', semantic: 'disabled', indexedMessages: 0, totalMessages: 0, keywordTermsLimited: parseSearchTerms(query, { allowLong: true }).length > 8 }
  report?.(status)
  if (threadIds.length === 0) return []
  if (!embeddingFeatureOn('chatHistory')) return searchChatMessages(threadIds, query, capped)
  let lexical: HistoryHit[] = []
  let lexicalError: unknown = null
  try {
    lexical = searchChatMessages(threadIds, query, HISTORY_SEARCH_LIMIT)
  } catch (error) {
    lexicalError = error
  }
  const pending = embedQuery(query, { waitMs: SEARCH_QUERY_WAIT_MS, signal })
  // Backfill is shared with the indexer; it must not hold the keyword fallback past the query deadline.
  if (!signal?.aborted) void indexMessagesNow(threadIds, INDEX_BEFORE_SEARCH).catch(() => 0)
  const vector = await pending
  if (!vector) {
    status.semantic = 'unavailable'
    if (lexicalError) throw lexicalError
    return lexical.slice(0, capped)
  }
  const live = getUserSettingsDb().prepare(`SELECT m.id, v.content_hash FROM codex_chat_messages m
    LEFT JOIN vector_db.vectors v ON v.space = ? AND v.model_key = ? AND v.source_key = CAST(m.id AS TEXT) AND v.chunk = 0
      AND v.content_hash = semantic_text_hash(m.content)
    WHERE m.thread_id IN (${threadIds.map(Number).join(',')}) AND m.role IN ('user', 'assistant') AND trim(m.content) != ''`)
    .all(SEMANTIC_SPACES.message, EMBEDDING_MODEL_KEY) as Array<{ id: number; content_hash: string | null }>
  const current = new Map(live.filter(row => row.content_hash !== null).map(row => [String(row.id), row.content_hash]))
  Object.assign(status, { mode: 'hybrid', indexedMessages: current.size, totalMessages: live.length,
    semantic: current.size === 0 && live.length ? 'not_indexed' : current.size < live.length ? 'partial' : 'ready' })
  const hits = vectorStore.search(SEMANTIC_SPACES.message, EMBEDDING_MODEL_KEY, vector, { ownerKeys: threadIds.map((id) => `thread:${id}`) })
  const best = new Map<number, { score: number; spanStart: number | null }>()
  for (const hit of hits) {
    if (current.get(hit.sourceKey) !== hit.contentHash) continue
    const id = Number(hit.sourceKey)
    if (!best.has(id) || best.get(id)!.score < hit.score) best.set(id, { score: hit.score, spanStart: hit.spanStart })
  }
  const close = standouts(new Map([...best].map(([id, value]) => [id, value.score])), SEMANTIC_MIN_SCORE, SEMANTIC_MIN_LEAD).slice(0, HISTORY_SEARCH_LIMIT).map(([id]) => id)
  const fused = fuseRanks([lexical.map((hit) => hit.message_id), close])
  const known = new Map(lexical.map((hit) => [hit.message_id, hit]))
  const missing = close.filter((id) => !known.has(id))
  if (missing.length > 0) {
    const rows = getUserSettingsDb().prepare(`SELECT thread_id AS chat_id, id AS message_id, role, speaker_profile_id, created_date AS at, content, routing
      FROM codex_chat_messages WHERE id IN (${missing.map(Number).join(', ')})`).all() as Array<Omit<HistoryHit, 'excerpt'> & { content: string }>
    for (const { content, ...row } of rows) {
      const start = Math.max(0, (best.get(row.message_id)?.spanStart ?? 0))
      known.set(row.message_id, { ...row, excerpt: content.slice(start, start + EXCERPT_LENGTH) })
    }
  }
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])
    .flatMap(([id]) => known.get(id) ?? [])
    .slice(0, capped)
}

/**
 * Messages of these chats holding every word of `query` (space-separated; a "quoted phrase" as written), in the text
 * the model got or the one the person saw (a translated chat), newest first.
 */
export function searchChatMessages(threadIds: number[], query: string, limit: number): HistoryHit[] {
  if (threadIds.length === 0) return []
  const terms = parseSearchTerms(query, { allowLong: true }).slice(0, 8)
  const params: Record<string, string | number> = { limit: Math.min(Math.max(1, limit), HISTORY_SEARCH_LIMIT) }
  terms.forEach((term, index) => { params[`t${index}`] = term })
  const text = "(lower(m.content) || char(10) || lower(COALESCE(m.display_content, '')))"
  const every = terms.map((_, index) => `instr(${text}, @t${index}) > 0`).join(' AND ')
  // The excerpt opens a little before the first word, in whichever text holds it.
  const inContent = 'instr(lower(m.content), @t0) > 0'
  const excerpt = `CASE WHEN ${inContent}
      THEN substr(m.content, MAX(1, instr(lower(m.content), @t0) - ${EXCERPT_BEFORE}), ${EXCERPT_LENGTH})
      ELSE substr(m.display_content, MAX(1, instr(lower(m.display_content), @t0) - ${EXCERPT_BEFORE}), ${EXCERPT_LENGTH}) END`
  return getUserSettingsDb().prepare(`SELECT m.thread_id AS chat_id, m.id AS message_id, m.role, m.speaker_profile_id, m.created_date AS at, ${excerpt} AS excerpt, m.routing
    FROM codex_chat_messages m WHERE m.thread_id IN (${threadIds.map((id) => Number(id)).join(', ')}) AND m.role IN ('user', 'assistant') AND ${every}
    ORDER BY m.id DESC LIMIT @limit`).all(params) as HistoryHit[]
}
