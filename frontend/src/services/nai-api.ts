import { apiClient } from '@/lib/api/client'

export interface NAICostInput {
  width: number
  height: number
  steps: number
  n_samples: number
  subscriptionTier: number
  anlasBalance?: number
}

export interface NAICostResponse {
  estimatedCost: number
  maxSamples: number
  canAfford: boolean
  isOpusFree: boolean
  breakdown: {
    baseCost: number
    smeaMultiplier: number
    samplesMultiplier: number
  }
}

const buildBearerHeaders = (token: string) => ({
  headers: {
    Authorization: `Bearer ${token}`,
  },
})

export const naiApi = {
  login: async (username: string, password: string): Promise<{ accessToken: string; expiresAt: string }> => {
    const response = await apiClient.post('/api/nai/auth/login', { username, password })
    return response.data
  },

  loginWithToken: async (token: string): Promise<{ accessToken: string; expiresAt: string }> => {
    const response = await apiClient.post('/api/nai/auth/login-with-token', { token })
    return response.data
  },

  generateImage: async (
    token: string,
    params: {
      prompt: string
      negative_prompt?: string
      model?: string
      width?: number
      height?: number
      steps?: number
      scale?: number
      sampler?: string
      n_samples?: number
      variety_plus?: boolean
      sm?: boolean
      sm_dyn?: boolean
      cfg_rescale?: number
      noise_schedule?: string
      uncond_scale?: number
      qualityToggle?: boolean
      seed?: number
      groupId?: number
      image?: string
      strength?: number
      noise?: number
      mask?: string
      reference_image_multiple?: string[]
      reference_strength_multiple?: number[]
    },
  ): Promise<{
    historyIds: number[]
    count: number
    metadata: {
      prompt: string
      negative_prompt: string
      seed: number
      resolution: string
      steps: number
      scale: number
      sampler: string
      model: string
    }
  }> => {
    const response = await apiClient.post('/api/nai/generate/image', params, buildBearerHeaders(token))
    return response.data
  },

  getUserData: async (token: string) => {
    const response = await apiClient.get('/api/nai/user/data', buildBearerHeaders(token))
    return response.data
  },

  calculateCost: async (input: NAICostInput) => {
    const response = await apiClient.post<NAICostResponse>('/api/nai/cost/calculate', input)
    return response.data
  },
}
