import fs from 'fs'
import path from 'path'
import type { EmbeddingSettings } from '@conai/shared'
import { settingsService } from '../settingsService'
import { aiPythonDir } from '../aiRuntime/aiPythonDir'
import { AiWorkerClient, type AiWorkerPriority } from './aiWorkerClient'
import { aiRuntimeProbe, aiThreads, checkAiDependencies, isHubModelCached, visionWorker } from './aiVisionService'

export const EMBEDDING_MODEL = 'embeddinggemma-2'
export const EMBEDDING_REPO = 'google/embeddinggemma-2'
export const EMBEDDING_FILE = 'model.safetensors'
/**
 * Text vectors keep the full 768 dims: few rows (chat, lore, files) and better separation for recall. Image vectors
 * stay at 256 (Matryoshka prefix): the library has tens of thousands, held in memory for every search.
 */
export const EMBEDDING_DIM = 768
export const IMAGE_EMBEDDING_DIM = 256
/** Vector store key: model, pinned revision (worker_embedding.py) and dimension. Another key re-embeds everything. */
export const EMBEDDING_MODEL_KEY = 'embeddinggemma-2@914f7f8/768'
/** Image vectors: same model and space as text queries, at 140 image tokens (worker_embedding.py IMAGE_TOKENS). */
export const IMAGE_EMBEDDING_MODEL_KEY = 'embeddinggemma-2@914f7f8/256/img140'

/**
 * The worker process for embeddings, apart from the vision worker so a chat's query never waits behind image
 * tagging. Always CPU, bf16 (fp32 on CPUs without native bf16): text modules only (~1.3 GB), or with the vision tower while image search is on (~2.2 GB;
 * one instance then serves both, text vectors are the same).
 */
export const textWorker = new AiWorkerClient({
  label: 'AiTextWorker',
  env: () => ({ CONAI_AI_THREADS: String(aiThreads()), CONAI_AI_ROLE: 'text' }),
  idleMinutes: () => {
    const settings = embeddingSettings()
    return settings.keepModelLoaded ? null : Math.max(1, settings.autoUnloadMinutes || 1)
  },
})

/** Libraries the model needs at least the version requirements-ai.txt pins (an older install loads it wrong or not at all). */
const VERSIONED_PACKAGES = ['transformers', 'sentence-transformers']
let pinnedVersions: Map<string, string> | null = null

function requiredVersions() {
  if (!pinnedVersions) {
    pinnedVersions = new Map()
    try {
      for (const line of fs.readFileSync(path.join(aiPythonDir(), 'requirements-ai.txt'), 'utf8').split(/\r?\n/)) {
        const match = /^\s*([A-Za-z0-9_.-]+)\s*==\s*([^\s#;]+)/.exec(line)
        if (match) pinnedVersions.set(match[1].toLowerCase(), match[2])
      }
    } catch {
      // No requirements file next to the scripts: presence is all that can be checked.
    }
  }
  return pinnedVersions
}

/** Whether version `installed` is below `required` (numeric parts compared in order; "5.19.0.dev0" counts as 5.19.0). */
export function versionBelow(installed: string, required: string) {
  const parts = (version: string) => version.split(/[.+-]/).map((part) => Number.parseInt(part, 10)).filter((part) => Number.isFinite(part))
  const have = parts(installed)
  const want = parts(required)
  for (let index = 0; index < Math.max(have.length, want.length); index += 1) {
    const difference = (have[index] ?? 0) - (want[index] ?? 0)
    if (difference !== 0) return difference < 0
  }
  return false
}

/** The AI runtime check plus the library versions this model needs. */
export async function checkEmbeddingDependencies(): Promise<Awaited<ReturnType<typeof checkAiDependencies>>> {
  const base = await checkAiDependencies()
  if (!base.available) return base
  const { probe } = await aiRuntimeProbe()
  const required = requiredVersions()
  const outdated = VERSIONED_PACKAGES.flatMap((name) => {
    const want = required.get(name)
    const have = probe.packages[name]
    return want && have && versionBelow(have, want) ? [`${name} ${have} → ${want}`] : []
  })
  if (outdated.length === 0) return base
  return {
    ...base,
    available: false,
    message: `임베딩에 필요한 패키지 버전이 낮아 (${outdated.join(', ')}). 설정 › 자동 › AI 런타임에서 다시 설치해줘.`,
  }
}

/** The runtime checks; a seam so tests can run the Node side without Python. */
export const embeddingRuntime = {
  checkDependencies: checkEmbeddingDependencies,
  isModelCached: () => isEmbeddingModelCached(),
  /** After a failure (no runtime, download failed) embeddings rest this long instead of failing every chat turn. */
  failureRestMs: 5 * 60_000,
}

/**
 * Threads for one request: background work runs on half while the vision worker is busy too (tagging and indexing
 * at once would otherwise ask for twice the cores); undefined keeps the worker's default.
 */
function requestThreads(priority: AiWorkerPriority) {
  if (priority !== 'low' || visionWorker.status().queued === 0) return undefined
  return Math.max(1, Math.floor(aiThreads() / 2))
}

export type EmbedKind = 'query' | 'document' | 'similarity'
export type EmbedItem = { text: string; title?: string | null }
export type EmbeddedChunk = { start: number; end: number; vector: Float32Array }
export type EmbeddingFeature = 'chatRecall' | 'lorebook' | 'chatHistory' | 'fileSearch' | 'imageSearch' | 'postSearch'

export function embeddingSettings(): EmbeddingSettings {
  return settingsService.loadSettings().embedding
}

/** Whether embeddings are on for this use (the runtime may still be missing; callers fall back on failure). */
export function embeddingFeatureOn(feature: EmbeddingFeature) {
  const settings = embeddingSettings()
  return settings.enabled && settings[feature] === true
}

/** Which instance the worker keeps: "full" (vision tower too) while image search is on, else text only. */
export function embeddingVariant(settings: EmbeddingSettings = embeddingSettings()): 'full' | 'text' {
  return settings.enabled && settings.imageSearch ? 'full' : 'text'
}

export function isEmbeddingModelCached() {
  return isHubModelCached(EMBEDDING_REPO, EMBEDDING_FILE)
}

let unavailableUntil = 0
let lastFailure: string | null = null

export function embeddingFailure() {
  return Date.now() < unavailableUntil ? lastFailure : null
}

function decodeVector(base64: string) {
  const bytes = Buffer.from(base64, 'base64')
  // Copied: a Buffer's offset into its pool need not be 4-byte aligned.
  return new Float32Array(new Uint8Array(bytes).buffer)
}

let pendingDependencyCheck: Promise<void> | null = null

/** A loaded model already proved its dependencies work. Recheck after unload/restart, not on each query. */
async function ensureEmbeddingDependencies() {
  if (embeddingModelWarm()) return
  if (pendingDependencyCheck) return pendingDependencyCheck
  const work = embeddingRuntime.checkDependencies().then((dependencies) => {
    if (!dependencies.available) throw new Error(dependencies.message)
  }).finally(() => {
    if (pendingDependencyCheck === work) pendingDependencyCheck = null
  })
  pendingDependencyCheck = work
  return work
}

/**
 * Embed texts; documents may be split into token windows (`chunkTokens`, `overlapTokens`, at most `maxChunks`), each
 * returned with its character span. Throws when the runtime is missing or the worker fails.
 */
export async function embedTexts(
  items: EmbedItem[],
  kind: EmbedKind,
  options: { priority?: AiWorkerPriority; chunkTokens?: number; overlapTokens?: number; maxChunks?: number } = {},
): Promise<EmbeddedChunk[][]> {
  if (items.length === 0) return []
  if (Date.now() < unavailableUntil) throw new Error(lastFailure ?? 'Embeddings are unavailable')
  const priority = options.priority ?? 'normal'
  try {
    await ensureEmbeddingDependencies()
    const reply = await textWorker.request<{ device: string; items: Array<Array<{ start: number; end: number; vector: string }>> }>('embed', {
      items: items.map((item) => ({ text: item.text, ...(item.title ? { title: item.title } : {}) })),
      kind,
      dim: EMBEDDING_DIM,
      device: 'cpu',
      variant: embeddingVariant(),
      chunkTokens: options.chunkTokens ?? 0,
      overlapTokens: options.overlapTokens ?? 0,
      maxChunks: options.maxChunks ?? 64,
      threads: requestThreads(priority),
    }, { priority })
    textWorker.touch('embedding', reply.device)
    return reply.items.map((chunks) => chunks.map((chunk) => ({ start: chunk.start, end: chunk.end, vector: decodeVector(chunk.vector) })))
  } catch (error) {
    noteFailure(error)
    throw error
  }
}

function noteFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  // A stopped worker (settings change, shutdown) is not a fault of the model.
  if ((error as { errorType?: string })?.errorType !== 'WorkerStopped') {
    unavailableUntil = Date.now() + embeddingRuntime.failureRestMs
    lastFailure = message
    console.warn('[TextEmbedding] unavailable for a while:', message)
  }
}

/**
 * Image vectors for files on disk, in order: a vector, or the reason that file could not be read (the batch itself
 * throws when the runtime is missing or the worker fails).
 */
export async function embedImages(paths: string[], options: { priority?: AiWorkerPriority } = {}): Promise<Array<Float32Array | { error: string }>> {
  if (paths.length === 0) return []
  if (Date.now() < unavailableUntil) throw new Error(lastFailure ?? 'Embeddings are unavailable')
  const priority = options.priority ?? 'low'
  try {
    await ensureEmbeddingDependencies()
    const reply = await textWorker.request<{ device: string; items: Array<{ vector?: string; error?: string }> }>('embed_images', {
      images: paths, dim: IMAGE_EMBEDDING_DIM, device: 'cpu', threads: requestThreads(priority),
    }, { priority })
    textWorker.touch('embedding', reply.device)
    return reply.items.map((item) => (item.vector ? decodeVector(item.vector) : { error: item.error ?? 'Image could not be embedded' }))
  } catch (error) {
    noteFailure(error)
    throw error
  }
}

/**
 * Load the model now, downloading it first when it is missing (low priority: anything else waiting goes first), so
 * turning embeddings on fetches the weights right away instead of on the first chat turn. False when it failed.
 */
export async function warmEmbeddingModel(): Promise<boolean> {
  if (!embeddingSettings().enabled || Date.now() < unavailableUntil) return false
  try {
    await ensureEmbeddingDependencies()
    await textWorker.request('load', { model: 'embedding', options: { device: 'cpu', variant: embeddingVariant() } }, { priority: 'low' })
    textWorker.touch('embedding', 'cpu')
    return true
  } catch (error) {
    noteFailure(error)
    return false
  }
}

/** Clear the failure backoff (the runtime was installed, settings changed). */
export function resetEmbeddingBackoff() {
  unavailableUntil = 0
  lastFailure = null
  pendingDependencyCheck = null
  queryVectors.clear()
  pendingQueries.clear()
}

// Query vectors depend on the model and task, not the changing image index. Keep a bounded LRU separately
// from search results, and share pending work even after an individual caller's wait deadline expires.
const QUERY_CACHE_SIZE = 128
const queryVectors = new Map<string, Float32Array>()
const pendingQueries = new Map<string, Promise<Float32Array | null>>()

function queryVector(text: string, kind: EmbedKind): Promise<Float32Array | null> {
  const key = JSON.stringify([EMBEDDING_MODEL_KEY, embeddingVariant(), kind, text])
  const cached = queryVectors.get(key)
  if (cached) {
    queryVectors.delete(key)
    queryVectors.set(key, cached)
    return Promise.resolve(cached)
  }
  const pending = pendingQueries.get(key)
  if (pending) return pending
  const work = embedTexts([{ text }], kind, { priority: 'high' })
    .then((items) => {
      const vector = items[0]?.[0]?.vector ?? null
      // A settings/runtime reset must not be undone by an old request finishing afterwards.
      if (vector && pendingQueries.get(key) === work) {
        queryVectors.set(key, vector)
        while (queryVectors.size > QUERY_CACHE_SIZE) queryVectors.delete(queryVectors.keys().next().value as string)
      }
      return vector
    })
    .catch(() => null)
    .finally(() => {
      if (pendingQueries.get(key) === work) pendingQueries.delete(key)
    })
  pendingQueries.set(key, work)
  return work
}

/**
 * One search query's vector, or null when embeddings are off, failing, or slower than `waitMs`. A query that runs out
 * of time still finishes in the worker, so a cold model is warm for the next one.
 */
export async function embedQuery(text: string, options: { waitMs?: number; kind?: EmbedKind } = {}): Promise<Float32Array | null> {
  const trimmed = text.trim()
  if (!trimmed || !embeddingSettings().enabled || Date.now() < unavailableUntil) return null
  // Return a copy so a consumer cannot change a vector cached for other searches.
  const work = queryVector(trimmed, options.kind ?? 'query').then((vector) => vector?.slice() ?? null)
  if (!options.waitMs) return work
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), options.waitMs) })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Several queries in one request (null as for embedQuery). */
export async function embedQueries(texts: string[], options: { waitMs?: number } = {}): Promise<Float32Array[] | null> {
  const trimmed = texts.map((text) => text.trim())
  if (trimmed.length === 0 || trimmed.some((text) => !text) || !embeddingSettings().enabled || Date.now() < unavailableUntil) return null
  const work = embedTexts(trimmed.map((text) => ({ text })), 'query', { priority: 'high' })
    .then((items) => (items.every((chunks) => chunks[0]) ? items.map((chunks) => chunks[0].vector) : null))
    .catch(() => null)
  if (!options.waitMs) return work
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), options.waitMs) })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Whether the model is loaded right now (a query then answers in well under a second). */
export function embeddingModelWarm() {
  return textWorker.loadedModels().has('embedding')
}
