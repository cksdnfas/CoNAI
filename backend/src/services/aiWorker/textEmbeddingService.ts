import type { EmbeddingSettings } from '@conai/shared'
import { settingsService } from '../settingsService'
import { AiWorkerClient, type AiWorkerPriority } from './aiWorkerClient'
import { aiThreads, checkAiDependencies, isHubModelCached } from './aiVisionService'

export const EMBEDDING_MODEL = 'embeddinggemma-2'
export const EMBEDDING_REPO = 'google/embeddinggemma-2'
export const EMBEDDING_FILE = 'model.safetensors'
export const EMBEDDING_DIM = 256
/** Vector store key: model, pinned revision (worker_embedding.py) and dimension. Another key re-embeds everything. */
export const EMBEDDING_MODEL_KEY = 'embeddinggemma-2@914f7f8/256'
/** Image vectors: same model and space as text queries, at 140 image tokens (worker_embedding.py IMAGE_TOKENS). */
export const IMAGE_EMBEDDING_MODEL_KEY = 'embeddinggemma-2@914f7f8/256/img140'

/**
 * The worker process for embeddings, apart from the vision worker so a chat's query never waits behind image
 * tagging. Always CPU, bf16: text modules only (~1.3 GB), or with the vision tower while image search is on (~2.2 GB;
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

/** The runtime check before a request; a seam so tests can run the Node side without Python. */
export const embeddingRuntime = {
  checkDependencies: checkAiDependencies,
}

export type EmbedKind = 'query' | 'document' | 'similarity'
export type EmbedItem = { text: string; title?: string | null }
export type EmbeddedChunk = { start: number; end: number; vector: Float32Array }
export type EmbeddingFeature = 'chatRecall' | 'lorebook' | 'chatHistory' | 'fileSearch' | 'imageSearch'

export function embeddingSettings(): EmbeddingSettings {
  return settingsService.loadSettings().embedding
}

/** Whether embeddings are on for this use (the runtime may still be missing; callers fall back on failure). */
export function embeddingFeatureOn(feature: EmbeddingFeature) {
  const settings = embeddingSettings()
  return settings.enabled && settings[feature]
}

/** Which instance the worker keeps: "full" (vision tower too) while image search is on, else text only. */
export function embeddingVariant(settings: EmbeddingSettings = embeddingSettings()): 'full' | 'text' {
  return settings.enabled && settings.imageSearch ? 'full' : 'text'
}

export function isEmbeddingModelCached() {
  return isHubModelCached(EMBEDDING_REPO, EMBEDDING_FILE)
}

/** After a failure (no runtime, download failed) embeddings rest a while instead of failing every chat turn. */
const FAILURE_BACKOFF_MS = 5 * 60_000
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
  try {
    const dependencies = await embeddingRuntime.checkDependencies()
    if (!dependencies.available) throw new Error(dependencies.message)
    const reply = await textWorker.request<{ device: string; items: Array<Array<{ start: number; end: number; vector: string }>> }>('embed', {
      items: items.map((item) => ({ text: item.text, ...(item.title ? { title: item.title } : {}) })),
      kind,
      dim: EMBEDDING_DIM,
      device: 'cpu',
      variant: embeddingVariant(),
      chunkTokens: options.chunkTokens ?? 0,
      overlapTokens: options.overlapTokens ?? 0,
      maxChunks: options.maxChunks ?? 64,
    }, { priority: options.priority ?? 'normal' })
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
    unavailableUntil = Date.now() + FAILURE_BACKOFF_MS
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
  try {
    const dependencies = await embeddingRuntime.checkDependencies()
    if (!dependencies.available) throw new Error(dependencies.message)
    const reply = await textWorker.request<{ device: string; items: Array<{ vector?: string; error?: string }> }>('embed_images', {
      images: paths, dim: EMBEDDING_DIM, device: 'cpu',
    }, { priority: options.priority ?? 'low' })
    textWorker.touch('embedding', reply.device)
    return reply.items.map((item) => (item.vector ? decodeVector(item.vector) : { error: item.error ?? 'Image could not be embedded' }))
  } catch (error) {
    noteFailure(error)
    throw error
  }
}

/** Clear the failure backoff (the runtime was installed, settings changed). */
export function resetEmbeddingBackoff() {
  unavailableUntil = 0
  lastFailure = null
}

/**
 * One search query's vector, or null when embeddings are off, failing, or slower than `waitMs`. A query that runs out
 * of time still finishes in the worker, so a cold model is warm for the next one.
 */
export async function embedQuery(text: string, options: { waitMs?: number; kind?: EmbedKind } = {}): Promise<Float32Array | null> {
  const trimmed = text.trim()
  if (!trimmed || !embeddingSettings().enabled || Date.now() < unavailableUntil) return null
  const work = embedTexts([{ text: trimmed }], options.kind ?? 'query', { priority: 'high' })
    .then((items) => items[0]?.[0]?.vector ?? null)
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
