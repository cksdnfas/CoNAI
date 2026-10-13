import { vectorStore } from '../vectors/vectorStore'
import { getUserSettingsDb, semanticTextHash } from '../../database/userSettingsDb'
import {
  EMBEDDING_MODEL_KEY,
  embedQueries,
  embeddingFeatureOn,
  embeddingModelWarm,
} from '../aiWorker/textEmbeddingService'
import { booksForRequest, keyedLoreEntries } from '../codex-chat/chatLoreContext'
import type { ChatProfile } from '../codex-chat/chatProfiles'
import type { CodexChatMessageRecord, CodexChatThreadRecord } from '../codex-chat/codexChatStore'
import { indexLoreNow, indexSegmentsNow, indexMessagesNow, loreEntryDocument, loreEntryEmbeddable, loreEntryVectorKey } from './semanticIndex'
import { SEMANTIC_SPACES, standouts } from './rankFusion'

/**
 * Meaning-based context for one reply: how close each past episode and each keyword lore entry is to the latest
 * exchange. Computed before the judge and the request builder (which are synchronous), handed to both:
 *   - recall ranks episodes by shared rare words and by meaning together (selectRecall)
 *   - lore: without a judge deciding lore, the few entries clearly about the exchange come in as if a keyword
 *     matched; with one, they join the judge's candidates instead
 * Items count by their lead over the other candidates (see standouts). Null when embeddings are off, unavailable,
 * or too slow.
 */

export type SemanticContext = {
  /** Summary segment id → closeness to the latest exchange (only segments clearly ahead of the rest). */
  recall: ReadonlyMap<number, number>
  /** Every embedded segment of the chat → closeness (what `recall` was picked from). */
  recallScores: ReadonlyMap<number, number>
  /** Lore entry key (loreEntryKey) → closeness, for every embedded keyword entry of the request's books. */
  loreScores: ReadonlyMap<string, number>
  /** Lore entries meaning brings in (when the judge does not decide lore). */
  loreKeys: ReadonlySet<string>
  /** Session engines have no CoNAI summary: recall a few older, active-path messages instead. */
  messages?: Array<{ id: number; role: string; text: string }>
}

/** Recent messages that make the query: the latest exchange, each cut to its last part. */
const QUERY_MESSAGES = 2
const QUERY_MESSAGE_CHARS = 600
/**
 * Weight of the latest message against the one before. Embedded together, the earlier message drowns out a change
 * of subject; apart and weighted, a new subject leads while a bare "go on" still borrows the previous one's.
 */
const LATEST_WEIGHT = 0.7
/**
 * Waiting for the query vector: a warm model answers in well under this, even behind the one background batch the
 * worker may be running (it cannot be interrupted); a cold one is left to warm up.
 */
const WARM_WAIT_MS = 4000
const COLD_WAIT_MS = 300

/** Floors at 768 dims (scores run ~0.02 below 256 dims; calibrated on the lore/recall test set). */
const RECALL_MIN_SCORE = 0.64
const RECALL_MIN_LEAD = 0.06
const LORE_MIN_SCORE = 0.66
const LORE_MIN_LEAD = 0.09
/** Entries brought in by meaning per reply; a second one only when nearly as close as the first. */
const LORE_MAX_AUTO = 2
const LORE_SECOND_WITHIN = 0.02
/** Lore entries embedded on the spot when a reply finds them missing (the rest is left to the background pass). */
const LORE_INDEX_NOW = 16
const SEGMENTS_INDEX_NOW = 8

/** The query texts, oldest first: the latest exchange, each message cut to its last part. */
export function queryTextsOf(messages: ReadonlyArray<Pick<CodexChatMessageRecord, 'content'>>) {
  return messages
    .filter((message) => message.content.trim())
    .slice(-QUERY_MESSAGES)
    .map((message) => {
      const text = message.content.trim()
      return text.length > QUERY_MESSAGE_CHARS ? text.slice(-QUERY_MESSAGE_CHARS) : text
    })
}

/** Closeness per source under the weighted queries (best chunk per source and query). */
function weightedScores(space: string, queries: Float32Array[], filter: { ownerKeys?: string[]; sourceKeys?: string[] }) {
  const weights = queries.length > 1 ? [1 - LATEST_WEIGHT, LATEST_WEIGHT] : [1]
  const scores = new Map<string, { score: number; contentHash: string | null; spanStart?: number | null }>()
  queries.forEach((query, index) => {
    for (const [sourceKey, { score, contentHash, spanStart }] of bestPerSource(vectorStore.search(space, EMBEDDING_MODEL_KEY, query, filter))) {
      const known = scores.get(sourceKey)
      scores.set(sourceKey, { score: (known?.score ?? 0) + weights[index] * score, contentHash, spanStart })
    }
  })
  return scores
}

/** Best chunk score per source, from search hits (several chunks of one source each come back). */
function bestPerSource(hits: Array<{ sourceKey: string; score: number; contentHash: string | null; spanStart?: number | null }>) {
  const best = new Map<string, { score: number; contentHash: string | null; spanStart?: number | null }>()
  for (const hit of hits) {
    const known = best.get(hit.sourceKey)
    if (!known || hit.score > known.score) best.set(hit.sourceKey, { score: hit.score, contentHash: hit.contentHash, spanStart: hit.spanStart })
  }
  return best
}

export async function semanticContextFor(params: {
  profile: ChatProfile
  thread: CodexChatThreadRecord
  messages: CodexChatMessageRecord[]
  /** The profile's judge answers lore questions: meaning only proposes candidates. */
  judgeDecidesLore: boolean
  signal?: AbortSignal
}): Promise<SemanticContext | null> {
  const recallOn = embeddingFeatureOn('chatRecall')
  const session = params.profile.engine === 'codex' || params.profile.engine === 'claude' || params.profile.llmRuntime === 'pi'
  const loreOn = embeddingFeatureOn('lorebook')
  if (!recallOn && !loreOn) return null
  const texts = queryTextsOf(params.messages)
  if (texts.length === 0) return null

  const books = loreOn ? booksForRequest({ thread: params.thread, profile: params.profile }) : []
  const entries = keyedLoreEntries(books).filter((item) => item.bookId !== undefined && loreEntryEmbeddable(item.entry))
  const warm = embeddingModelWarm()
  const pendingQueries = embedQueries(texts, { waitMs: warm ? WARM_WAIT_MS : COLD_WAIT_MS, signal: params.signal })
  if (warm && !params.signal?.aborted) {
    // Missing vectors are made at normal priority, queued after the query (an idle worker would otherwise start on
    // them first); they serve the next reply.
    if (loreOn && entries.length) void indexLoreNow(new Set(entries.map((item) => item.bookId!)), LORE_INDEX_NOW).catch(() => undefined)
    if (recallOn) void indexSegmentsNow(params.thread.id, SEGMENTS_INDEX_NOW).catch(() => undefined)
    if (recallOn && session) void indexMessagesNow([params.thread.id], SEGMENTS_INDEX_NOW).catch(() => undefined)
  }
  const queries = await pendingQueries
  if (!queries) return null

  const recallScores = new Map<number, number>()
  if (recallOn) {
    const current = getUserSettingsDb().prepare('SELECT id, semantic_text_hash(content) AS hash FROM chat_summary_segments WHERE thread_id = ? AND level = 0').all(params.thread.id) as Array<{ id: number; hash: string }>
    const hashes = new Map(current.map(row => [String(row.id), row.hash]))
    for (const [sourceKey, { score, contentHash }] of weightedScores(SEMANTIC_SPACES.recall, queries, { ownerKeys: [`thread:${params.thread.id}`] })) {
      if (hashes.get(sourceKey) === contentHash) recallScores.set(Number(sourceKey), score)
    }
  }

  const loreScores = new Map<string, number>()
  if (loreOn && entries.length) {
    const byVectorKey = new Map(entries.map((item) => [loreEntryVectorKey(item.bookId!, item.entry.id), item]))
    for (const [sourceKey, { score, contentHash }] of weightedScores(SEMANTIC_SPACES.lore, queries, { sourceKeys: [...byVectorKey.keys()] })) {
      const item = byVectorKey.get(sourceKey)
      // A vector of an older version of the entry says nothing about the current text.
      if (item && contentHash === loreEntryDocument(item.entry).hash) loreScores.set(item.key, score)
    }
  }

  const recall = new Map(standouts(recallScores, RECALL_MIN_SCORE, RECALL_MIN_LEAD))
  const loreKeys = new Set<string>()
  if (!params.judgeDecidesLore) {
    const picked = standouts(loreScores, LORE_MIN_SCORE, LORE_MIN_LEAD)
    for (const [key, score] of picked) {
      if (loreKeys.size >= LORE_MAX_AUTO || (loreKeys.size > 0 && picked[0][1] - score > LORE_SECOND_WITHIN)) break
      loreKeys.add(key)
    }
  }
  const messages: NonNullable<SemanticContext['messages']> = []
  if (recallOn && session) {
    // Intersect stored vectors with the active conversation; never resurrect deleted or alternate-branch messages.
    const eligible = new Map(params.messages.slice(0, -4).filter(message => message.role === 'user' || message.role === 'assistant').map(message => [String(message.id), message]))
    const scores = new Map<string, number>()
    const starts = new Map<string, number>()
    for (const [key, hit] of weightedScores(SEMANTIC_SPACES.message, queries, { ownerKeys: [`thread:${params.thread.id}`], sourceKeys: [...eligible.keys()] })) {
      const message = eligible.get(key)
      if (message) {
        const fingerprint = semanticTextHash(message.content)
        if (hit.contentHash === fingerprint) {
          scores.set(key, hit.score)
          starts.set(key, hit.spanStart ?? 0)
        }
      }
    }
    for (const [key] of standouts(scores, RECALL_MIN_SCORE, RECALL_MIN_LEAD).slice(0, 2)) {
      const message = eligible.get(key)!
      const start = starts.get(key) ?? 0
      messages.push({ id: message.id, role: message.role, text: message.content.slice(start, start + 1200) })
    }
  }
  return { recall, recallScores, loreScores, loreKeys, messages }
}

/** Lore entries worth asking the judge about by meaning: a small lead over the rest is enough, the judge reads them. */
export function semanticLoreCandidates(semantic: SemanticContext | null | undefined, limit: number) {
  if (!semantic || semantic.loreScores.size === 0) return []
  return standouts(semantic.loreScores, 0, 0.03).slice(0, limit).map(([key]) => key)
}
