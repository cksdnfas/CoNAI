/**
 * NovelAI quality tags and Undesired Content (UC) presets, per model family.
 *
 * The NovelAI web UI composes these into the prompts itself: the quality tags go after the positive prompt and the
 * chosen UC preset text goes before the user's negative prompt. The API does not add them on its own (a V5 request
 * with an empty negative prompt returns an image whose metadata `uc` is empty), so CoNAI composes them the same way.
 *
 * Texts follow NovelAI web UI requests. V5 quality tags and the V5 Heavy preset were confirmed from a captured
 * request; V5 Light and Human Focus are not captured yet and reuse the V4.5 Full texts.
 */

export const NAI_UC_PRESET_IDS = ['none', 'heavy', 'light', 'human_focus'] as const
export type NaiUcPresetId = (typeof NAI_UC_PRESET_IDS)[number]
export type NaiPromptPresetFamily = 'v5' | 'v4-5-full' | 'v4-5-curated' | 'v4-full' | 'v4-curated'

type NaiPromptPresetSet = {
  /** Appended to the positive prompt as is, so it carries its leading separator. */
  qualityTags: string
  ucPresets: Partial<Record<Exclude<NaiUcPresetId, 'none'>, string>>
}

const UC_V4_5_FULL = {
  heavy: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
  light: 'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
  human_focus: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy',
}

const NAI_PROMPT_PRESETS: Record<NaiPromptPresetFamily, NaiPromptPresetSet> = {
  v5: {
    qualityTags: ', very aesthetic, masterpiece, no text',
    ucPresets: UC_V4_5_FULL,
  },
  'v4-5-full': {
    qualityTags: ', location, very aesthetic, masterpiece, no text',
    ucPresets: UC_V4_5_FULL,
  },
  'v4-5-curated': {
    qualityTags: ', location, masterpiece, no text, -0.8::feet::, rating:general',
    ucPresets: {
      heavy: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page',
      light: 'blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page',
      human_focus: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page',
    },
  },
  'v4-full': {
    qualityTags: ', no text, best quality, very aesthetic, absurdres',
    ucPresets: {
      heavy: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks',
      light: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing',
    },
  },
  'v4-curated': {
    qualityTags: ', rating:general, amazing quality, very aesthetic, absurdres',
    ucPresets: {
      heavy: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts',
      light: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature',
    },
  },
}

export function isNaiUcPresetId(value: unknown): value is NaiUcPresetId {
  return typeof value === 'string' && (NAI_UC_PRESET_IDS as readonly string[]).includes(value)
}

/** Preset family of an API model name (inpainting variants included); null for models without presets (V3). */
export function resolveNaiPromptPresetFamily(model: string | null | undefined): NaiPromptPresetFamily | null {
  const value = (model ?? '').trim()
  if (value.startsWith('nai-diffusion-5')) return 'v5'
  if (value.startsWith('nai-diffusion-4-5-full')) return 'v4-5-full'
  if (value.startsWith('nai-diffusion-4-5-curated')) return 'v4-5-curated'
  if (value.startsWith('nai-diffusion-4-full')) return 'v4-full'
  if (value.startsWith('nai-diffusion-4-curated')) return 'v4-curated'
  return null
}

/** Quality tags of the model with their leading separator; null when the model has none. */
export function getNaiQualityTags(model: string | null | undefined): string | null {
  const family = resolveNaiPromptPresetFamily(model)
  return family ? NAI_PROMPT_PRESETS[family].qualityTags : null
}

/** UC presets the model offers, `none` first; only `none` for models without presets. */
export function getNaiUcPresetIds(model: string | null | undefined): NaiUcPresetId[] {
  const family = resolveNaiPromptPresetFamily(model)
  if (!family) return ['none']
  const presets = NAI_PROMPT_PRESETS[family].ucPresets
  return NAI_UC_PRESET_IDS.filter((id) => id === 'none' || Boolean(presets[id]))
}

/** Text of one UC preset (`''` for `none`); null when the model does not offer that preset. */
export function getNaiUcPresetText(model: string | null | undefined, preset: NaiUcPresetId): string | null {
  if (preset === 'none') return ''
  const family = resolveNaiPromptPresetFamily(model)
  return family ? NAI_PROMPT_PRESETS[family].ucPresets[preset] ?? null : null
}

/** Positive prompt with the model's quality tags after it; null when enabled for a model without quality tags. */
export function appendNaiQualityTags(model: string | null | undefined, prompt: string, enabled: boolean): string | null {
  if (!enabled) return prompt
  const tags = getNaiQualityTags(model)
  if (tags === null) return null
  const trimmed = prompt.trim()
  return trimmed ? `${trimmed}${tags}` : tags.replace(/^,\s*/, '')
}

/** Negative prompt with the UC preset text before it; null when the model does not offer that preset. */
export function prependNaiUcPreset(model: string | null | undefined, negativePrompt: string, preset: NaiUcPresetId): string | null {
  const text = getNaiUcPresetText(model, preset)
  if (text === null) return null
  const trimmed = negativePrompt.trim()
  if (!text) return trimmed
  return trimmed ? `${text}, ${trimmed}` : text
}
