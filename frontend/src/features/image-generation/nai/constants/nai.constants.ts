import type { NAIParams } from '../types/nai.types'

export const RESOLUTIONS = {
  '512×768': { width: 512, height: 768 },
  '768×512': { width: 768, height: 512 },
  '640×640': { width: 640, height: 640 },
  '832×1216': { width: 832, height: 1216 },
  '1216×832': { width: 1216, height: 832 },
  '1024×1024': { width: 1024, height: 1024 },
  '1024×1536': { width: 1024, height: 1536 },
  '1536×1024': { width: 1536, height: 1024 },
  '1088×1920': { width: 1088, height: 1920 },
  '1920×1088': { width: 1920, height: 1088 },
} as const

export const PARAMS_STORAGE_KEY = 'nai_generation_params'
export const GROUP_STORAGE_KEY = 'nai_selected_group_id'

export const NAI_MODEL_OPTIONS = [
  { value: 'nai-diffusion-4-5-curated', label: 'NAI Diffusion 4.5 Curated', supportsVibe: true, supportsCharacterRef: true },
  { value: 'nai-diffusion-4-5-full', label: 'NAI Diffusion 4.5 Full', supportsVibe: true, supportsCharacterRef: true },
  { value: 'nai-diffusion-3', label: 'NAI Diffusion 3', supportsVibe: false, supportsCharacterRef: false },
] as const

export const NAI_QUALITY_TAGS: Record<string, string> = {
  'nai-diffusion-4-5-full': 'location, very aesthetic, masterpiece, no text',
  'nai-diffusion-4-5-curated': 'location, masterpiece, no text, rating:general',
  'nai-diffusion-3': 'best quality, amazing quality, very aesthetic, absurdres',
}

export const NAI_UC_PRESETS: Record<string, Record<'light' | 'heavy' | 'human_focus', string>> = {
  'nai-diffusion-4-5-full': {
    heavy: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
    light: 'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
    human_focus: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy',
  },
  'nai-diffusion-4-5-curated': {
    heavy: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page',
    light: 'blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page',
    human_focus: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page',
  },
  'nai-diffusion-3': {
    heavy: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry',
    light: 'lowres, text, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry',
    human_focus: 'lowres, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, worst quality, low quality, normal quality, jpeg artifacts, watermark, blurry, mutated hands, poorly drawn face',
  },
} as const

export const DEFAULT_RESOLUTION_CONFIG = {
  mode: 'fixed' as const,
  fixed: '832×1216',
  random: [],
  customResolutions: [],
  swapDimensions: false,
}

export const DEFAULT_PARAMS: NAIParams = {
  model: 'nai-diffusion-4-5-curated',
  action: 'generate',
  prompt: '',
  negative_prompt: '',
  auto_quality_tags: true,
  uc_preset: 'human_focus',
  rating_preset: 'sensitive',
  resolution: '832×1216',
  resolutionConfig: DEFAULT_RESOLUTION_CONFIG,
  steps: 28,
  scale: 6,
  sampler: 'k_euler',
  n_samples: 1,
  variety_plus: false,
  cfg_rescale: 0.7,
  noise_schedule: 'karras',
  uncond_scale: 1,
  seed: null,
  strength: 0.7,
  noise: 0.0,
  source_image: null,
  mask_image: null,
  character_prompts: [],
} as const
