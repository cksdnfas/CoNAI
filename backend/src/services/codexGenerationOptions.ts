import fs from 'fs'
import os from 'os'
import path from 'path'
import { z } from 'zod'
import { isCodexReasoningEffort, type CodexModelOption, type CodexReasoningEffort } from '@conai/shared'

/** Request contract shared by the UI queue API, MCP, and the Codex queue worker. */
export const codexGenerationRequestSchema = z.object({
  prompt: z.string().trim().min(1).describe('User prompt; saved with the generated result.'),
  model: z.string().trim().max(200).regex(/^$|^[a-zA-Z0-9][a-zA-Z0-9._:/+-]*$/).optional()
    .describe('Codex agent model ID, passed to codex exec --model. Omit or leave empty to use the server CLI default. This is not an image-tool model ID.'),
  negative_prompt: z.string().optional(),
  operation: z.enum(['generate', 'edit', 'infill']).optional()
    .describe('generate: text-only or attached visual reference; edit: modify the attached image; infill: edit using image and mask. Default: generate.'),
  image: z.string().optional().describe('Reference/source image as a base64 data URL, as in the UI.'),
  mask: z.string().optional().describe('Mask as a base64 data URL. Requires image and operation=infill.'),
  size: z.string().regex(/^\d{2,5}x\d{2,5}$/i).optional().describe('Requested WIDTHxHEIGHT, e.g. 1024x1024; actual dimensions may differ.'),
  count: z.number().int().min(1).max(4).optional(),
  quality: z.string().optional(),
  background: z.enum(['auto', 'transparent', 'opaque']).optional(),
  output_format: z.enum(['png', 'jpeg', 'webp']).optional(),
  imageSaveOptions: z.object({
    format: z.enum(['original', 'png', 'jpeg', 'webp']).optional(),
    quality: z.number().min(1).max(100).optional(),
    resizeEnabled: z.boolean().optional(),
    maxWidth: z.number().int().positive().optional(),
    maxHeight: z.number().int().positive().optional(),
  }).optional().describe('Post-generation save settings, identical to the UI queue payload.'),
}).passthrough()

export function parseCodexGenerationRequest(value: unknown) {
  const request = codexGenerationRequestSchema.parse(value)
  const operation = request.operation ?? 'generate'
  if ((operation === 'edit' || operation === 'infill') && !request.image?.trim()) {
    throw new Error('Codex image editing requires an input image')
  }
  if (request.mask?.trim() && (!request.image?.trim() || operation !== 'infill')) {
    throw new Error('Codex masks require an input image and the infill operation')
  }
  if (operation === 'infill' && !request.mask?.trim()) {
    throw new Error('Codex infill requires a mask image')
  }
  return request
}

type CodexModelSuggestion = CodexModelOption
type CodexModelSuggestions = { models: CodexModelSuggestion[]; source: 'cli' | 'cli-cache' | 'unavailable' }

const MODEL_LIST_TTL_MS = 5 * 60 * 1000
const MODEL_LIST_TIMEOUT_MS = 20 * 1000
const MODEL_LIST_MAX_PAGES = 5
let modelListCache: { value: CodexModelSuggestions; expiresAt: number } | null = null
let modelListInFlight: Promise<CodexModelSuggestions> | null = null

function readReasoningEfforts(value: unknown, key: 'reasoningEffort' | 'effort'): CodexReasoningEffort[] | undefined {
  if (!Array.isArray(value)) return undefined
  return [...new Set(value.flatMap((entry) => {
    const effort: unknown = entry && typeof entry === 'object' ? entry[key] : undefined
    return isCodexReasoningEffort(effort) ? [effort] : []
  }))]
}

/** Ask a short-lived `codex app-server` for the account's visible models (`model/list`). */
async function listModelsFromAppServer(existingClient?: import('./codex-chat/codexAppServerClient').CodexAppServerClient): Promise<CodexModelSuggestion[]> {
  // Loaded lazily: the app-server client imports the executor, which imports this module.
  const { CodexAppServerClient } = await import('./codex-chat/codexAppServerClient')
  const client = existingClient ?? await CodexAppServerClient.start({ args: [], env: process.env, cwd: os.tmpdir() })
  try {
    const { config } = await client.request<{ config?: { model?: string | null } }>('config/read', { includeLayers: false }, MODEL_LIST_TIMEOUT_MS)
      .catch(() => ({ config: undefined }))
    const models: CodexModelSuggestion[] = []
    let cursor: string | null = null
    for (let page = 0; page < MODEL_LIST_MAX_PAGES; page++) {
      const result: { data?: unknown[]; nextCursor?: string | null } = await client.request<{ data?: unknown[]; nextCursor?: string | null }>(
        'model/list', { includeHidden: false, ...(cursor ? { cursor } : {}) }, MODEL_LIST_TIMEOUT_MS)
      for (const entry of Array.isArray(result?.data) ? result.data : []) {
        if (!entry || typeof entry !== 'object') continue
        const item = entry as { model?: unknown; id?: unknown; displayName?: unknown; hidden?: unknown; isDefault?: unknown; supportedReasoningEfforts?: unknown; defaultReasoningEffort?: unknown }
        const id = typeof item.model === 'string' ? item.model : typeof item.id === 'string' ? item.id : null
        if (!id || item.hidden === true || models.some((model) => model.id === id)) continue
        models.push({
          id, label: typeof item.displayName === 'string' ? item.displayName : id,
          isDefault: config ? (config.model ? config.model === id : item.isDefault === true) : false,
          supportedReasoningEfforts: readReasoningEfforts(item.supportedReasoningEfforts, 'reasoningEffort'),
          defaultReasoningEffort: isCodexReasoningEffort(item.defaultReasoningEffort) ? item.defaultReasoningEffort : undefined,
        })
      }
      cursor = typeof result?.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null
      if (!cursor) break
    }
    return models
  } finally {
    if (!existingClient) client.close()
  }
}

/** Fallback when the app-server can't answer: the model cache the CLI writes after it has run once. */
async function readModelsCacheFile(): Promise<CodexModelSuggestion[]> {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
  const cache = JSON.parse(await fs.promises.readFile(path.join(codexHome, 'models_cache.json'), 'utf8'))
  const models: CodexModelSuggestion[] = []
  for (const entry of Array.isArray(cache.models) ? cache.models : []) {
    if (!entry || typeof entry.slug !== 'string' || entry.visibility !== 'list' || models.some((model) => model.id === entry.slug)) continue
    models.push({
      id: entry.slug, label: typeof entry.display_name === 'string' ? entry.display_name : entry.slug,
      supportedReasoningEfforts: readReasoningEfforts(entry.supported_reasoning_levels, 'effort'),
      defaultReasoningEffort: isCodexReasoningEffort(entry.default_reasoning_level) ? entry.default_reasoning_level : undefined,
    })
  }
  return models
}

async function loadCodexModelSuggestions(): Promise<CodexModelSuggestions> {
  try {
    const models = await listModelsFromAppServer()
    if (models.length > 0) return { models, source: 'cli' }
  } catch (error) {
    console.warn('[Codex] model/list failed:', error instanceof Error ? error.message : error)
  }
  try {
    const models = await readModelsCacheFile()
    if (models.length > 0) return { models, source: 'cli-cache' }
  } catch {
    // No cache yet.
  }
  return { models: [], source: 'unavailable' }
}

/** Best-effort suggestions only: never require them or restrict user-supplied model IDs to them. */
export async function getCodexModelSuggestions(options: { client?: import('./codex-chat/codexAppServerClient').CodexAppServerClient; cacheOnly?: boolean } = {}): Promise<CodexModelSuggestions> {
  if (options.client) return { models: await listModelsFromAppServer(options.client), source: 'cli' }
  if (options.cacheOnly) {
    try { return { models: await readModelsCacheFile(), source: 'cli-cache' } }
    catch { return { models: [], source: 'unavailable' } }
  }
  if (modelListCache && modelListCache.expiresAt > Date.now()) return modelListCache.value
  modelListInFlight ??= loadCodexModelSuggestions().then((value) => {
    // Only a live answer is cached, so a login or CLI install shows up on the next request.
    modelListCache = value.source === 'cli' ? { value, expiresAt: Date.now() + MODEL_LIST_TTL_MS } : null
    return value
  }).finally(() => {
    modelListInFlight = null
  })
  return modelListInFlight
}
