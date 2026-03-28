import { buildApiUrl } from '@/lib/api-client'

export type GenerationServiceType = 'novelai' | 'comfyui'

export interface GenerationHistoryRecord {
  id: number
  service_type: GenerationServiceType
  generation_status: 'pending' | 'processing' | 'completed' | 'failed'
  workflow_id?: number | null
  workflow_name?: string | null
  nai_model?: string | null
  nai_sampler?: string | null
  nai_seed?: number | null
  nai_steps?: number | null
  nai_scale?: number | null
  positive_prompt?: string | null
  negative_prompt?: string | null
  width?: number | null
  height?: number | null
  actual_width?: number | null
  actual_height?: number | null
  error_message?: string | null
  original_path?: string | null
  composite_hash?: string | null
  actual_composite_hash?: string | null
  actual_thumbnail_path?: string | null
  created_at?: string | null
}

export interface WorkflowMarkedField {
  id: string
  label: string
  description?: string
  jsonPath: string
  type: 'text' | 'number' | 'select' | 'textarea' | 'image'
  default_value?: string | number | boolean | null
  placeholder?: string
  options?: string[]
  required?: boolean
  min?: number
  max?: number
}

export interface GenerationWorkflow {
  id: number
  name: string
  description?: string
  api_endpoint: string
  is_active: boolean
  color: string
  marked_fields: WorkflowMarkedField[]
}

export interface ComfyUIServer {
  id: number
  name: string
  endpoint: string
  description?: string
  is_active: boolean
}

export interface CreateComfyUIServerPayload {
  name: string
  endpoint: string
  description?: string
}

export interface ComfyUIServerConnectionStatus {
  server_id: number
  server_name: string
  endpoint: string
  is_connected: boolean
  response_time?: number
  error_message?: string
}

export interface NAIUserData {
  subscription: {
    tier: number
    active: boolean
    tierName: string
  }
  anlasBalance: number
}

export interface NAICostEstimate {
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

export interface NAILoginResponse {
  accessToken: string
  expiresAt: string
}

export interface NAIImageGenerationPayload {
  prompt: string
  negative_prompt?: string
  model?: string
  action?: 'generate' | 'img2img' | 'infill'
  width?: number
  height?: number
  steps?: number
  scale?: number
  sampler?: string
  n_samples?: number
  seed?: number
  ucPreset?: number
  variety_plus?: boolean
  image?: string
  mask?: string
  strength?: number
  noise?: number
  add_original_image?: boolean
}

export interface NAIImageGenerationResponse {
  historyIds: number[]
  count: number
  metadata: {
    prompt: string
    negative_prompt?: string
    seed?: number
    resolution: string
    steps?: number
    scale?: number
    sampler?: string
    model?: string
  }
}

export interface ComfyUIImageFieldValue {
  fileName: string
  dataUrl: string
}

export interface ComfyUIGenerationPayload {
  prompt_data: Record<string, string | number | ComfyUIImageFieldValue>
  server_id?: number
}

export interface ComfyUIGenerationResponse {
  success: boolean
  data: {
    history_id?: number
    status: 'pending' | 'processing' | 'completed' | 'failed'
    message: string
  }
}

interface WorkflowListResponse {
  success: boolean
  data: GenerationWorkflow[]
}

interface ComfyUIServerListResponse {
  success: boolean
  data: ComfyUIServer[]
}

interface CreateComfyUIServerResponse {
  success: boolean
  data: {
    id: number
    message: string
  }
}

interface TestComfyUIServerResponse {
  success: boolean
  data: ComfyUIServerConnectionStatus
}

interface NAICostEstimateResponse {
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

interface GenerationHistoryResponse {
  success: boolean
  records: GenerationHistoryRecord[]
  total: number
}

/** Execute a JSON API request and surface backend error messages. */
async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await response.json() : await response.text()

  if (!response.ok) {
    if (typeof payload === 'string' && payload.trim().length > 0) {
      throw new Error(payload)
    }

    if (payload && typeof payload === 'object') {
      const errorMessage =
        ('error' in payload && typeof payload.error === 'string' && payload.error) ||
        ('details' in payload && typeof payload.details === 'string' && payload.details)

      if (errorMessage) {
        throw new Error(errorMessage)
      }
    }

    throw new Error(`Request failed: ${response.status}`)
  }

  return payload as T
}

/** Load the workflows available for ComfyUI generation. */
export async function getGenerationWorkflows(activeOnly = true) {
  const searchParams = new URLSearchParams()
  if (activeOnly) {
    searchParams.set('active', 'true')
  }

  const response = await requestJson<WorkflowListResponse>(`/api/workflows${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`)
  return response.data
}

/** Load the registered ComfyUI servers. */
export async function getGenerationComfyUIServers(activeOnly = true) {
  const searchParams = new URLSearchParams()
  if (activeOnly) {
    searchParams.set('active', 'true')
  }

  const response = await requestJson<ComfyUIServerListResponse>(`/api/comfyui-servers${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`)
  return response.data
}

/** Create a ComfyUI server entry for generation routing. */
export async function createGenerationComfyUIServer(payload: CreateComfyUIServerPayload) {
  return requestJson<CreateComfyUIServerResponse>('/api/comfyui-servers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Test whether a ComfyUI server endpoint is reachable. */
export async function testGenerationComfyUIServer(serverId: number) {
  const response = await requestJson<TestComfyUIServerResponse>(`/api/comfyui-servers/${serverId}/test-connection`)
  return response.data
}

/** Load recent generation history for the image generation page. */
export async function getGenerationHistory(serviceType?: GenerationServiceType) {
  const searchParams = new URLSearchParams({ limit: '30', offset: '0' })
  if (serviceType) {
    searchParams.set('service_type', serviceType)
  }

  const response = await requestJson<GenerationHistoryResponse>(`/api/generation-history?${searchParams.toString()}`)
  return response
}

/** Login to NovelAI with username/password and store the returned token on the backend. */
export async function loginNai(username: string, password: string) {
  return requestJson<NAILoginResponse>('/api/nai/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  })
}

/** Validate and store a NovelAI access token on the backend. */
export async function loginNaiWithToken(token: string) {
  return requestJson<NAILoginResponse>('/api/nai/auth/login-with-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token }),
  })
}

/** Load NovelAI account info using the backend-stored token. */
export async function getNaiUserData() {
  return requestJson<NAIUserData>('/api/nai/user/data')
}

/** Calculate the expected NovelAI generation cost for the current settings. */
export async function getNaiCostEstimate(payload: {
  width: number
  height: number
  steps: number
  n_samples: number
  subscriptionTier: number
  anlasBalance: number
}) {
  return requestJson<NAICostEstimateResponse>('/api/nai/cost/calculate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Start a NovelAI image generation request. */
export async function generateNaiImage(payload: NAIImageGenerationPayload) {
  return requestJson<NAIImageGenerationResponse>('/api/nai/generate/image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Start a ComfyUI workflow generation request. */
export async function generateComfyUIImage(workflowId: number, payload: ComfyUIGenerationPayload) {
  return requestJson<ComfyUIGenerationResponse>(`/api/workflows/${workflowId}/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}
