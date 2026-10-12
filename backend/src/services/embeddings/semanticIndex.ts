import { createHash } from 'crypto'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { vectorStore } from '../vectors/vectorStore'
import type { EmbeddingSettings } from '@conai/shared'
import {
  EMBEDDING_MODEL_KEY,
  embedTexts,
  embeddingFailure,
  embeddingFeatureOn,
  embeddingRuntime,
  embeddingSettings,
  embeddingVariant,
  textWorker,
  warmEmbeddingModel,
  type EmbeddedChunk,
  type EmbeddingFeature,
} from '../aiWorker/textEmbeddingService'
import { loreEntryKeys, loreEntryTitle, normalizeLorebook, type ChatLoreEntry } from '../codex-chat/chatLorebook'
import { FILE_REVISION, queueFileSearchRefresh, readCachedFileBytes, startFileSearchMaintenance, stopFileSearchMaintenance } from '../fileStoreSearch'
import { FileStoreService } from '../fileStoreService'
import { SEMANTIC_SPACES } from './rankFusion'
import { indexPendingImages, pruneImageVectors } from './imageIndex'
import { onSemanticChange, type SemanticSource } from './semanticSignal'

/**
 * What text embeddings are kept for, one vector space each (vectors.db; derived data, rebuilt when missing):
 *   chat-recall   level-0 summary segments          source `<segment id>`, owner `thread:<id>`
 *   chat-lore     enabled keyword lore entries       source `<book id>:<entry id>`, owner `book:<id>`
 *   chat-message  messages of chats that share knowledge (rooms, chats with books or linked files)
 *                                                    source `<message id>`, owner `thread:<id>`
 *   file          file store text (minutes too)      source `<entry id>`, owner `<file owner key>`
 * and, with image search on, `media-image` (imageIndex.ts): library still images by composite hash.
 * A background pass embeds what is new or changed (content fingerprints), a few items per worker request at low
 * priority so chat queries go first, and drops vectors whose source is gone. Stores signal changes (semanticSignal):
 * a pass then looks only at the sources that changed; a slow idle pass looks at everything, as a safety net.
 */

export { SEMANTIC_SPACES }

/** Text up to this many characters is one vector; longer text is split into token windows. */
const SINGLE_CHUNK_CHARS = 1500
const CHUNK_TOKENS = 512
const OVERLAP_TOKENS = 64
/** Items per worker request: a chat query waits at most for one batch. */
const BATCH_ITEMS = 8
/** Token windows of one long document per request (each up to CHUNK_TOKENS, so fewer than short items). */
const CHUNK_BATCH = 4
const MESSAGE_MAX_CHARS = 6000
const MESSAGE_MAX_CHUNKS = 4
const LORE_MAX_CHARS = 4000

/** Changes signal the indexer; this slow pass over every source only catches what no signal reported. */
const IDLE_SWEEP_MS = 15 * 60_000
const BUSY_SWEEP_MS = 500
const FIRST_SWEEP_MS = 60_000
/** After a failed pass (not an embedding failure, which has its own rest). */
const ERROR_SWEEP_MS = 60_000
/** How soon a change is looked at: a chat message is searched with on-the-spot indexing anyway, so it can wait. */
const SIGNAL_DELAY_MS: Record<SemanticSource, number> = { recall: 2_000, lore: 2_000, file: 5_000, image: 10_000, message: 60_000 }
/** Items one scan queues: a backlog is scanned once per this many, not once per batch. */
const QUEUE_ITEMS = 64
const PRUNE_EVERY_MS = 60 * 60_000

/** Full-content fingerprint also catches same-length edits in the middle of a message. */
const fingerprint = (column: string) => `semantic_text_hash(${column})`

export function loreEntryVectorKey(bookId: number, entryId: string) {
  return `${bookId}:${entryId}`
}

/** What a lore entry is embedded from, and its fingerprint. */
export function loreEntryDocument(entry: Pick<ChatLoreEntry, 'title' | 'keys' | 'content'> & { localKeys?: string[] }) {
  const keys = loreEntryKeys(entry).filter((key) => !/^\/.*\/[a-z]*$/i.test(key))
  const text = [keys.length ? keys.join(', ') : '', entry.content.slice(0, LORE_MAX_CHARS)].filter(Boolean).join('\n')
  const title = loreEntryTitle(entry)
  return { title, text, hash: createHash('sha1').update(`${title}\u0000${text}`).digest('hex').slice(0, 16) }
}

/** Whether a lore entry is one meaning can bring in (keyword entries with content; "always on" ones are in anyway). */
export function loreEntryEmbeddable(entry: ChatLoreEntry) {
  return entry.enabled && !entry.constant && entry.content.trim().length > 0
}

/**
 * Embed one document: one vector for short text, else the tokenizer's windows (at most `maxChunks`), a few per
 * request. Spans are character offsets into `text`.
 */
export async function embedDocument(text: string, title: string | null, maxChunks: number, priority: 'normal' | 'low' = 'low'): Promise<EmbeddedChunk[]> {
  if (text.length <= SINGLE_CHUNK_CHARS) {
    return (await embedTexts([{ text, title }], 'document', { priority }))[0] ?? []
  }
  const reply = await textWorker.request<{ items: Array<Array<{ start: number; end: number }>> }>('chunk', {
    texts: [text], chunkTokens: CHUNK_TOKENS, overlapTokens: OVERLAP_TOKENS, maxChunks, device: 'cpu', variant: embeddingVariant(),
  }, { priority })
  const spans = jsSpans(text, reply.items[0] ?? [])
  const chunks: EmbeddedChunk[] = []
  for (let start = 0; start < spans.length; start += CHUNK_BATCH) {
    const batch = spans.slice(start, start + CHUNK_BATCH)
    const vectors = await embedTexts(batch.map((span) => ({ text: text.slice(span.start, span.end), title })), 'document', { priority })
    batch.forEach((span, index) => {
      const vector = vectors[index]?.[0]?.vector
      if (vector) chunks.push({ start: span.start, end: span.end, vector })
    })
  }
  return chunks
}

type IndexItem = { space: string; sourceKey: string; ownerKey: string; hash: string; text: string; title: string | null; maxChunks: number; fileBytes?: number }

/** Embed and store items: short ones several per request, long ones split. */
async function indexItems(items: IndexItem[], priority: 'normal' | 'low' = 'low') {
  for (const item of items.filter((candidate) => candidate.space === SEMANTIC_SPACES.file)) await indexFileBatch(item, priority)
  const short = items.filter((item) => item.space !== SEMANTIC_SPACES.file && item.text.length <= SINGLE_CHUNK_CHARS)
  for (let start = 0; start < short.length; start += BATCH_ITEMS) {
    const batch = short.slice(start, start + BATCH_ITEMS)
    const vectors = await embedTexts(batch.map((item) => ({ text: item.text, title: item.title })), 'document', { priority })
    batch.forEach((item, index) => store(item, vectors[index] ?? []))
  }
  for (const item of items.filter((candidate) => candidate.space !== SEMANTIC_SPACES.file && candidate.text.length > SINGLE_CHUNK_CHARS)) {
    store(item, await embedDocument(item.text, item.title, item.maxChunks, priority))
  }
  return items.length
}

/** Python tokenizer offsets count Unicode code points; JavaScript strings count UTF-16 code units. */
function jsSpans(text: string, spans: Array<{ start: number; end: number }>) {
  if (!/[\uD800-\uDBFF]/.test(text)) return spans
  const positions = [0]
  for (const char of text) positions.push(positions[positions.length - 1] + char.length)
  return spans.map(span => ({ start: positions[span.start], end: positions[span.end] }))
}

/** Four chunks per pass, persisted before yielding to other work. A restart resumes the same revision. */
async function indexFileBatch(item: IndexItem, priority: 'normal' | 'low') {
  const db = getUserSettingsDb()
  const saved = db.prepare('SELECT * FROM vector_db.file_progress WHERE source_key = ?').get(item.sourceKey) as
    { revision: string; model_key: string; next_offset: number; next_chunk: number } | undefined
  const resume = saved?.revision === item.hash && saved.model_key === EMBEDDING_MODEL_KEY ? saved : null
  const offset = resume?.next_offset ?? 0
  const chunk = resume?.next_chunk ?? 0
  const buffer = readCachedFileBytes(item.ownerKey, item.sourceKey, offset, 64000)
  let validEnd = buffer.length
  if (offset + validEnd < item.fileBytes!) {
    while (validEnd > 0 && (buffer[validEnd - 1] & 0xc0) === 0x80) validEnd--
    if (validEnd > 0) validEnd-- // Exclude the possibly incomplete final UTF-8 code point.
  }
  let text = buffer.subarray(0, validEnd).toString('utf8').slice(0, 16000)
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1)
  const reply = await textWorker.request<{ items: Array<Array<{ start: number; end: number }>> }>('chunk', {
    texts: [text], chunkTokens: CHUNK_TOKENS, overlapTokens: OVERLAP_TOKENS, maxChunks: CHUNK_BATCH + 1,
    device: 'cpu', variant: embeddingVariant(),
  }, { priority })
  const spans = jsSpans(text, reply.items[0] ?? [])
  const batch = spans.slice(0, CHUNK_BATCH)
  if (!batch.length || batch.some(span => !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.end <= span.start || span.end > text.length)) throw new Error('Invalid file chunk boundaries')
  const vectors = await embedTexts(batch.map(span => ({ text: text.slice(span.start, span.end), title: item.title })), 'document', { priority })
  if (vectors.length !== batch.length || vectors.some(parts => !parts[0])) throw new Error('Incomplete file embedding batch')
  const byteAt = (position: number) => offset + Buffer.byteLength(text.slice(0, position), 'utf8')
  const end = byteAt(batch[batch.length - 1].end)
  const complete = end >= item.fileBytes!
  let nextChar = spans[CHUNK_BATCH]?.start ?? Math.max(1, batch[batch.length - 1].end - 256)
  if (/[\uDC00-\uDFFF]/.test(text[nextChar] ?? '')) nextChar++
  const next = complete ? end : byteAt(nextChar)
  if (!complete && next <= offset) throw new Error('File embedding cursor did not advance')
  // Recheck after awaiting the worker: a rename, write or deletion makes this batch obsolete.
  const current = db.prepare(`SELECT (t.revision || ':' || t.content_hash) AS revision FROM stored_file_entries e JOIN search_db.search_documents t ON t.source = 'file' AND t.source_id = e.id
    WHERE e.id = ? AND e.owner_key = ? AND e.deleted_at IS NULL AND t.revision = ${FILE_REVISION}`).get(item.sourceKey, item.ownerKey) as { revision: string } | undefined
  if (current?.revision !== item.hash) return
  vectorStore.appendFileBatch(item.sourceKey, EMBEDDING_MODEL_KEY, item.ownerKey, item.hash,
    batch.map((span, index) => ({ vector: vectors[index][0].vector, chunk: chunk + index, start: byteAt(span.start), end: byteAt(span.end) })),
    { offset: next, chunk: chunk + batch.length, complete })
}

function store(item: IndexItem, chunks: EmbeddedChunk[]) {
  if (chunks.length === 0) return
  const whole = chunks.length === 1 && chunks[0].start === 0 && chunks[0].end >= item.text.length
  vectorStore.replace(item.space, item.sourceKey, EMBEDDING_MODEL_KEY, chunks.map((chunk, index) => ({
    vector: chunk.vector, chunk: index, ownerKey: item.ownerKey, contentHash: item.hash,
    ...(whole ? {} : { start: chunk.start, end: chunk.end }),
  })))
}

// ---- What is missing ------------------------------------------------------------------------------------------

function pendingSegments(limit: number, threadId?: number): IndexItem[] {
  const rows = getUserSettingsDb().prepare(`SELECT s.id, s.thread_id, s.content, ${fingerprint('s.content')} AS fp
    FROM chat_summary_segments s
    LEFT JOIN vector_db.vectors v ON v.space = @space AND v.source_key = CAST(s.id AS TEXT) AND v.chunk = 0 AND v.model_key = @model
    WHERE s.level = 0 AND trim(s.content) != '' ${threadId === undefined ? '' : 'AND s.thread_id = @thread'}
      AND (v.source_key IS NULL OR v.content_hash IS NOT ${fingerprint('s.content')})
    ORDER BY s.id DESC LIMIT @limit`).all({ space: SEMANTIC_SPACES.recall, model: EMBEDDING_MODEL_KEY, limit, ...(threadId === undefined ? {} : { thread: threadId }) }) as Array<{ id: number; thread_id: number; content: string; fp: string }>
  return rows.map((row) => ({ space: SEMANTIC_SPACES.recall, sourceKey: String(row.id), ownerKey: `thread:${row.thread_id}`, hash: row.fp, text: row.content.trim(), title: null, maxChunks: 8 }))
}

/** Chats whose history the characters can search (see sharesKnowledge): rooms, and chats with books or linked files. */
function historyThreadIds(): number[] {
  const linked = (column: string) => `(${column} IS NOT NULL AND ${column} != '[]')`
  const settings = embeddingSettings()
  const session = "(p.engine IN ('codex', 'claude') OR p.llm_runtime = 'pi' OR t.engine = 'codex')"
  return (getUserSettingsDb().prepare(`SELECT t.id FROM codex_chat_threads t LEFT JOIN llm_chat_profiles p ON p.id = t.profile_id
    WHERE (${Number(settings.chatHistory)} AND (t.kind = 'group' OR ${session} OR ${linked('t.lorebook_ids')} OR ${linked('t.linked_files')} OR ${linked('p.lorebook_ids')} OR ${linked('p.linked_files')}))
      OR (${Number(settings.chatRecall)} AND ${session})`)
    .all() as Array<{ id: number }>).map((row) => row.id)
}

function pendingMessages(limit: number, threadIds = historyThreadIds()): IndexItem[] {
  if (threadIds.length === 0) return []
  const rows = getUserSettingsDb().prepare(`SELECT m.id, m.thread_id, m.content, ${fingerprint('m.content')} AS fp
    FROM codex_chat_messages m
    LEFT JOIN vector_db.vectors v ON v.space = @space AND v.source_key = CAST(m.id AS TEXT) AND v.chunk = 0 AND v.model_key = @model
    WHERE m.thread_id IN (${threadIds.map(Number).join(', ')}) AND m.role IN ('user', 'assistant') AND trim(m.content) != ''
      AND (v.source_key IS NULL OR v.content_hash IS NOT ${fingerprint('m.content')})
    ORDER BY m.id DESC LIMIT @limit`).all({ space: SEMANTIC_SPACES.message, model: EMBEDDING_MODEL_KEY, limit }) as Array<{ id: number; thread_id: number; content: string; fp: string }>
  return rows.map((row) => ({ space: SEMANTIC_SPACES.message, sourceKey: String(row.id), ownerKey: `thread:${row.thread_id}`, hash: row.fp, text: row.content.slice(0, MESSAGE_MAX_CHARS), title: null, maxChunks: MESSAGE_MAX_CHUNKS }))
}

/** Every book's cached entries (account and chat books cache theirs from lorebook.json). */
function allLoreEntries() {
  const rows = getUserSettingsDb().prepare('SELECT id, entries FROM chat_lorebooks').all() as Array<{ id: number; entries: string }>
  return rows.flatMap((row) => normalizeLorebook(row.entries).filter(loreEntryEmbeddable).map((entry) => ({ bookId: row.id, entry })))
}

function pendingLore(limit: number, bookIds?: ReadonlySet<number>): IndexItem[] {
  const known = vectorStore.contentHashes(SEMANTIC_SPACES.lore, EMBEDDING_MODEL_KEY)
  const items: IndexItem[] = []
  for (const { bookId, entry } of allLoreEntries()) {
    if (bookIds && !bookIds.has(bookId)) continue
    const sourceKey = loreEntryVectorKey(bookId, entry.id)
    const document = loreEntryDocument(entry)
    if (known.get(sourceKey) === document.hash) continue
    items.push({ space: SEMANTIC_SPACES.lore, sourceKey, ownerKey: `book:${bookId}`, hash: document.hash, text: document.text, title: document.title, maxChunks: 4 })
    if (items.length >= limit) break
  }
  return items
}

async function pendingFiles(limit: number): Promise<IndexItem[]> {
  const db = getUserSettingsDb()
  const owners = (db.prepare("SELECT DISTINCT owner_key FROM stored_file_entries WHERE kind = 'file' AND deleted_at IS NULL").all() as Array<{ owner_key: string }>).map((row) => row.owner_key)
  // Extraction progresses independently. Already extracted documents need not wait for the backlog.
  for (const owner of owners) queueFileSearchRefresh(owner)
  const rows = db.prepare(`SELECT e.id, e.owner_key, e.name, t.body_bytes, (t.revision || ':' || t.content_hash) AS revision
    FROM stored_file_entries e
    JOIN search_db.search_documents t ON t.source = 'file' AND t.source_id = e.id
    LEFT JOIN vector_db.file_progress p ON p.source_key = e.id
    WHERE e.kind = 'file' AND e.deleted_at IS NULL AND t.revision = ${FILE_REVISION} AND t.extraction_state IN ('ready', 'partial') AND t.body_bytes > 0
      AND (p.source_key IS NULL OR p.revision IS NOT (t.revision || ':' || t.content_hash) OR p.model_key != @model OR p.complete = 0)
    ORDER BY COALESCE(p.updated_at, 0), e.id LIMIT @limit`).all({ model: EMBEDDING_MODEL_KEY, limit }) as Array<{ id: string; owner_key: string; name: string; body_bytes: number; revision: string }>
  return rows.map((row) => ({ space: SEMANTIC_SPACES.file, sourceKey: row.id, ownerKey: row.owner_key, hash: row.revision, text: '', fileBytes: row.body_bytes, title: row.name, maxChunks: CHUNK_BATCH }))
}

/** Vectors whose source is gone (or out of scope), and those of another model. */
function pruneVectors() {
  const db = getUserSettingsDb()
  db.prepare(`DELETE FROM vector_db.file_progress WHERE NOT EXISTS (SELECT 1 FROM stored_file_entries e WHERE e.id = source_key AND e.deleted_at IS NULL)`).run()
  for (const space of Object.values(SEMANTIC_SPACES)) vectorStore.pruneOtherModels(space, EMBEDDING_MODEL_KEY)
  let removed = 0
  removed += db.prepare(`DELETE FROM vector_db.vectors WHERE space = ? AND NOT EXISTS (
    SELECT 1 FROM chat_summary_segments s WHERE s.id = CAST(vector_db.vectors.source_key AS INTEGER) AND s.level = 0)`).run(SEMANTIC_SPACES.recall).changes
  const threads = historyThreadIds()
  removed += db.prepare(`DELETE FROM vector_db.vectors WHERE space = ? AND (NOT EXISTS (
    SELECT 1 FROM codex_chat_messages m WHERE m.id = CAST(vector_db.vectors.source_key AS INTEGER))
    OR owner_key NOT IN (${threads.length ? threads.map((id) => `'thread:${Number(id)}'`).join(', ') : "''"}))`).run(SEMANTIC_SPACES.message).changes
  removed += db.prepare(`DELETE FROM vector_db.vectors WHERE space = ? AND NOT EXISTS (
    SELECT 1 FROM stored_file_entries e WHERE e.id = vector_db.vectors.source_key AND e.deleted_at IS NULL)`).run(SEMANTIC_SPACES.file).changes
  const lore = new Set(allLoreEntries().map(({ bookId, entry }) => loreEntryVectorKey(bookId, entry.id)))
  for (const sourceKey of vectorStore.contentHashes(SEMANTIC_SPACES.lore, EMBEDDING_MODEL_KEY).keys()) {
    if (!lore.has(sourceKey)) removed += vectorStore.remove(SEMANTIC_SPACES.lore, sourceKey)
  }
  if (removed > 0) vectorStore.invalidateAll()
  return removed
}

/// ---- Background pass ------------------------------------------------------------------------------------------

type TextSource = {
  source: Exclude<SemanticSource, 'image'>
  feature: EmbeddingFeature
  /** What is missing, at most `limit` items, most useful first. */
  pending: (limit: number) => IndexItem[] | Promise<IndexItem[]>
  /** Items one scan takes, and items embedded per pass. */
  scan: number
  batch: number
}

/** Most useful first: what the next reply recalls, then lore, then searchable history and files; images last. */
const TEXT_SOURCES: TextSource[] = [
  { source: 'recall', feature: 'chatRecall', pending: (limit) => pendingSegments(limit), scan: QUEUE_ITEMS, batch: BATCH_ITEMS },
  { source: 'lore', feature: 'lorebook', pending: (limit) => pendingLore(limit), scan: QUEUE_ITEMS, batch: BATCH_ITEMS },
  { source: 'message', feature: 'chatHistory', pending: (limit) => pendingMessages(limit), scan: QUEUE_ITEMS, batch: BATCH_ITEMS },
  // Files persist four chunks and their resume cursor per pass.
  { source: 'file', feature: 'fileSearch', pending: pendingFiles, scan: 2, batch: 1 },
]
const ALL_SOURCES: SemanticSource[] = ['recall', 'lore', 'message', 'file', 'image']

function sourceOn(settings: EmbeddingSettings, source: SemanticSource) {
  if (source === 'image') return settings.imageSearch
  if (source === 'message') return settings.chatHistory || settings.chatRecall
  return settings[TEXT_SOURCES.find((entry) => entry.source === source)!.feature]
}

/** Whether a queued item got its current vector meanwhile (a chat turn or search embedded it on the spot). */
function alreadyEmbedded(item: IndexItem) {
  if (item.space === SEMANTIC_SPACES.file) return false
  return vectorStore.contentHash(item.space, item.sourceKey, EMBEDDING_MODEL_KEY) === item.hash
}

class SemanticIndexer {
  private timer: NodeJS.Timeout | null = null
  private timerAt = 0
  private timerFull = false
  private running: Promise<void> | null = null
  private started = false
  private busy = false
  private stopped = false
  /** Sources that may have work: everything at first and on each idle pass, then what changes signal. */
  private dirty = new Set<SemanticSource>(ALL_SOURCES)
  /** The rest of the last scan, embedded a batch per pass before anything is scanned again. */
  private queue: { source: SemanticSource; items: IndexItem[] } | null = null
  private lastPruneAt = 0
  private unsubscribeFiles: (() => void) | null = null

  /** Start sweeping (once, after boot). */
  start() {
    if (this.started) return
    this.started = true
    this.stopped = false
    startFileSearchMaintenance()
    onSemanticChange((source) => this.poke(source))
    this.unsubscribeFiles = FileStoreService.onChange((change) => {
      if (change.action === 'write' && change.entries.some((entry) => entry.kind === 'file')) this.poke('file')
    })
    this.schedule(FIRST_SWEEP_MS)
  }

  stop() {
    this.stopped = true
    stopFileSearchMaintenance()
    onSemanticChange(null)
    this.unsubscribeFiles?.()
    this.unsubscribeFiles = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Something changed (one source, or anything when not said): look at it soon. */
  poke(source?: SemanticSource) {
    if (!this.started || this.stopped) return
    for (const each of source ? [source] : ALL_SOURCES) this.dirty.add(each)
    // A pass in progress reschedules itself soon while anything is dirty.
    if (this.running) return
    this.schedule(source ? SIGNAL_DELAY_MS[source] : SIGNAL_DELAY_MS.recall)
  }

  /** Whether the indexer still has work (the status page shows it). */
  get indexing() {
    return this.busy
  }

  /** Arm the timer, keeping an earlier one; `full` makes that pass look at every source. */
  private schedule(delayMs: number, full = false) {
    if (this.stopped) return
    const at = Date.now() + delayMs
    if (this.timer && this.timerAt <= at) {
      this.timerFull ||= full
      return
    }
    if (this.timer) clearTimeout(this.timer)
    this.timerAt = at
    this.timerFull = full
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.timerFull) for (const source of ALL_SOURCES) this.dirty.add(source)
      void this.sweep(false)
    }, delayMs)
    this.timer.unref?.()
  }

  /**
   * One batch of work; resolves when it is done. `all` looks at every source (tests and the manual check), not only
   * the ones that changed.
   */
  async sweep(all = true): Promise<number> {
    if (this.running) {
      await this.running
      return 0
    }
    if (all) for (const source of ALL_SOURCES) this.dirty.add(source)
    let done = 0
    let failed = false
    this.running = (async () => {
      try {
        done = await this.runOnce()
      } catch (error) {
        failed = true
        console.warn('[SemanticIndex] pass failed:', error instanceof Error ? error.message : error)
      }
    })()
    await this.running
    this.running = null
    const settings = embeddingSettings()
    const resting = embeddingFailure()
    const more = done > 0 || this.queue !== null || this.dirty.size > 0
    this.busy = settings.enabled && !resting && !failed && more
    // Resting after a failure: retry once the rest is over; anything else waits for a signal or the idle pass.
    if (!settings.enabled) this.schedule(IDLE_SWEEP_MS, true)
    else if (resting) this.schedule(embeddingRuntime.failureRestMs + 1_000, true)
    else if (failed) this.schedule(ERROR_SWEEP_MS, true)
    else if (more) this.schedule(BUSY_SWEEP_MS)
    else this.schedule(IDLE_SWEEP_MS, true)
    return done
  }

  private async runOnce(): Promise<number> {
    const settings = embeddingSettings()
    if (!settings.enabled || embeddingFailure()) return 0
    // Weights first (a fresh install, a new model): fetched on their own, so the status shows the download.
    if (!embeddingRuntime.isModelCached() && !(await warmEmbeddingModel())) return 0
    if (Date.now() - this.lastPruneAt >= PRUNE_EVERY_MS) {
      this.lastPruneAt = Date.now()
      pruneVectors()
    }
    pruneImageVectors()

    if (this.queue) {
      const { source, items } = this.queue
      if (!sourceOn(settings, source)) {
        this.queue = null
      } else {
        const batch = items.splice(0, TEXT_SOURCES.find((entry) => entry.source === source)?.batch ?? BATCH_ITEMS)
        if (items.length === 0) this.queue = null
        await indexItems(batch.filter((item) => !alreadyEmbedded(item)))
        return batch.length
      }
    }
    for (const entry of TEXT_SOURCES) {
      if (!this.dirty.has(entry.source)) continue
      if (!sourceOn(settings, entry.source)) {
        this.dirty.delete(entry.source)
        continue
      }
      const items = await entry.pending(entry.scan)
      if (items.length === 0) {
        this.dirty.delete(entry.source)
        continue
      }
      // The source stays dirty: once its queue is done, a scan looks for more.
      const batch = items.splice(0, entry.batch)
      if (items.length > 0) this.queue = { source: entry.source, items }
      await indexItems(batch)
      return batch.length
    }
    // Images last: the slowest (about 0.7 s each), and nothing waits on them.
    if (this.dirty.has('image')) {
      const done = settings.imageSearch ? await indexPendingImages() : 0
      if (done) return done
      this.dirty.delete('image')
    }
    return 0
  }
}

export const semanticIndexer = new SemanticIndexer()

/**
 * Embed the lore entries of these books that have no current vector yet, now (a chat turn is waiting); at most
 * `limit`, the rest is left to the background pass.
 */
export async function indexLoreNow(bookIds: ReadonlySet<number>, limit: number) {
  if (!embeddingFeatureOn('lorebook')) return 0
  const items = pendingLore(limit + 1, bookIds)
  if (items.length > limit) semanticIndexer.poke('lore')
  return indexItems(items.slice(0, limit), 'normal')
}

/** Embed this chat's summary segments that have none yet (a recall is about to rank them). */
export async function indexSegmentsNow(threadId: number, limit: number) {
  if (!embeddingFeatureOn('chatRecall')) return 0
  const items = pendingSegments(limit + 1, threadId)
  if (items.length > limit) semanticIndexer.poke('recall')
  return indexItems(items.slice(0, limit), 'normal')
}

/** Embed messages of these chats that have none yet, newest first (a history search is about to run). */
export async function indexMessagesNow(threadIds: number[], limit: number) {
  if (!embeddingFeatureOn('chatHistory') && !embeddingFeatureOn('chatRecall')) return 0
  const eligible = new Set(historyThreadIds())
  const items = pendingMessages(limit + 1, threadIds.filter((id) => eligible.has(id)))
  if (items.length > limit) semanticIndexer.poke('message')
  return indexItems(items.slice(0, limit), 'normal')
}

export const semanticIndexInternals = { pendingSegments, pendingMessages, pendingLore, pendingFiles, pruneVectors, historyThreadIds }
