import { db } from '../../database/init'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { normalizeVector, vectorStore } from '../vectors/vectorStore'
import { ImageSafetyService } from '../imageSafetyService'
import { MediaPostprocessVisibilityService } from '../mediaPostprocessVisibilityService'
import { MEDIA_STYLE_MODEL_KEY, MEDIA_STYLE_SPACE } from '../aiWorker/aiVisionService'
import {
  IMAGE_EMBEDDING_DIM,
  IMAGE_EMBEDDING_MODEL_KEY,
  embedImages,
  embedQuery,
  embeddingFeatureOn,
} from '../aiWorker/textEmbeddingService'

/**
 * Library images in the embedding space (`media-image`, source = composite hash): what a picture shows, searchable
 * by a text description and by another picture. Still images only (an active `image` file); every image is indexed
 * whatever its rating or post-processing state, and searches show only what the library would show.
 *
 * The media rows live in the main database and the vectors in vectors.db (attached to user.db), so pending images
 * are found by walking media ids: newest first down to the oldest, then only ids above the highest one seen. Every
 * few hours the walk starts over, which picks up an image that could not be read before or whose hash changed.
 */

export const MEDIA_IMAGE_SPACE = 'media-image'

/** Yield the shared worker after each image so interactive queries do not wait through a multi-image batch. */
const BATCH_IMAGES = 1
const SCAN_PAGE = 500
/** Pages one pass may scan without finding work (a caught-up library is walked over several passes). */
const SCAN_PAGES_PER_PASS = 20
const REWALK_MS = 6 * 60 * 60_000
const IN_CHUNK = 500
const PRUNE_EVERY_MS = 60 * 60_000

const IMAGE_FILE_MATCH = `f.composite_hash = im.composite_hash AND f.file_status = 'active' AND f.original_file_path IS NOT NULL
        AND f.file_type = 'image' AND COALESCE(f.mime_type, '') NOT LIKE 'video/%'`

type ScanRow = { media_id: number; composite_hash: string; path: string }

const scan = {
  /** Walking down: ids below this are still to look at (null before the first page). */
  below: null as number | null,
  /** The highest id when the downward walk began; afterwards, ids above it are new. */
  top: 0,
  fullPass: false,
  /** When the current walk began (it starts over REWALK_MS after that, once caught up). */
  startedAt: 0,
}
let lastPruneAt = 0
let indexing: Promise<number> | null = null

function scanPage(): { rows: ScanRow[]; downward: boolean } {
  const select = `SELECT im.media_id, im.composite_hash,
      (SELECT f.original_file_path FROM image_files f WHERE ${IMAGE_FILE_MATCH} LIMIT 1) AS path
    FROM media_metadata im
    WHERE EXISTS (SELECT 1 FROM image_files f WHERE ${IMAGE_FILE_MATCH})`
  if (!scan.fullPass) {
    const rows = (scan.below === null
      ? db.prepare(`${select} ORDER BY im.media_id DESC LIMIT ?`).all(SCAN_PAGE)
      : db.prepare(`${select} AND im.media_id < ? ORDER BY im.media_id DESC LIMIT ?`).all(scan.below, SCAN_PAGE)) as ScanRow[]
    if (scan.below === null) {
      scan.top = rows[0]?.media_id ?? 0
      scan.startedAt = Date.now()
    }
    return { rows, downward: true }
  }
  return { rows: db.prepare(`${select} AND im.media_id > ? ORDER BY im.media_id ASC LIMIT ?`).all(scan.top, SCAN_PAGE) as ScanRow[], downward: false }
}

function storedHashes(hashes: string[]): Set<string> {
  const found = new Set<string>()
  const userDb = getUserSettingsDb()
  for (let start = 0; start < hashes.length; start += IN_CHUNK) {
    const part = hashes.slice(start, start + IN_CHUNK)
    const rows = userDb.prepare(`SELECT source_key FROM vector_db.vectors WHERE space = ? AND model_key = ? AND chunk = 0
      AND source_key IN (${part.map(() => '?').join(', ')})`).all(MEDIA_IMAGE_SPACE, IMAGE_EMBEDDING_MODEL_KEY, ...part) as Array<{ source_key: string }>
    for (const row of rows) found.add(row.source_key)
  }
  return found
}

/**
 * The next images without a vector (at most `limit`), moving the walk past everything before them, and how many
 * media rows were looked at (more than zero with no images: the page budget ran out, the walk goes on next pass).
 */
function nextPendingImages(limit: number): { rows: ScanRow[]; scanned: number } {
  if (scan.fullPass && Date.now() - scan.startedAt >= REWALK_MS) {
    scan.below = null
    scan.top = 0
    scan.fullPass = false
  }
  let scanned = 0
  for (let page = 0; page < SCAN_PAGES_PER_PASS; page += 1) {
    const { rows, downward } = scanPage()
    if (rows.length === 0) {
      if (downward) scan.fullPass = true
      return { rows: [], scanned: 0 }
    }
    scanned += rows.length
    const stored = storedHashes(rows.map((row) => row.composite_hash))
    const pending = rows.filter((row) => !stored.has(row.composite_hash))
    const taken = pending.slice(0, limit)
    // Past the whole page, or only up to the last image taken when more are waiting in it.
    const reached = taken.length === limit && pending.length > limit ? taken[taken.length - 1].media_id : rows[rows.length - 1].media_id
    if (downward) scan.below = reached
    else scan.top = Math.max(scan.top, reached)
    if (taken.length > 0) return { rows: taken, scanned }
  }
  return { rows: [], scanned }
}

/**
 * One batch of the background pass: embed a few images without a vector; returns how many were looked at (zero once
 * the walk has nothing left).
 */
export function indexPendingImages(limit = BATCH_IMAGES): Promise<number> {
  if (indexing) return indexing
  indexing = indexImages(limit).finally(() => { indexing = null })
  return indexing
}

async function indexImages(limit: number): Promise<number> {
  if (!embeddingFeatureOn('imageSearch')) return 0
  const before = { ...scan }
  const { rows, scanned } = nextPendingImages(limit)
  if (rows.length === 0) return scanned
  try {
    const vectors = await embedImages(rows.map((row) => row.path), { priority: 'low' })
    if (vectors.length !== rows.length) throw new Error('Incomplete image embedding batch')
    if (!embeddingFeatureOn('imageSearch')) { Object.assign(scan, before); return 0 }
    rows.forEach((row, index) => {
      const vector = vectors[index]
      if (vector instanceof Float32Array) {
        if (!db.prepare(`SELECT 1 FROM media_metadata im JOIN image_files f ON f.composite_hash = im.composite_hash
          WHERE im.composite_hash = ? AND f.original_file_path = ? AND ${IMAGE_FILE_MATCH}`).get(row.composite_hash, row.path)) return
        vectorStore.replace(MEDIA_IMAGE_SPACE, row.composite_hash, IMAGE_EMBEDDING_MODEL_KEY, [{ vector }])
      } else if (vector) {
        console.warn(`[ImageIndex] skipped ${row.composite_hash.slice(0, 12)}: ${vector.error}`)
      }
    })
  } catch (error) {
    // A transient batch failure must retry the same page, rather than waiting for the six-hour rewalk.
    Object.assign(scan, before)
    throw error
  }
  return rows.length
}

/** Drop image vectors of another model and of media that is gone (at most once an hour; cheap per chunk). */
export function pruneImageVectors(force = false) {
  if (!force && Date.now() - lastPruneAt < PRUNE_EVERY_MS) return 0
  lastPruneAt = Date.now()
  let removed = 0
  for (const [space, model] of [[MEDIA_IMAGE_SPACE, IMAGE_EMBEDDING_MODEL_KEY], [MEDIA_STYLE_SPACE, MEDIA_STYLE_MODEL_KEY]]) {
    removed += vectorStore.pruneOtherModels(space, model)
    const keys = [...vectorStore.contentHashes(space, model).keys()]
    for (let start = 0; start < keys.length; start += IN_CHUNK) {
      const part = keys.slice(start, start + IN_CHUNK)
      const alive = new Set((db.prepare(`SELECT composite_hash FROM media_metadata WHERE composite_hash IN (${part.map(() => '?').join(', ')})`)
        .all(...part) as Array<{ composite_hash: string }>).map((row) => row.composite_hash))
      for (const key of part) if (!alive.has(key)) removed += vectorStore.remove(space, key)
    }
  }
  if (removed) rankCache.clear()
  return removed
}

export function imageIndexCount() {
  return vectorStore.count(MEDIA_IMAGE_SPACE, IMAGE_EMBEDDING_MODEL_KEY)
}

// ---- Searching ------------------------------------------------------------------------------------------------

export type ImageVectorHit = { compositeHash: string; score: number }

/** Of these hashes, the ones the library shows now (rating tiers not hidden, post-processing done), in order. */
function visibleOnly(hits: ImageVectorHit[], limit: number, exclude?: string): ImageVectorHit[] {
  const out: ImageVectorHit[] = []
  for (let start = 0; start < hits.length && out.length < limit; start += IN_CHUNK) {
    const part = hits.slice(start, start + IN_CHUNK).filter((hit) => hit.compositeHash !== exclude)
    if (part.length === 0) continue
    const visible = new Set((db.prepare(`SELECT im.composite_hash FROM media_metadata im
      WHERE im.composite_hash IN (${part.map(() => '?').join(', ')})
        AND ${ImageSafetyService.buildVisibleScoreCondition('im.rating_score')}
        AND ${MediaPostprocessVisibilityService.buildReadyCondition('im')}`)
      .all(...part.map((hit) => hit.compositeHash)) as Array<{ composite_hash: string }>).map((row) => row.composite_hash))
    for (const hit of part) {
      if (visible.has(hit.compositeHash)) out.push(hit)
      if (out.length >= limit) break
    }
  }
  return out
}

/**
 * Below this a description does not match (real model: unrelated text/image pairs score 0.56-0.63, a picture of what
 * the text says 0.68-0.79).
 */
const TEXT_MATCH_MIN_SCORE = 0.64

/** Candidates kept from the raw ranking before the visibility filter (hidden ones are dropped after). */
const overfetch = (limit: number) => Math.max(limit * 4, 200)

/**
 * A text query in the image space: queries come at the text dimension, images are stored at a Matryoshka prefix of
 * it. The prefix renormalized is what the worker returns when asked for that dimension.
 */
async function imageSpaceQuery(text: string, waitMs: number, signal?: AbortSignal) {
  const query = await embedQuery(text, { waitMs, signal })
  return query ? normalizeVector(query.subarray(0, IMAGE_EMBEDDING_DIM)) : null
}

/**
 * Images matching a text description, best first; null when image search is off or the model did not answer in
 * `waitMs` (a cold model loads in about 10 s).
 */
export async function searchImagesByText(text: string, limit: number, options: { waitMs?: number; minScore?: number; signal?: AbortSignal } = {}): Promise<ImageVectorHit[] | null> {
  if (!embeddingFeatureOn('imageSearch')) return null
  const query = await imageSpaceQuery(text, options.waitMs ?? 20_000, options.signal)
  if (!query) return null
  const hits = vectorStore.search(MEDIA_IMAGE_SPACE, IMAGE_EMBEDDING_MODEL_KEY, query, { limit: overfetch(limit), minScore: options.minScore ?? TEXT_MATCH_MIN_SCORE })
  return visibleOnly(hits.map((hit) => ({ compositeHash: hit.sourceKey, score: hit.score })), limit)
}

/**
 * Most text matches one library search orders by meaning; the rest of the chip filter narrows them in SQL. Kept a
 * minute per text (an image indexed meanwhile joins the next search after that).
 */
const RANK_LIMIT = 3000
const RANK_CACHE_MS = 60_000
const RANK_CACHE_SIZE = 16
const rankCache = new Map<string, { at: number; hits: ImageVectorHit[] }>()

/**
 * Every indexed image matching a description, best first, without the visibility filter (the library search applies
 * its own). Kept for a minute per text so scrolling a result does not embed the text again. Null like
 * searchImagesByText.
 */
export async function rankImagesByText(text: string, options: { waitMs?: number; signal?: AbortSignal } = {}): Promise<ImageVectorHit[] | null> {
  if (!embeddingFeatureOn('imageSearch')) return null
  const key = text.trim()
  const cached = rankCache.get(key)
  if (cached && Date.now() - cached.at < RANK_CACHE_MS) return cached.hits
  const query = await imageSpaceQuery(text, options.waitMs ?? 20_000, options.signal)
  if (!query) return null
  // Concurrent callers share query embedding; the first resumed caller also supplies the ranking.
  const completed = rankCache.get(key)
  if (completed && Date.now() - completed.at < RANK_CACHE_MS) return completed.hits
  const hits = vectorStore.search(MEDIA_IMAGE_SPACE, IMAGE_EMBEDDING_MODEL_KEY, query, { limit: RANK_LIMIT, minScore: TEXT_MATCH_MIN_SCORE })
    .map((hit) => ({ compositeHash: hit.sourceKey, score: hit.score }))
  rankCache.delete(key)
  rankCache.set(key, { at: Date.now(), hits })
  while (rankCache.size > RANK_CACHE_SIZE) rankCache.delete(rankCache.keys().next().value as string)
  return hits
}

export type SimilarImageBasis = 'content' | 'style'

/**
 * Images closest to one image: by what it shows (image vectors) or by its drawing style (Kaloscope style vectors).
 * Null when that image has no vector yet.
 */
export function similarImagesByVector(compositeHash: string, basis: SimilarImageBasis, limit: number): ImageVectorHit[] | null {
  const [space, modelKey] = basis === 'style' ? [MEDIA_STYLE_SPACE, MEDIA_STYLE_MODEL_KEY] : [MEDIA_IMAGE_SPACE, IMAGE_EMBEDDING_MODEL_KEY]
  const own = vectorStore.get(space, compositeHash, modelKey)[0]
  if (!own) return null
  const hits = vectorStore.search(space, modelKey, own.vector, { limit: overfetch(limit) + 1 })
  return visibleOnly(hits.map((hit) => ({ compositeHash: hit.sourceKey, score: hit.score })), limit, compositeHash)
}

/** Which vector searches one image can take part in (the detail page shows a section for each). */
export function imageVectorAvailability(compositeHash: string): Record<SimilarImageBasis, boolean> {
  return {
    content: embeddingFeatureOn('imageSearch') && vectorStore.get(MEDIA_IMAGE_SPACE, compositeHash, IMAGE_EMBEDDING_MODEL_KEY).length > 0,
    style: vectorStore.get(MEDIA_STYLE_SPACE, compositeHash, MEDIA_STYLE_MODEL_KEY).length > 0,
  }
}

/** Test seam: restart the walk. */
export const imageIndexInternals = {
  reset() {
    scan.below = null
    scan.top = 0
    scan.fullPass = false
    scan.startedAt = 0
    lastPruneAt = 0
    rankCache.clear()
  },
  state: () => ({ ...scan }),
  /** Make the finished walk old enough to start over. */
  ageWalk() {
    scan.startedAt = Date.now() - REWALK_MS
  },
}
