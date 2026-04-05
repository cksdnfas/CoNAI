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
  dropdown_list_name?: string
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

export interface GenerationWorkflowDetail extends GenerationWorkflow {
  workflow_json: string
}

export interface ComfyUIServer {
  id: number
  name: string
  endpoint: string
  description?: string
  is_active: boolean
}

export interface CustomDropdownList {
  id: number
  name: string
  description?: string | null
  items: string[]
  is_auto_collected: boolean
  source_path?: string | null
  created_date?: string
  updated_date?: string
}

export interface ComfyUIModelFolderScanInput {
  folderName: string
  displayName: string
  files: string[]
}

export interface CreateComfyUIServerPayload {
  name: string
  endpoint: string
  description?: string
}

export interface UpdateComfyUIServerPayload {
  name?: string
  endpoint?: string
  description?: string
  is_active?: boolean
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
  noise_schedule?: string
  n_samples?: number
  seed?: number
  use_coords?: boolean
  variety_plus?: boolean
  image?: string
  mask?: string
  strength?: number
  noise?: number
  add_original_image?: boolean
  characters?: Array<{
    prompt: string
    uc?: string
    center_x?: number
    center_y?: number
  }>
  vibes?: Array<{
    encoded: string
    strength?: number
    information_extracted?: number
  }>
  character_refs?: Array<{
    image: string
    type?: 'character' | 'style' | 'character&style'
    strength?: number
    fidelity?: number
  }>
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
    scheduler?: string
    model?: string
  }
}

export interface NAIEncodeVibePayload {
  image: string
  model?: string
  information_extracted?: number
}

export interface NAIEncodeVibeResponse {
  encoded: string
}

export interface NAIUpscalePayload {
  image: string
  scale?: number
}

export interface NAIUpscaleResponse {
  image: string
  filename: string
  sourceBytes: number
}

export interface StoredNaiVibeAsset {
  id: string
  label: string
  description?: string | null
  model: string
  image_data_url?: string
  image_url?: string
  thumbnail_url?: string
  encoded?: string
  strength: number
  information_extracted: number
  created_date: string
}

export interface StoredNaiCharacterReferenceAsset {
  id: string
  label: string
  description?: string | null
  image_data_url?: string
  image_url?: string
  thumbnail_url?: string
  type: 'character' | 'style' | 'character&style'
  strength: number
  fidelity: number
  created_date: string
  has_letterbox: boolean
}

export interface SaveBrowserImageRecord {
  id: string
  relative_path: string
  file_name: string
  url: string
  mime_type: string
  file_size: number
  modified_at: string
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

export interface CreateGenerationWorkflowPayload {
  name: string
  description?: string
  workflow_json: string
  marked_fields?: WorkflowMarkedField[]
  api_endpoint?: string
  is_active?: boolean
  color?: string
}

interface WorkflowListResponse {
  success: boolean
  data: GenerationWorkflow[]
}

interface WorkflowDetailResponse {
  success: boolean
  data: GenerationWorkflowDetail
}

interface ComfyUIServerListResponse {
  success: boolean
  data: ComfyUIServer[]
}

interface CustomDropdownListResponse {
  success: boolean
  data: CustomDropdownList[]
}

interface CreateComfyUIServerResponse {
  success: boolean
  data: {
    id: number
    message: string
  }
}

interface MutationResponse {
  success: boolean
  data: {
    id?: number
    message: string
  }
}

interface CreateWorkflowResponse {
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

/** Load the full detail for a single saved workflow. */
export async function getGenerationWorkflow(workflowId: number) {
  const response = await requestJson<WorkflowDetailResponse>(`/api/workflows/${workflowId}`)
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

/** Update a saved ComfyUI server entry. */
export async function updateGenerationComfyUIServer(serverId: number, payload: UpdateComfyUIServerPayload) {
  return requestJson<MutationResponse>(`/api/comfyui-servers/${serverId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Delete a saved ComfyUI server entry. */
export async function deleteGenerationComfyUIServer(serverId: number) {
  return requestJson<MutationResponse>(`/api/comfyui-servers/${serverId}`, {
    method: 'DELETE',
  })
}

/** Create a saved ComfyUI workflow definition. */
export async function createGenerationWorkflow(payload: CreateGenerationWorkflowPayload) {
  return requestJson<CreateWorkflowResponse>('/api/workflows', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Update a saved ComfyUI workflow definition. */
export async function updateGenerationWorkflow(workflowId: number, payload: CreateGenerationWorkflowPayload) {
  return requestJson<MutationResponse>(`/api/workflows/${workflowId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Delete a saved ComfyUI workflow definition. */
export async function deleteGenerationWorkflow(workflowId: number) {
  return requestJson<MutationResponse>(`/api/workflows/${workflowId}`, {
    method: 'DELETE',
  })
}

/** Link one or more ComfyUI servers to a saved workflow. */
export async function linkGenerationWorkflowServers(workflowId: number, serverIds: number[]) {
  return requestJson<{ success: boolean; data: { message: string; linked_count: number } }>(`/api/workflows/${workflowId}/servers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ server_ids: serverIds }),
  })
}

/** Remove a linked server from a saved workflow. */
export async function unlinkGenerationWorkflowServer(workflowId: number, serverId: number) {
  return requestJson<MutationResponse>(`/api/workflows/${workflowId}/servers/${serverId}`, {
    method: 'DELETE',
  })
}

/** Normalize ComfyUI server status fields from mixed backend payload shapes. */
function normalizeComfyUIServerStatus(payload: Record<string, unknown>): ComfyUIServerConnectionStatus {
  return {
    server_id: Number(payload.server_id ?? payload.serverId ?? 0),
    server_name: String(payload.server_name ?? payload.serverName ?? ''),
    endpoint: String(payload.endpoint ?? ''),
    is_connected: payload.is_connected === true || payload.isConnected === true,
    response_time: typeof payload.response_time === 'number'
      ? payload.response_time
      : typeof payload.responseTime === 'number'
        ? payload.responseTime
        : undefined,
    error_message: typeof payload.error_message === 'string'
      ? payload.error_message
      : typeof payload.error === 'string'
        ? payload.error
        : undefined,
  }
}

/** Test whether a ComfyUI server endpoint is reachable. */
export async function testGenerationComfyUIServer(serverId: number) {
  const response = await requestJson<TestComfyUIServerResponse>(`/api/comfyui-servers/${serverId}/test-connection`)
  return normalizeComfyUIServerStatus(response.data as unknown as Record<string, unknown>)
}

/** Load the linked servers for a specific ComfyUI workflow. */
export async function getGenerationWorkflowServers(workflowId: number) {
  const response = await requestJson<ComfyUIServerListResponse>(`/api/workflows/${workflowId}/servers`)
  return response.data
}

/** Load saved custom dropdown lists used by ComfyUI workflows. */
export async function getGenerationCustomDropdownLists() {
  const response = await requestJson<CustomDropdownListResponse>('/api/custom-dropdown-lists')
  return response.data
}

/** Create one manual custom dropdown list. */
export async function createGenerationCustomDropdownList(payload: {
  name: string
  description?: string
  items: string[]
}) {
  return requestJson<{ success: boolean; data: { id: number; message: string } }>('/api/custom-dropdown-lists', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Update one manual custom dropdown list. */
export async function updateGenerationCustomDropdownList(listId: number, payload: {
  name?: string
  description?: string
  items?: string[]
}) {
  return requestJson<{ success: boolean; data: { message: string } }>(`/api/custom-dropdown-lists/${listId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Delete one custom dropdown list. */
export async function deleteGenerationCustomDropdownList(listId: number) {
  return requestJson<{ success: boolean; data: { message: string } }>(`/api/custom-dropdown-lists/${listId}`, {
    method: 'DELETE',
  })
}

/** Scan a selected ComfyUI models folder dump and store auto-collected dropdown lists. */
export async function scanGenerationComfyUIModelDropdownLists(payload: {
  modelFolders: ComfyUIModelFolderScanInput[]
  sourcePath?: string
  mergeSubfolders?: boolean
  createBoth?: boolean
}) {
  return requestJson<{ success: boolean; data: { scannedFolders: number; createdLists: number; deletedLists?: number; message: string } }>('/api/custom-dropdown-lists/scan-comfyui-models', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
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

/** Load generation history for a specific ComfyUI workflow. */
export async function getGenerationWorkflowHistory(workflowId: number) {
  const searchParams = new URLSearchParams({ limit: '30', offset: '0' })
  const response = await requestJson<GenerationHistoryResponse>(`/api/generation-history/workflow/${workflowId}?${searchParams.toString()}`)
  return response
}

/** Delete one generation history record. */
export async function deleteGenerationHistoryRecord(historyId: number, deleteFiles = false) {
  const searchParams = new URLSearchParams()
  if (deleteFiles) {
    searchParams.set('deleteFiles', 'true')
  }

  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : ''
  return requestJson<{ success: boolean; message: string }>(`/api/generation-history/${historyId}${suffix}`, {
    method: 'DELETE',
  })
}

/** Delete failed generation history records in bulk. */
export async function cleanupFailedGenerationHistory() {
  return requestJson<{ success: boolean; message: string; deleted: number }>(`/api/generation-history/cleanup-failed`, {
    method: 'POST',
  })
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

/** Encode one image into a reusable NovelAI vibe payload. */
export async function encodeNaiVibe(payload: NAIEncodeVibePayload) {
  return requestJson<NAIEncodeVibeResponse>('/api/nai/generate/encode-vibe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Upscale one image through NovelAI and return the generated PNG bytes as base64. */
export async function upscaleNaiImage(payload: NAIUpscalePayload) {
  return requestJson<NAIUpscaleResponse>('/api/nai/generate/upscale', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Load saved reusable vibe-transfer assets. */
export async function listNaiVibeAssets(model?: string) {
  const searchParams = new URLSearchParams()
  if (model) {
    searchParams.set('model', model)
  }

  const response = await requestJson<{ items: StoredNaiVibeAsset[] }>(`/api/nai/store/vibes${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`)
  return response.items
}

/** Load one saved vibe-transfer asset with its full encoded payload. */
export async function getNaiVibeAsset(assetId: string) {
  return requestJson<StoredNaiVibeAsset>(`/api/nai/store/vibes/${assetId}`)
}

/** Save one reusable vibe-transfer asset for later use. */
export async function saveNaiVibeAsset(payload: {
  label?: string
  description?: string
  model: string
  image?: string
  encoded: string
  strength?: number
  information_extracted?: number
}) {
  return requestJson<StoredNaiVibeAsset>('/api/nai/store/vibes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Delete one saved vibe-transfer asset. */
export async function deleteNaiVibeAsset(assetId: string) {
  return requestJson<{ success: boolean }>(`/api/nai/store/vibes/${assetId}`, {
    method: 'DELETE',
  })
}

/** Update one saved vibe-transfer asset. */
export async function updateNaiVibeAsset(assetId: string, payload: {
  label: string
  description?: string
}) {
  return requestJson<StoredNaiVibeAsset>(`/api/nai/store/vibes/${assetId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Load saved character-reference assets. */
export async function listNaiCharacterReferenceAssets() {
  const response = await requestJson<{ items: StoredNaiCharacterReferenceAsset[] }>('/api/nai/store/character-references')
  return response.items
}

/** Save one reusable character-reference asset. */
export async function saveNaiCharacterReferenceAsset(payload: {
  label?: string
  description?: string
  image: string
  type?: 'character' | 'style' | 'character&style'
  strength?: number
  fidelity?: number
}) {
  return requestJson<StoredNaiCharacterReferenceAsset>('/api/nai/store/character-references', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Delete one saved character-reference asset. */
export async function deleteNaiCharacterReferenceAsset(assetId: string) {
  return requestJson<{ success: boolean }>(`/api/nai/store/character-references/${assetId}`, {
    method: 'DELETE',
  })
}

/** Update one saved character-reference asset. */
export async function updateNaiCharacterReferenceAsset(assetId: string, payload: {
  label: string
  description?: string
}) {
  return requestJson<StoredNaiCharacterReferenceAsset>(`/api/nai/store/character-references/${assetId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Load browser-ready image entries from the runtime save directory. */
export async function listGenerationSaveImages() {
  const response = await requestJson<{ items: SaveBrowserImageRecord[]; total: number }>('/api/image-editor/save-images')
  return response.items
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
