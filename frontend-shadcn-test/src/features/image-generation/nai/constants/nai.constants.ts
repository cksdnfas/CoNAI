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

export const DEFAULT_RESOLUTION_CONFIG = {
  mode: 'fixed' as const,
  fixed: '832×1216',
  random: [],
  customResolutions: [],
  swapDimensions: false,
}

export const DEFAULT_PARAMS = {
  model: 'nai-diffusion-4-5-curated',
  prompt: '',
  negative_prompt: '',
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
} as const
