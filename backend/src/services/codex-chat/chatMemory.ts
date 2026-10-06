import { getUserSettingsDb } from '../../database/userSettingsDb'

/**
 * Long-term memory of a chat, in three layers:
 *   1. the chat lorebook — the chat's own book (see chatLorebookFiles); its always-on entries go with every request,
 *      next to the lore index of every attached book, and its keyword entries when the conversation names them
 *   2. summary segments — each stretch of folded conversation summarized on its own (level 0), the older ones folded
 *      once more into one plot (level 1). The plot and the segments after it are the rolling summary the model gets.
 *   3. recall — segments already folded into the plot come back, verbatim, when the conversation touches them again
 * This file holds layers 2 and 3.
 */

// ---- Summary segments -----------------------------------------------------------------------------------------

export type ChatSummarySegment = {
  id: number
  thread_id: number
  /** 0: one stretch of conversation; 1: the plot, folded from the older stretches. */
  level: 0 | 1
  from_message_id: number
  until_message_id: number
  content: string
  /**
   * Plots: 1 when the level-0 rows beneath cover its whole range, so dropping it loses nothing; 0 for a plot that
   * stands on its own (a summary from before segments, or one written by hand), and any plot folded from one.
   */
  backed: 0 | 1
  created_date: string
  updated_date: string
}

/** Segments in the order they happened (the plot first: it covers the start). */
function listSegments(threadId: number) {
  return getUserSettingsDb().prepare('SELECT * FROM chat_summary_segments WHERE thread_id = ? ORDER BY level DESC, until_message_id, id').all(threadId) as ChatSummarySegment[]
}

/**
 * What the model gets as the summary — the plot, then the segments after it — and what stays out of it: segments the
 * plot already covers, kept for recall.
 */
export function splitSegments(segments: ChatSummarySegment[]) {
  const plot = segments.find((segment) => segment.level === 1) ?? null
  const covered = plot ? plot.until_message_id : 0
  const stretches = segments.filter((segment) => segment.level === 0)
  return {
    plot,
    active: stretches.filter((segment) => segment.until_message_id > covered),
    folded: stretches.filter((segment) => segment.until_message_id <= covered),
  }
}

export function renderSummary(segments: ChatSummarySegment[]) {
  const { plot, active } = splitSegments(segments)
  return [plot?.content, ...active.map((segment) => segment.content)].map((text) => text?.trim()).filter(Boolean).join('\n\n')
}

/**
 * Keep the thread's summary columns in step with its segments: the rendered text and the last message folded. The
 * revision moves with every change of what was folded (`bump`), so a fold computed from the old state is dropped; a
 * hand edit of a segment's text leaves it.
 */
function syncThreadSummary(threadId: number, bump = true) {
  const segments = listSegments(threadId)
  const until = segments.reduce<number | null>((max, segment) => (max === null || segment.until_message_id > max ? segment.until_message_id : max), null)
  getUserSettingsDb().prepare(`UPDATE codex_chat_threads SET summary = ?, summary_until_message_id = ?,
    summary_updated_date = CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END, context_revision = context_revision + ? WHERE id = ?`)
    .run(renderSummary(segments) || null, until, until, bump ? 1 : 0, threadId)
}

function revisionMatches(threadId: number, expectedRevision: number) {
  const row = getUserSettingsDb().prepare('SELECT context_revision FROM codex_chat_threads WHERE id = ?').get(threadId) as { context_revision: number } | undefined
  return row?.context_revision === expectedRevision
}

export const ChatSummaryStore = {
  list: listSegments,

  /** Add the summary of messages from..until, unless the history changed since `expectedRevision` was read. */
  addSegment(threadId: number, segment: { from: number; until: number; content: string }, expectedRevision: number) {
    const db = getUserSettingsDb()
    return db.transaction(() => {
      if (!revisionMatches(threadId, expectedRevision)) return false
      db.prepare('INSERT INTO chat_summary_segments (thread_id, level, from_message_id, until_message_id, content) VALUES (?, 0, ?, ?, ?)')
        .run(threadId, segment.from, segment.until, segment.content)
      syncThreadSummary(threadId)
      return true
    }).immediate()
  },

  /**
   * Replace the plot with one that now covers everything up to `until`, under the same revision check. It is backed
   * by level-0 rows only if the plot it replaces was (a first plot always is: it is folded from them).
   */
  setPlot(threadId: number, plot: { from: number; until: number; content: string }, expectedRevision: number) {
    const db = getUserSettingsDb()
    return db.transaction(() => {
      if (!revisionMatches(threadId, expectedRevision)) return false
      const previous = db.prepare('SELECT backed FROM chat_summary_segments WHERE thread_id = ? AND level = 1').get(threadId) as { backed: number } | undefined
      db.prepare('DELETE FROM chat_summary_segments WHERE thread_id = ? AND level = 1').run(threadId)
      db.prepare('INSERT INTO chat_summary_segments (thread_id, level, from_message_id, until_message_id, content, backed) VALUES (?, 1, ?, ?, ?, ?)')
        .run(threadId, plot.from, plot.until, plot.content, previous && !previous.backed ? 0 : 1)
      syncThreadSummary(threadId)
      return true
    }).immediate()
  },

  /** A hand edit of one segment's text; empty text is refused (clear the whole summary instead). */
  editSegment(threadId: number, segmentId: number, content: string) {
    const db = getUserSettingsDb()
    return db.transaction(() => {
      const changed = db.prepare('UPDATE chat_summary_segments SET content = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ? AND thread_id = ?').run(content, segmentId, threadId).changes > 0
      if (changed) syncThreadSummary(threadId, false)
      return changed
    }).immediate()
  },

  /**
   * The whole summary as one hand-written plot up to `until` — null or 0: a note ahead of every message, which leaves
   * them all in the request — or, with null text, no summary at all. Also clears a stale failure.
   */
  replaceAll(threadId: number, content: string | null, until: number | null) {
    const db = getUserSettingsDb()
    db.transaction(() => {
      db.prepare('DELETE FROM chat_summary_segments WHERE thread_id = ?').run(threadId)
      if (content) {
        const first = db.prepare('SELECT MIN(id) AS id FROM codex_chat_messages WHERE thread_id = ?').get(threadId) as { id: number | null }
        db.prepare('INSERT INTO chat_summary_segments (thread_id, level, from_message_id, until_message_id, content, backed) VALUES (?, 1, ?, ?, ?, 0)')
          .run(threadId, until ? first.id ?? 0 : 0, until ?? 0, content)
      }
      syncThreadSummary(threadId)
      db.prepare('UPDATE codex_chat_threads SET summary_error = NULL WHERE id = ?').run(threadId)
    }).immediate()
  },

  /**
   * History changed at `messageId`: every segment that reaches it is dropped. So is the plot when it does: a backed
   * plot's older stretches stay and are folded again; an unbacked plot has nothing beneath it, so everything starts
   * over from the first message. Runs inside the caller's transaction.
   */
  invalidateFrom(threadId: number, messageId: number) {
    const db = getUserSettingsDb()
    const plot = db.prepare('SELECT until_message_id, backed FROM chat_summary_segments WHERE thread_id = ? AND level = 1').get(threadId) as { until_message_id: number; backed: number } | undefined
    const removed = plot && !plot.backed && plot.until_message_id >= messageId
      ? db.prepare('DELETE FROM chat_summary_segments WHERE thread_id = ?').run(threadId).changes
      : db.prepare('DELETE FROM chat_summary_segments WHERE thread_id = ? AND until_message_id >= ?').run(threadId, messageId).changes
    if (removed > 0) syncThreadSummary(threadId)
  },

  clear(threadId: number) {
    getUserSettingsDb().prepare('DELETE FROM chat_summary_segments WHERE thread_id = ?').run(threadId)
  },
}

// ---- Recall ---------------------------------------------------------------------------------------------------

/**
 * Terms for matching Korean without a tokenizer: character bigrams of every word (so `약속을` and `약속` share `약속`),
 * whole words for Latin text (3+ letters), numbers as they are.
 */
export function recallTerms(text: string) {
  const terms = new Set<string>()
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/^[a-z]+$/.test(word)) {
      if (word.length >= 3) terms.add(word)
    } else if (/^\p{N}+$/u.test(word)) {
      if (word.length >= 2) terms.add(word)
    } else {
      const chars = [...word]
      for (let index = 0; index + 1 < chars.length; index += 1) terms.add(chars[index] + chars[index + 1])
    }
  }
  return terms
}

/** Fewer shared terms than this is chance, not the same subject. */
const MIN_SHARED_TERMS = 3
/** Terms found in more than this share of the candidates say nothing about which one is meant. */
const COMMON_TERM_SHARE = 0.6

/**
 * The folded segments the latest messages (`query`) are about, best first, within `budgetTokens`. Scored by the rare
 * terms they share with the query (inverse document frequency over the candidates), so stock phrases do not count.
 */
export function selectRecall(candidates: ChatSummarySegment[], query: string, budgetTokens: number, estimate: (text: string) => number, limit = 3) {
  if (candidates.length === 0 || budgetTokens <= 0) return []
  const queryTerms = recallTerms(query)
  if (queryTerms.size === 0) return []
  const documents = candidates.map((segment) => ({ segment, terms: recallTerms(segment.content) }))
  const frequency = new Map<string, number>()
  for (const term of queryTerms) frequency.set(term, documents.filter((document) => document.terms.has(term)).length)
  const scored = documents.flatMap(({ segment, terms }) => {
    let shared = 0
    let score = 0
    for (const term of queryTerms) {
      if (!terms.has(term)) continue
      const count = frequency.get(term) ?? 0
      if (candidates.length >= 5 && count / candidates.length > COMMON_TERM_SHARE) continue
      shared += 1
      score += Math.log(1 + (candidates.length - count + 0.5) / (count + 0.5))
    }
    return shared >= MIN_SHARED_TERMS ? [{ segment, score }] : []
  }).sort((a, b) => b.score - a.score || b.segment.until_message_id - a.segment.until_message_id)
  const chosen: ChatSummarySegment[] = []
  let remaining = budgetTokens
  for (const { segment } of scored) {
    if (chosen.length >= limit) break
    const cost = estimate(segment.content)
    if (cost > remaining) continue
    chosen.push(segment)
    remaining -= cost
  }
  // Told in the order they happened.
  return chosen.sort((a, b) => a.until_message_id - b.until_message_id)
}

export function recallText(segments: ChatSummarySegment[]) {
  return segments.length > 0 ? `## 관련된 지난 일\n${segments.map((segment) => segment.content.trim()).join('\n\n')}` : ''
}
