import { getUserSettingsDb } from '../../database/userSettingsDb'

export type VectorRow = {
  sourceKey: string
  chunk: number
  ownerKey: string | null
  contentHash: string | null
  /** The chunk's character range in the source text; null for a whole source. */
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
  dim: number
  rows: VectorRow[]
  matrix: Float32Array
}

/** Loaded matrices per `${space}\u0000${modelKey}`; dropped on any write to the space. */
const caches = new Map<string, SpaceCache>()

function cacheKey(space: string, modelKey: string) {
  return `${space}\u0000${modelKey}`
}

function invalidate(space: string) {
  for (const key of [...caches.keys()]) {
    if (key.startsWith(`${space}\u0000`)) caches.delete(key)
  }
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
  /** Replace every chunk of one source with the given vectors (an empty list just deletes). */
  replace(space: string, sourceKey: string, modelKey: string, inputs: VectorInput[]) {
    const db = getUserSettingsDb()
    const now = new Date().toISOString()
    const insert = db.prepare(`
      INSERT INTO vector_db.vectors (space, source_key, chunk, model_key, dim, owner_key, content_hash, span_start, span_end, vector, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    db.transaction(() => {
      db.prepare('DELETE FROM vector_db.vectors WHERE space = ? AND source_key = ?').run(space, sourceKey)
      inputs.forEach((input, index) => {
        const vector = normalizeVector(input.vector)
        insert.run(space, sourceKey, input.chunk ?? index, modelKey, vector.length, input.ownerKey ?? null, input.contentHash ?? null, input.start ?? null, input.end ?? null, toBlob(vector), now)
      })
    })()
    invalidate(space)
  },

  remove(space: string, sourceKey: string) {
    const changes = getUserSettingsDb().prepare('DELETE FROM vector_db.vectors WHERE space = ? AND source_key = ?').run(space, sourceKey).changes
    if (changes > 0) invalidate(space)
    return changes
  },

  /** Delete rows of a space made by any other model (after a model change). */
  pruneOtherModels(space: string, modelKey: string) {
    const changes = getUserSettingsDb().prepare('DELETE FROM vector_db.vectors WHERE space = ? AND model_key != ?').run(space, modelKey).changes
    if (changes > 0) invalidate(space)
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
    const cache = loadSpace(space, modelKey)
    if (!cache || cache.rows.length === 0) return []
    const normalized = normalizeVector(query)
    if (normalized.length !== cache.dim) {
      throw new Error(`vector size ${normalized.length} does not match ${space} (${cache.dim})`)
    }
    const owners = options.ownerKeys ? new Set(options.ownerKeys) : null
    const sources = options.sourceKeys ? new Set(options.sourceKeys) : null
    const minScore = options.minScore ?? -Infinity
    const hits: VectorHit[] = []
    const { dim, matrix, rows } = cache
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r]
      if (owners && !owners.has(row.ownerKey)) continue
      if (sources && !sources.has(row.sourceKey)) continue
      let score = 0
      const offset = r * dim
      for (let i = 0; i < dim; i += 1) score += matrix[offset + i] * normalized[i]
      if (score >= minScore) hits.push({ ...row, score })
    }
    hits.sort((a, b) => b.score - a.score)
    return options.limit ? hits.slice(0, options.limit) : hits
  },
}

type StoredRow = { source_key: string; chunk: number; owner_key: string | null; content_hash: string | null; span_start: number | null; span_end: number | null }

function toRow(row: StoredRow): VectorRow {
  return { sourceKey: row.source_key, chunk: row.chunk, ownerKey: row.owner_key, contentHash: row.content_hash, spanStart: row.span_start, spanEnd: row.span_end }
}

function loadSpace(space: string, modelKey: string): SpaceCache | null {
  const key = cacheKey(space, modelKey)
  const cached = caches.get(key)
  if (cached) return cached
  const rows = getUserSettingsDb().prepare(`
    SELECT source_key, chunk, owner_key, content_hash, span_start, span_end, dim, vector FROM vector_db.vectors WHERE space = ? AND model_key = ?
  `).all(space, modelKey) as Array<StoredRow & { dim: number; vector: Buffer }>
  if (rows.length === 0) return null
  const dim = rows[0].dim
  const usable = rows.filter((row) => row.dim === dim)
  const matrix = new Float32Array(usable.length * dim)
  usable.forEach((row, index) => matrix.set(fromBlob(row.vector), index * dim))
  const cache: SpaceCache = {
    dim,
    matrix,
    rows: usable.map(toRow),
  }
  caches.set(key, cache)
  return cache
}
