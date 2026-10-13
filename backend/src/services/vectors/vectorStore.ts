import { getUserSettingsDb } from '../../database/userSettingsDb'

export type VectorRow = {
  sourceKey: string
  chunk: number
  ownerKey: string | null
  contentHash: string | null
  /** Character range for chat text, UTF-8 byte range for file chunks; null for a whole source. */
  spanStart: number | null
  spanEnd: number | null
}

export type VectorHit = VectorRow & { score: number }

export type VectorInput = {
  chunk?: number
  vector: ArrayLike<number>
  ownerKey?: string | null
  contentHash?: string | null
  start?: number | null
  end?: number | null
}

type SpaceCache = {
  modelKey: string
  dim: number
  /** Row slots in matrix order; null where a row was removed (compacted away once many are). */
  rows: Array<VectorRow | null>
  /** Room for more rows than are in use, so a write appends instead of reloading the space. */
  matrix: Float32Array
  /** Slots per source. */
  bySource: Map<string, number[]>
  dead: number
}

/**
 * Loaded matrices per `${space}\u0000${modelKey}`, kept in step with writes: a write replaces that source's rows in
 * place, so a backfill does not make every search reload the whole space.
 */
const caches = new Map<string, SpaceCache>()
/** Internal resource policy; changing it invalidates loaded matrices on the next search. */
export const vectorCachePolicy = {
  maxMatrixBytes: 256 * 1024 * 1024,
  get matrixBytes() { return [...caches.values()].reduce((sum, cache) => sum + cache.matrix.byteLength, 0) },
}
let cacheDb: ReturnType<typeof getUserSettingsDb> | null = null
let cacheVersion = -1

/** SQLite changes this counter for commits by another connection (including a standalone MCP process). */
function syncCaches() {
  const db = getUserSettingsDb()
  const version = db.pragma('vector_db.data_version', { simple: true }) as number
  if (cacheDb !== db || cacheVersion !== version) caches.clear()
  cacheDb = db
  cacheVersion = version
}

/** Matrices have a hard total bound; oversized spaces are searched through the DB iterator. */
function trimCaches() {
  let bytes = [...caches.values()].reduce((sum, cache) => sum + cache.matrix.byteLength, 0)
  for (const [key, cache] of caches) {
    if (bytes <= vectorCachePolicy.maxMatrixBytes && caches.size <= 16) break
    caches.delete(key)
    bytes -= cache.matrix.byteLength
  }
}
/** Removed slots tolerated before a matrix is rebuilt without them. */
const COMPACT_MIN_DEAD = 1024

function cacheKey(space: string, modelKey: string) {
  return `${space}\u0000${modelKey}`
}

function spaceCaches(space: string) {
  return [...caches.entries()].filter(([key]) => key.startsWith(`${space}\u0000`))
}

function dropSource(cache: SpaceCache, sourceKey: string) {
  const slots = cache.bySource.get(sourceKey)
  if (!slots) return
  for (const slot of slots) cache.rows[slot] = null
  cache.dead += slots.length
  cache.bySource.delete(sourceKey)
}

function appendRow(cache: SpaceCache, row: VectorRow, vector: Float32Array) {
  const slot = cache.rows.length
  if ((slot + 1) * cache.dim > cache.matrix.length) {
    const length = Math.max(cache.matrix.length * 2, (slot + 64) * cache.dim)
    if (length * 4 > vectorCachePolicy.maxMatrixBytes) return false
    const grown = new Float32Array(length)
    grown.set(cache.matrix)
    cache.matrix = grown
  }
  cache.matrix.set(vector, slot * cache.dim)
  cache.rows.push(row)
  const slots = cache.bySource.get(row.sourceKey)
  if (slots) slots.push(slot)
  else cache.bySource.set(row.sourceKey, [slot])
  return true
}

function compact(cache: SpaceCache) {
  if (cache.dead < COMPACT_MIN_DEAD || cache.dead * 2 < cache.rows.length) return
  const rows: Array<VectorRow | null> = []
  const matrix = new Float32Array((cache.rows.length - cache.dead + 64) * cache.dim)
  const bySource = new Map<string, number[]>()
  cache.rows.forEach((row, slot) => {
    if (!row) return
    matrix.set(cache.matrix.subarray(slot * cache.dim, (slot + 1) * cache.dim), rows.length * cache.dim)
    const slots = bySource.get(row.sourceKey)
    if (slots) slots.push(rows.length)
    else bySource.set(row.sourceKey, [rows.length])
    rows.push(row)
  })
  Object.assign(cache, { rows, matrix, bySource, dead: 0 })
}

/** L2-normalized float32 copy (the stored form; a zero vector stays zero). */
export function normalizeVector(values: ArrayLike<number>): Float32Array {
  const out = new Float32Array(values.length)
  let norm = 0
  for (let i = 0; i < values.length; i += 1) {
    out[i] = values[i]
    norm += out[i] * out[i]
  }
  norm = Math.sqrt(norm)
  if (norm > 0) {
    for (let i = 0; i < out.length; i += 1) out[i] /= norm
  }
  return out
}

function toBlob(vector: Float32Array) {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
}

function fromBlob(blob: Buffer): Float32Array {
  // Copy: the Buffer may sit at an unaligned offset of a shared pool.
  const copy = new Float32Array(blob.byteLength / 4)
  Buffer.from(copy.buffer).set(blob)
  return copy
}

/**
 * Embedding rows in `vector_db.vectors`. Search is exact (brute-force dot product over L2-normalized vectors): at
 * 256 dims, 100k rows is a ~100 MB matrix and a few tens of ms per query, which is what this library needs.
 */
export const vectorStore = {
  /** Commit one resumable file batch and its cursor together. Old revisions never share chunks. */
  appendFileBatch(sourceKey: string, modelKey: string, ownerKey: string, revision: string,
    inputs: VectorInput[], progress: { offset: number; chunk: number; complete: boolean }) {
    syncCaches()
    const db = getUserSettingsDb()
    let reset = false
    const written: Array<{ row: VectorRow; vector: Float32Array }> = []
    db.transaction(() => {
      const known = db.prepare('SELECT revision, model_key FROM vector_db.file_progress WHERE source_key = ?').get(sourceKey) as { revision: string; model_key: string } | undefined
      reset = known?.revision !== revision || known.model_key !== modelKey
      if (reset) db.prepare("DELETE FROM vector_db.vectors WHERE space = 'file' AND source_key = ?").run(sourceKey)
      const insert = db.prepare(`INSERT OR REPLACE INTO vector_db.vectors
        (space, source_key, chunk, model_key, dim, owner_key, content_hash, span_start, span_end, vector, updated_at)
        VALUES ('file', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const input of inputs) {
        const vector = normalizeVector(input.vector)
        insert.run(sourceKey, input.chunk, modelKey, vector.length, ownerKey, revision, input.start, input.end, toBlob(vector), new Date().toISOString())
        written.push({ vector, row: { sourceKey, chunk: input.chunk!, ownerKey, contentHash: revision, spanStart: input.start ?? null, spanEnd: input.end ?? null } })
      }
      db.prepare(`INSERT OR REPLACE INTO vector_db.file_progress (source_key, revision, model_key, next_offset, next_chunk, complete, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(sourceKey, revision, modelKey, progress.offset, progress.chunk, Number(progress.complete), Date.now())
    })()
    // Preserve every other document's loaded vectors. Replace only retried chunks of this source.
    for (const [key, cache] of spaceCaches('file')) {
      if (reset) dropSource(cache, sourceKey)
      if (cache.modelKey === modelKey) {
        if (written.some(({ vector }) => vector.length !== cache.dim)) { caches.delete(key); continue }
        const chunks = new Set(written.map(({ row }) => row.chunk))
        const keep: number[] = []
        for (const slot of cache.bySource.get(sourceKey) ?? []) {
          if (chunks.has(cache.rows[slot]!.chunk)) { cache.rows[slot] = null; cache.dead++ }
          else keep.push(slot)
        }
        cache.bySource.set(sourceKey, keep)
        for (const { row, vector } of written) if (!appendRow(cache, row, vector)) { caches.delete(key); break }
      }
      compact(cache)
    }
    trimCaches()
  },
  /** Replace every chunk of one source with the given vectors (an empty list just deletes). */
  replace(space: string, sourceKey: string, modelKey: string, inputs: VectorInput[]) {
    syncCaches()
    const db = getUserSettingsDb()
    const now = new Date().toISOString()
    const insert = db.prepare(`
      INSERT INTO vector_db.vectors (space, source_key, chunk, model_key, dim, owner_key, content_hash, span_start, span_end, vector, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const written: Array<{ row: VectorRow; vector: Float32Array }> = []
    db.transaction(() => {
      db.prepare('DELETE FROM vector_db.vectors WHERE space = ? AND source_key = ?').run(space, sourceKey)
      inputs.forEach((input, index) => {
        const vector = normalizeVector(input.vector)
        const row: VectorRow = { sourceKey, chunk: input.chunk ?? index, ownerKey: input.ownerKey ?? null, contentHash: input.contentHash ?? null, spanStart: input.start ?? null, spanEnd: input.end ?? null }
        insert.run(space, sourceKey, row.chunk, modelKey, vector.length, row.ownerKey, row.contentHash, row.spanStart, row.spanEnd, toBlob(vector), now)
        written.push({ row, vector })
      })
    })()
    // The source's rows of every model are gone; the new ones join the loaded matrix of their model.
    for (const [key, cache] of spaceCaches(space)) {
      dropSource(cache, sourceKey)
      if (cache.modelKey === modelKey) {
        if (written.some(({ vector }) => vector.length !== cache.dim)) {
          caches.delete(key)
          continue
        }
        for (const { row, vector } of written) if (!appendRow(cache, row, vector)) { caches.delete(key); break }
      }
      compact(cache)
    }
    trimCaches()
  },

  remove(space: string, sourceKey: string) {
    syncCaches()
    const changes = getUserSettingsDb().prepare('DELETE FROM vector_db.vectors WHERE space = ? AND source_key = ?').run(space, sourceKey).changes
    if (changes > 0) {
      for (const [, cache] of spaceCaches(space)) {
        dropSource(cache, sourceKey)
        compact(cache)
      }
    }
    return changes
  },

  /** Delete rows of a space made by any other model (after a model change). */
  pruneOtherModels(space: string, modelKey: string) {
    syncCaches()
    const changes = getUserSettingsDb().prepare('DELETE FROM vector_db.vectors WHERE space = ? AND model_key != ?').run(space, modelKey).changes
    if (changes > 0) {
      for (const [key, cache] of spaceCaches(space)) if (cache.modelKey !== modelKey) caches.delete(key)
    }
    return changes
  },

  /** Drop every loaded matrix (after rows were deleted with plain SQL). */
  invalidateAll() {
    caches.clear()
  },

  get(space: string, sourceKey: string, modelKey: string): Array<VectorRow & { vector: Float32Array }> {
    const rows = getUserSettingsDb().prepare(`
      SELECT source_key, chunk, owner_key, content_hash, span_start, span_end, vector FROM vector_db.vectors
      WHERE space = ? AND source_key = ? AND model_key = ? ORDER BY chunk
    `).all(space, sourceKey, modelKey) as Array<StoredRow & { vector: Buffer }>
    return rows.map((row) => ({ ...toRow(row), vector: fromBlob(row.vector) }))
  },

  /** content_hash of one source (chunk 0), or undefined when it has no vector of this model. */
  contentHash(space: string, sourceKey: string, modelKey: string): string | null | undefined {
    const row = getUserSettingsDb().prepare('SELECT content_hash FROM vector_db.vectors WHERE space = ? AND source_key = ? AND model_key = ? AND chunk = 0')
      .get(space, sourceKey, modelKey) as { content_hash: string | null } | undefined
    return row ? row.content_hash : undefined
  },

  /** content_hash per source (chunk 0) for a space, to skip re-embedding unchanged text. */
  contentHashes(space: string, modelKey: string, ownerKey?: string | null): Map<string, string | null> {
    const db = getUserSettingsDb()
    const rows = (ownerKey === undefined
      ? db.prepare('SELECT source_key, content_hash FROM vector_db.vectors WHERE space = ? AND model_key = ? AND chunk = 0').all(space, modelKey)
      : db.prepare('SELECT source_key, content_hash FROM vector_db.vectors WHERE space = ? AND model_key = ? AND chunk = 0 AND owner_key IS ?').all(space, modelKey, ownerKey)) as Array<{ source_key: string; content_hash: string | null }>
    return new Map(rows.map((row) => [row.source_key, row.content_hash]))
  },

  count(space: string, modelKey?: string): number {
    const db = getUserSettingsDb()
    const row = (modelKey
      ? db.prepare('SELECT COUNT(DISTINCT source_key) AS n FROM vector_db.vectors WHERE space = ? AND model_key = ?').get(space, modelKey)
      : db.prepare('SELECT COUNT(DISTINCT source_key) AS n FROM vector_db.vectors WHERE space = ?').get(space)) as { n: number }
    return row.n
  },

  /**
   * Best-matching rows of a space for a query vector. `ownerKeys` / `sourceKeys` restrict the candidates; several
   * chunks of one source each count (callers that want one hit per source take the first).
   */
  search(space: string, modelKey: string, query: ArrayLike<number>, options: { limit?: number; minScore?: number; ownerKeys?: Array<string | null>; sourceKeys?: string[] } = {}): VectorHit[] {
    if (options.sourceKeys?.length === 0 || options.ownerKeys?.length === 0) return []
    const loaded = loadSpace(space, modelKey)
    if (!loaded) return []
    const cache = 'matrix' in loaded ? loaded : null
    const normalized = normalizeVector(query)
    if (normalized.length !== loaded.dim) {
      throw new Error(`vector size ${normalized.length} does not match ${space} (${loaded.dim})`)
    }
    const owners = options.ownerKeys ? new Set(options.ownerKeys) : null
    const sources = options.sourceKeys ? new Set(options.sourceKeys) : null
    const minScore = options.minScore ?? -Infinity
    const limit = Number.isSafeInteger(options.limit) && options.limit! > 0 ? options.limit! : Infinity
    type Hit = { slot: number; score: number; row?: VectorRow }
    const hits: Hit[] = []
    const worse = (a: Hit, b: Hit) => {
      if (a.score !== b.score) return a.score < b.score
      const left = a.row ?? cache!.rows[a.slot]!
      const right = b.row ?? cache!.rows[b.slot]!
      return left.sourceKey > right.sourceKey || (left.sourceKey === right.sourceKey && left.chunk > right.chunk)
    }
    const keep = (hit: Hit) => {
      if (limit === Infinity) { hits.push(hit); return }
      if (hits.length < limit) {
        hits.push(hit)
        let i = hits.length - 1
        while (i > 0) {
          const parent = (i - 1) >> 1
          if (!worse(hits[i], hits[parent])) break
          ;[hits[i], hits[parent]] = [hits[parent], hits[i]]
          i = parent
        }
      } else if (worse(hits[0], hit)) {
        hits[0] = hit
        let i = 0
        for (;;) {
          const left = i * 2 + 1
          if (left >= hits.length) break
          const right = left + 1
          const child = right < hits.length && worse(hits[right], hits[left]) ? right : left
          if (!worse(hits[child], hits[i])) break
          ;[hits[i], hits[child]] = [hits[child], hits[i]]
          i = child
        }
      }
    }
    if (cache) {
      const { dim, matrix, rows } = cache
      const slots: Iterable<number> = sources ? [...sources].flatMap(source => cache.bySource.get(source) ?? []) : rows.keys()
      for (const r of slots) {
        const row = rows[r]
        if (!row || (owners && !owners.has(row.ownerKey))) continue
        let score = 0
        const offset = r * dim
        for (let i = 0; i < dim; i += 1) score += matrix[offset + i] * normalized[i]
        if (score >= minScore) keep({ slot: r, score })
      }
    } else {
      const rows = getUserSettingsDb().prepare(`SELECT source_key, chunk, owner_key, content_hash, span_start, span_end, vector
        FROM vector_db.vectors WHERE space = ? AND model_key = ? AND dim = ?
        ${sources ? 'AND source_key IN (SELECT value FROM json_each(@sources))' : ''}
        ${owners ? 'AND EXISTS (SELECT 1 FROM json_each(@owners) WHERE value IS owner_key)' : ''}`)
        .iterate({ ...(sources ? { sources: JSON.stringify([...sources]) } : {}), ...(owners ? { owners: JSON.stringify([...owners]) } : {}) }, space, modelKey, loaded.dim) as Iterable<StoredRow & { vector: Buffer }>
      let slot = 0
      for (const row of rows) {
        const vector = fromBlob(row.vector)
        let score = 0
        for (let i = 0; i < loaded.dim; i++) score += vector[i] * normalized[i]
        if (score >= minScore) keep({ slot, score, row: toRow(row) })
        slot++
      }
    }
    hits.sort((a, b) => worse(a, b) ? 1 : worse(b, a) ? -1 : 0)
    return hits.map(hit => ({ ...(hit.row ?? cache!.rows[hit.slot]!), score: hit.score }))
  },
}

type StoredRow = { source_key: string; chunk: number; owner_key: string | null; content_hash: string | null; span_start: number | null; span_end: number | null }

function toRow(row: StoredRow): VectorRow {
  return { sourceKey: row.source_key, chunk: row.chunk, ownerKey: row.owner_key, contentHash: row.content_hash, spanStart: row.span_start, spanEnd: row.span_end }
}

function loadSpace(space: string, modelKey: string): SpaceCache | { dim: number } | null {
  syncCaches()
  trimCaches()
  const key = cacheKey(space, modelKey)
  const cached = caches.get(key)
  if (cached) { caches.delete(key); caches.set(key, cached); return cached }
  const db = getUserSettingsDb()
  const first = db.prepare('SELECT dim FROM vector_db.vectors WHERE space=? AND model_key=? LIMIT 1').get(space, modelKey) as { dim: number } | undefined
  if (!first) return null
  const dim = first.dim
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM vector_db.vectors WHERE space=? AND model_key=? AND dim=?').get(space, modelKey, dim) as { count: number }
  if ((count + 64) * dim * 4 > vectorCachePolicy.maxMatrixBytes) return { dim }
  const rows = db.prepare(`
    SELECT source_key, chunk, owner_key, content_hash, span_start, span_end, dim, vector FROM vector_db.vectors WHERE space = ? AND model_key = ?
  `).iterate(space, modelKey) as Iterable<StoredRow & { dim: number; vector: Buffer }>
  const cache: SpaceCache = { modelKey, dim, rows: [], matrix: new Float32Array((count + 64) * dim), bySource: new Map(), dead: 0 }
  for (const row of rows) if (row.dim === dim && !appendRow(cache, toRow(row), fromBlob(row.vector))) return { dim }
  caches.set(key, cache)
  trimCaches()
  return cache
}
