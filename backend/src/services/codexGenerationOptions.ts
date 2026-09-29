import fs from 'fs'
import os from 'os'
import path from 'path'
import { z } from 'zod'

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

/** Best-effort suggestions only: never require a cache or restrict user-supplied model IDs to it. */
export async function getCodexModelSuggestions() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
  try {
    const cache = JSON.parse(await fs.promises.readFile(path.join(codexHome, 'models_cache.json'), 'utf8'))
    const models: Array<{ id: string; label: string }> = []
    for (const entry of Array.isArray(cache.models) ? cache.models : []) {
      if (!entry || typeof entry.slug !== 'string' || entry.visibility !== 'list' || models.some((model) => model.id === entry.slug)) continue
      models.push({ id: entry.slug, label: typeof entry.display_name === 'string' ? entry.display_name : entry.slug })
    }
    return { models, source: 'cli-cache' as const }
  } catch {
    return { models: [], source: 'unavailable' as const }
  }
}
