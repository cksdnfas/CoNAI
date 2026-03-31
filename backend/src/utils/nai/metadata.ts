/**
 * NovelAI metadata normalization helpers shared by direct generation and graph execution.
 */

export type NAIRatingMode = 'general' | 'sensitive' | 'questionable' | 'explicit'

export interface NAICharacterPrompt {
  prompt: string
  uc?: string
  center_x?: number
  center_y?: number
}

export interface NAIVibeTransfer {
  encoded: string
  strength?: number
  information_extracted?: number
}

export interface NAICharacterReference {
  image: string
  type?: 'character' | 'style' | 'character&style'
  strength?: number
  fidelity?: number
}

export interface NAIMetadataParams {
  prompt: string
  negative_prompt?: string
  model?: string
  action?: 'generate' | 'img2img' | 'infill' | string
  width?: number
  height?: number
  steps?: number
  scale?: number
  sampler?: string
  variety_plus?: boolean
  n_samples?: number
  seed?: number
  ucPreset?: number
  uncond_scale?: number
  cfg_rescale?: number
  noise_schedule?: string
  rating?: NAIRatingMode
  quality_tags_enabled?: boolean
  image?: string
  strength?: number
  noise?: number
  extra_noise_seed?: number
  mask?: string
  add_original_image?: boolean
  reference_image_multiple?: string[]
  reference_information_extracted_multiple?: number[]
  reference_strength_multiple?: number[]
  director_reference_images?: string[]
  director_reference_information_extracted?: number[]
  director_reference_strength_values?: number[]
  director_reference_secondary_strength_values?: number[]
  director_reference_descriptions?: Array<Record<string, unknown>>
  characters?: NAICharacterPrompt[]
  vibes?: NAIVibeTransfer[]
  character_refs?: NAICharacterReference[]
  groupId?: number
}

export interface NAIMetadataInputParams extends Omit<NAIMetadataParams, 'characters' | 'vibes' | 'character_refs'> {
  characters?: NAICharacterPrompt[] | string
  vibes?: NAIVibeTransfer[] | string
  character_refs?: NAICharacterReference[] | string
}

const QUALITY_TAGS_BY_MODEL: Record<string, string> = {
  'nai-diffusion-4-5-full': ', location, very aesthetic, masterpiece, no text',
  'nai-diffusion-4-5-curated': ', location, very aesthetic, masterpiece, no text',
  'nai-diffusion-4-curated-preview': ', no text, amazing quality, very aesthetic, absurdres',
  'nai-diffusion-3': ', best quality, amazing quality, very aesthetic, absurdres',
}

const RATING_PROMPT_TAGS: Record<NAIRatingMode, string> = {
  general: 'rating:general, safe',
  sensitive: 'rating:sensitive',
  questionable: 'rating:questionable, nsfw',
  explicit: 'rating:explicit, nsfw',
}

const RATING_NEGATIVE_TAGS: Partial<Record<NAIRatingMode, string>> = {
  general: 'nsfw',
  sensitive: 'nsfw',
}

const CHARACTER_GRID_VALUES = [0.1, 0.3, 0.5, 0.7, 0.9] as const

/** Parse JSON-or-array payloads into a safe array shape. */
function normalizeListInput(value: unknown): unknown[] {
  if (!value) {
    return []
  }

  let source: unknown = value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return []
    }

    try {
      source = JSON.parse(trimmed)
    } catch {
      return []
    }
  }

  return Array.isArray(source) ? source : []
}

/** Snap one character coordinate onto the documented 5x5 grid. */
function snapCharacterGridValue(value: number) {
  return CHARACTER_GRID_VALUES.reduce((best, candidate) => (
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best
  ), 0.5)
}

/** Normalize character prompt rows into a typed payload. */
function normalizeCharacters(value: NAIMetadataInputParams['characters']): NAICharacterPrompt[] {
  const normalized: NAICharacterPrompt[] = []

  for (const entry of normalizeListInput(value)) {
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const rawEntry = entry as Record<string, unknown>
    const prompt = typeof rawEntry.prompt === 'string' ? rawEntry.prompt.trim() : ''
    if (!prompt) {
      continue
    }

    const centerX = typeof rawEntry.center_x === 'number' ? rawEntry.center_x : Number(rawEntry.center_x ?? 0.5)
    const centerY = typeof rawEntry.center_y === 'number' ? rawEntry.center_y : Number(rawEntry.center_y ?? 0.5)

    normalized.push({
      prompt,
      uc: typeof rawEntry.uc === 'string' ? rawEntry.uc.trim() : undefined,
      center_x: snapCharacterGridValue(Number.isFinite(centerX) ? centerX : 0.5),
      center_y: snapCharacterGridValue(Number.isFinite(centerY) ? centerY : 0.5),
    })
  }

  if (normalized.length === 1) {
    return normalized.map((character) => ({
      ...character,
      center_x: 0.5,
      center_y: 0.5,
    }))
  }

  return normalized
}

/** Normalize vibe-transfer entries into a typed payload. */
function normalizeVibes(value: NAIMetadataInputParams['vibes']): NAIVibeTransfer[] {
  const normalized: NAIVibeTransfer[] = []

  for (const entry of normalizeListInput(value)) {
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const rawEntry = entry as Record<string, unknown>
    const encoded = typeof rawEntry.encoded === 'string' ? rawEntry.encoded.trim() : ''
    if (!encoded) {
      continue
    }

    const strength = typeof rawEntry.strength === 'number' ? rawEntry.strength : Number(rawEntry.strength ?? 0.6)
    const informationExtracted = typeof rawEntry.information_extracted === 'number'
      ? rawEntry.information_extracted
      : Number(rawEntry.information_extracted ?? 1)

    normalized.push({
      encoded,
      strength: Number.isFinite(strength) ? strength : 0.6,
      information_extracted: Number.isFinite(informationExtracted) ? informationExtracted : 1,
    })
  }

  return normalized
}

/** Normalize character-reference entries into a typed payload. */
function normalizeCharacterReferences(value: NAIMetadataInputParams['character_refs']): NAICharacterReference[] {
  const normalized: NAICharacterReference[] = []

  for (const entry of normalizeListInput(value)) {
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const rawEntry = entry as Record<string, unknown>
    const image = typeof rawEntry.image === 'string' ? rawEntry.image.trim() : ''
    if (!image) {
      continue
    }

    const strength = typeof rawEntry.strength === 'number' ? rawEntry.strength : Number(rawEntry.strength ?? 0.6)
    const fidelity = typeof rawEntry.fidelity === 'number' ? rawEntry.fidelity : Number(rawEntry.fidelity ?? 1)
    const type = rawEntry.type === 'character' || rawEntry.type === 'style' || rawEntry.type === 'character&style'
      ? rawEntry.type
      : 'character&style'

    normalized.push({
      image,
      type,
      strength: Number.isFinite(strength) ? strength : 0.6,
      fidelity: Number.isFinite(fidelity) ? fidelity : 1,
    })
  }

  return normalized
}

/** Append a comma-separated prompt suffix while avoiding simple duplicates. */
function appendPromptSuffix(base: string, suffix: string) {
  const trimmedBase = base.trim()
  const normalizedSuffix = suffix.trim().replace(/^,\s*/, '')
  if (!normalizedSuffix) {
    return trimmedBase
  }

  const lowerBase = trimmedBase.toLowerCase()
  const lowerSuffix = normalizedSuffix.toLowerCase()
  if (lowerBase.includes(lowerSuffix)) {
    return trimmedBase
  }

  return trimmedBase.length > 0 ? `${trimmedBase}, ${normalizedSuffix}` : normalizedSuffix
}

/** Apply rating and quality-tag helpers so generated prompts match the requested mode. */
function applyPromptEnhancers(prompt: string, negativePrompt: string, model: string, rating: NAIRatingMode, qualityTagsEnabled: boolean) {
  let nextPrompt = prompt.trim()
  let nextNegativePrompt = negativePrompt.trim()

  nextPrompt = appendPromptSuffix(nextPrompt, RATING_PROMPT_TAGS[rating])
  if (RATING_NEGATIVE_TAGS[rating]) {
    nextNegativePrompt = appendPromptSuffix(nextNegativePrompt, RATING_NEGATIVE_TAGS[rating]!)
  }

  if (qualityTagsEnabled) {
    nextPrompt = appendPromptSuffix(nextPrompt, QUALITY_TAGS_BY_MODEL[model] ?? '')
  }

  return {
    prompt: nextPrompt,
    negativePrompt: nextNegativePrompt,
  }
}

/** Normalize and enrich one NovelAI payload before request building. */
export function preprocessMetadata(params: NAIMetadataInputParams): NAIMetadataParams {
  const metadata: NAIMetadataParams = {
    ...params,
    prompt: typeof params.prompt === 'string' ? params.prompt.trim() : '',
    negative_prompt: typeof params.negative_prompt === 'string' ? params.negative_prompt.trim() : '',
    characters: normalizeCharacters(params.characters),
    vibes: normalizeVibes(params.vibes),
    character_refs: normalizeCharacterReferences(params.character_refs),
  }

  metadata.model = metadata.model || 'nai-diffusion-4-5-curated'
  metadata.action = metadata.action || 'generate'
  metadata.width = metadata.width || 1024
  metadata.height = metadata.height || 1024
  metadata.steps = metadata.steps || 28
  metadata.scale = metadata.scale || 6.0
  metadata.sampler = metadata.sampler || 'k_euler'
  metadata.variety_plus = metadata.variety_plus ?? false
  metadata.n_samples = metadata.n_samples || 1
  metadata.seed = metadata.seed || Math.floor(Math.random() * 4294967288)
  metadata.uncond_scale = metadata.uncond_scale ?? 1.0
  metadata.cfg_rescale = metadata.cfg_rescale ?? 0.0
  metadata.noise_schedule = metadata.noise_schedule || 'karras'
  metadata.rating = metadata.rating || 'sensitive'
  metadata.quality_tags_enabled = metadata.quality_tags_enabled ?? true

  const promptBundle = applyPromptEnhancers(
    metadata.prompt,
    metadata.negative_prompt || '',
    metadata.model,
    metadata.rating,
    metadata.quality_tags_enabled,
  )
  metadata.prompt = promptBundle.prompt
  metadata.negative_prompt = promptBundle.negativePrompt

  if (metadata.action === 'img2img' || metadata.action === 'infill') {
    metadata.strength = metadata.strength || 0.3
    metadata.noise = metadata.noise || 0
    metadata.extra_noise_seed = metadata.extra_noise_seed || Math.floor(Math.random() * 4294967288)
  }

  return metadata
}
