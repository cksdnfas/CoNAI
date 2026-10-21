import sharp from 'sharp'
import { isNaiV5Model, NAI_INFILL_DEFAULT_STRENGTH, resolveNaiRequestModel } from '@conai/shared'
import { normalizeBase64ImageData } from '../base64ImageData'
import { type NAICharacterReference, type NAICharacterPrompt, type NAIMetadataParams } from './metadata'
import { normalizeNaiWeightSyntax } from './weightSyntax'

export { normalizeBase64ImageData }

/** Decode a raw base64 string or data URL into a binary buffer. */
function decodeBase64Image(value: string) {
  return Buffer.from(normalizeBase64ImageData(value) ?? value, 'base64')
}

/** Pick the nearest NAI reference canvas for character-reference images. */
function getCharacterReferenceCanvas(width: number, height: number) {
  if (Math.abs(width - height) < Math.min(width, height) * 0.12) {
    return { width: 1472, height: 1472 }
  }

  return width >= height
    ? { width: 1536, height: 1024 }
    : { width: 1024, height: 1536 }
}

/** Letterbox one reference image into the NAI-friendly director-reference canvas. */
async function buildCharacterReferenceImage(image: string) {
  const input = decodeBase64Image(image)
  const metadata = await sharp(input).metadata()
  const canvas = getCharacterReferenceCanvas(metadata.width ?? 1024, metadata.height ?? 1024)

  return sharp(input)
    .resize(canvas.width, canvas.height, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer()
}

/** Convert typed character prompts into the v4 caption payload shape. */
function buildCharacterPromptPayload(characters: NAICharacterPrompt[]) {
  return characters
    .filter((entry) => typeof entry.prompt === 'string' && entry.prompt.trim().length > 0)
    .map((entry) => {
      const center = {
        x: typeof entry.center_x === 'number' ? entry.center_x : 0.5,
        y: typeof entry.center_y === 'number' ? entry.center_y : 0.5,
      }

      return {
        prompt: normalizeNaiWeightSyntax(entry.prompt.trim()),
        uc: normalizeNaiWeightSyntax((entry.uc || '').trim()),
        center,
      }
    })
}

const NAI_V5_TRANSPARENT_BACKGROUND_PROMPT_SEGMENTS = [
  { needle: 'transparent background', segment: '2.0::transparent background::' },
  { needle: 'has alpha', segment: '1.7::has alpha::' },
  { needle: 'alpha transparency', segment: '1.5::alpha transparency::' },
] as const

/** Add the V5 alpha prompt segments while preserving manually supplied equivalents. */
function buildTransparentBackgroundPrompt(prompt: string) {
  const normalizedPrompt = prompt.trim()
  const lowerPrompt = normalizedPrompt.toLowerCase()
  const missingSegments = NAI_V5_TRANSPARENT_BACKGROUND_PROMPT_SEGMENTS
    .filter(({ needle }) => !lowerPrompt.includes(needle))
    .map(({ segment }) => segment)

  return [...missingSegments, normalizedPrompt].filter(Boolean).join(', ')
}

/** Build a direct NovelAI request body from normalized metadata. */
export async function buildNaiRequestBody(metadata: NAIMetadataParams) {
  const isV4Family = metadata.model?.includes('nai-diffusion-4')
  const isV5Family = isNaiV5Model(metadata.model)
  const usesStructuredPrompts = isV4Family || isV5Family
  const effectivePrompt = normalizeNaiWeightSyntax(isV5Family && metadata.transparent_background
    ? buildTransparentBackgroundPrompt(metadata.prompt)
    : metadata.prompt)
  const negativePrompt = normalizeNaiWeightSyntax(metadata.negative_prompt || '')
  const baseParams: Record<string, unknown> = {
    params_version: isV5Family ? 4 : 3,
    width: metadata.width,
    height: metadata.height,
    scale: metadata.scale,
    sampler: metadata.sampler,
    steps: metadata.steps,
    n_samples: metadata.n_samples,
    seed: metadata.seed,
    noise_schedule: metadata.noise_schedule,
    legacy: false,
  }

  if (usesStructuredPrompts) {
    baseParams.autoSmea = false
    baseParams.variety_plus = metadata.variety_plus ?? false
    baseParams.uncond_scale = metadata.uncond_scale ?? 1.0
    baseParams.cfg_rescale = metadata.cfg_rescale ?? 0.7
    baseParams.dynamic_thresholding = false
    baseParams.controlnet_strength = 1.0
    baseParams.ucPreset = metadata.ucPreset || 0
    baseParams.add_original_image = true
    baseParams.legacy_v3_extend = false
    baseParams.skip_cfg_above_sigma = null
    baseParams.use_coords = false
    baseParams.normalize_reference_strength_multiple = true
    baseParams.inpaintImg2ImgStrength = 1
    baseParams.legacy_uc = false
    baseParams.deliberate_euler_ancestral_bug = false
    baseParams.prefer_brownian = true
    baseParams.stream = 'msgpack'
    baseParams.negative_prompt = negativePrompt

    const characterPrompts = buildCharacterPromptPayload(metadata.characters || [])
    const useCoords = typeof metadata.use_coords === 'boolean' ? metadata.use_coords : characterPrompts.length > 0
    baseParams.characterPrompts = characterPrompts
    baseParams.use_coords = useCoords
    baseParams.v4_prompt = {
      caption: {
        base_caption: effectivePrompt,
        char_captions: characterPrompts.map((entry) => ({
          char_caption: entry.prompt,
          centers: [entry.center],
        })),
      },
      use_coords: useCoords,
      use_order: true,
      legacy_uc: false,
    }
    baseParams.v4_negative_prompt = {
      caption: {
        base_caption: negativePrompt,
        char_captions: characterPrompts.map((entry) => ({
          char_caption: entry.uc,
          centers: [entry.center],
        })),
      },
      use_coords: useCoords,
      use_order: false,
      legacy_uc: false,
    }
  } else {
    baseParams.params_version = 1
    baseParams.ucPreset = metadata.ucPreset || 0
    baseParams.negative_prompt = negativePrompt
  }

  if (metadata.upscaled_enhance) {
    baseParams.upscaled_enhance = true
  }

  if (metadata.image) {
    baseParams.image = normalizeBase64ImageData(metadata.image)
    baseParams.strength = metadata.strength
    baseParams.noise = metadata.noise
    baseParams.extra_noise_seed = metadata.extra_noise_seed
  }

  if (metadata.mask) {
    baseParams.add_original_image = metadata.add_original_image ?? true
    baseParams.mask = normalizeBase64ImageData(metadata.mask)
  }

  if (metadata.action === 'infill') {
    baseParams.request_type = 'NativeInfillingRequest'
    baseParams.inpaintImg2ImgStrength = metadata.strength ?? 1
    baseParams.noise = 0
    baseParams.controlnet_strength = 1
    // V4 이상 인페인트 서버는 평면 inpaintImg2ImgStrength 가 아니라 중첩 img2img.strength 를 강도로 읽는다(웹 UI 와 동일).
    if (usesStructuredPrompts) {
      baseParams.img2img = { strength: metadata.strength ?? NAI_INFILL_DEFAULT_STRENGTH, color_correct: true }
    }
  }

  if (metadata.vibes && metadata.vibes.length > 0) {
    if (isV5Family) {
      throw new Error('Vibe Transfer is not available for NAI Diffusion V5 yet')
    }
    baseParams.reference_image_multiple = metadata.vibes.map((entry) => entry.encoded)
    baseParams.reference_information_extracted_multiple = metadata.vibes.map((entry) => entry.information_extracted ?? 1)
    baseParams.reference_strength_multiple = metadata.vibes.map((entry) => entry.strength ?? 0.6)
    baseParams.normalize_reference_strength_multiple = true
  }

  if (metadata.character_refs && metadata.character_refs.length > 0) {
    if (!metadata.model?.includes('nai-diffusion-4-5')) {
      throw new Error('Character reference is only supported on NAI Diffusion 4.5 models')
    }

    const directorImages = await Promise.all(
      metadata.character_refs.map((entry: NAICharacterReference) => buildCharacterReferenceImage(entry.image)),
    )

    baseParams.director_reference_images = directorImages.map((entry) => entry.toString('base64'))
    baseParams.director_reference_strength_values = metadata.character_refs.map((entry) => entry.strength ?? 0.6)
    baseParams.director_reference_secondary_strength_values = metadata.character_refs.map((entry) => 1 - (entry.fidelity ?? 1))
    baseParams.director_reference_descriptions = metadata.character_refs.map((entry) => ({
      caption: {
        base_caption: entry.type || 'character&style',
        char_captions: [],
      },
      legacy_uc: false,
    }))
    baseParams.director_reference_information_extracted = metadata.character_refs.map(() => 1)
    baseParams.controlnet_strength = 1.0
    baseParams.inpaintImg2ImgStrength = metadata.action === 'infill' ? metadata.strength ?? 1 : 1.0
    baseParams.normalize_reference_strength_multiple = true
    delete baseParams.skip_cfg_above_sigma
  }

  return {
    input: effectivePrompt,
    model: resolveNaiRequestModel(metadata.model, metadata.action),
    action: metadata.action,
    parameters: baseParams,
    use_new_shared_trial: true,
  }
}
