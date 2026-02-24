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

export interface NAIParams {
  model: string
  prompt: string
  negative_prompt: string
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
