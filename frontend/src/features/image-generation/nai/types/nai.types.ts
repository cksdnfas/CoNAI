export interface CustomResolution {
  id: string
  name: string
  width: number
  height: number
}

export interface ResolutionConfig {
  mode: 'fixed' | 'random'
  fixed: string
  random: string[]
  customResolutions: CustomResolution[]
  swapDimensions: boolean
}

export interface NAICharacterPrompt {
  id: string
  prompt: string
  uc: string
  center_x: number
  center_y: number
}

export interface NAIParams {
  model: string
  action: 'generate' | 'img2img' | 'infill'
  prompt: string
  negative_prompt: string
  auto_quality_tags: boolean
  uc_preset: 'none' | 'light' | 'heavy' | 'human_focus'
  rating_preset: 'general' | 'sensitive' | 'questionable' | 'explicit'
  resolution: string
  resolutionConfig: ResolutionConfig
  steps: number
  scale: number
  sampler: string
  n_samples: number
  variety_plus: boolean
  cfg_rescale: number
  noise_schedule: string
  uncond_scale: number
  seed: number | null
  strength: number
  noise: number
  source_image: string | null
  mask_image: string | null
  character_prompts: NAICharacterPrompt[]
}

export interface NAIUserData {
  subscription: {
    tier: number
    active: boolean
    tierName: string
  }
  anlasBalance: number
}

export interface NAIGenerationResponse {
  historyIds: number[]
  count: number
  metadata: Record<string, unknown>
}
