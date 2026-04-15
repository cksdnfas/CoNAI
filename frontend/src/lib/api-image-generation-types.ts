export type GenerationServiceType = 'novelai' | 'comfyui'
export type GenerationQueueJobStatus = 'queued' | 'dispatching' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface GenerationQueueJobRecord {
  id: number
  service_type: GenerationServiceType
  status: GenerationQueueJobStatus
  priority: number
  requested_by_account_id?: number | null
  requested_by_username?: string | null
  requested_by_account_type?: 'admin' | 'guest' | null
  workflow_id?: number | null
  workflow_name?: string | null
  requested_group_id?: number | null
  requested_server_id?: number | null
  requested_server_tag?: string | null
  assigned_server_id?: number | null
  provider_job_id?: string | null
  request_payload: string
  request_summary?: string | null
  failure_code?: string | null
  failure_message?: string | null
  cancel_requested: number
  queued_at: string
  started_at?: string | null
  completed_at?: string | null
  created_date: string
  updated_date: string
  queue_position?: number | null
  queue_position_scope?: 'service' | 'server' | 'tag' | 'auto' | null
  queue_position_server_id?: number | null
  queue_position_server_tag?: string | null
  estimated_wait_seconds?: number | null
  estimated_total_seconds?: number | null
  estimated_duration_seconds?: number | null
  is_mine?: boolean
}

export interface CreateGenerationQueueJobPayload {
  service_type: GenerationServiceType
  priority?: number
  workflow_id?: number | null
  workflow_name?: string | null
  requested_group_id?: number | null
  requested_server_id?: number | null
  requested_server_tag?: string | null
  request_payload: Record<string, unknown>
  request_summary?: string | null
}

export interface GenerationQueueStatusCounts {
  queued: number
  dispatching: number
  running: number
  completed: number
  failed: number
  cancelled: number
}

export interface GenerationHistoryRecord {
  id: number
  service_type: GenerationServiceType
  generation_status: 'pending' | 'processing' | 'completed' | 'failed'

  // Core result-index / operations fields
  workflow_id?: number | null
  workflow_name?: string | null
  queue_job_id?: number | null
  requested_by_account_id?: number | null
  requested_by_account_type?: 'admin' | 'guest' | null
  server_id?: number | null
  requested_server_id?: number | null
  requested_server_name?: string | null
  requested_server_tag?: string | null
  assigned_server_id?: number | null
  assigned_server_name?: string | null
  nai_model?: string | null
  error_message?: string | null
  composite_hash?: string | null
  actual_composite_hash?: string | null
  created_at?: string | null

  // Main-DB resolved display fields
  actual_width?: number | null
  actual_height?: number | null
  rating_score?: number | null

  // Detail/compat-only legacy fields
  width?: number | null
  height?: number | null
  original_path?: string | null

  // Legacy compatibility fields, not preferred for result-focused history UI
  nai_sampler?: string | null
  nai_seed?: number | null
  nai_steps?: number | null
  nai_scale?: number | null
  positive_prompt?: string | null
  negative_prompt?: string | null
  actual_thumbnail_path?: string | null
}

export interface WorkflowMarkedField {
  id: string
  label: string
  description?: string
  jsonPath: string
  type: 'text' | 'number' | 'select' | 'textarea' | 'image'
  default_collapsed?: boolean
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
  is_public_page?: boolean
  public_slug?: string | null
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
  routing_tags?: string[]
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
  routing_tags?: string[]
}

export interface UpdateComfyUIServerPayload {
  name?: string
  endpoint?: string
  description?: string
  routing_tags?: string[]
  is_active?: boolean
}

export interface ComfyUIServerConnectionStatus {
  server_id: number
  server_name: string
  endpoint: string
  is_connected: boolean
  response_time?: number
  error_message?: string
  is_idle?: boolean
  pending_count?: number
  running_count?: number
  observed_at?: string
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
  imageSaveOptions?: GenerationImageSaveOptions
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

export interface GenerationImageSaveOptions {
  format?: 'original' | 'png' | 'jpeg' | 'webp'
  quality?: number
  resizeEnabled?: boolean
  maxWidth?: number
  maxHeight?: number
}

export interface ComfyUIGenerationPayload {
  prompt_data: Record<string, string | number | ComfyUIImageFieldValue>
  server_id?: number
  imageSaveOptions?: GenerationImageSaveOptions
}

export interface ComfyUIGenerationResponse {
  success: boolean
  data: {
    history_id?: number
    status: 'pending' | 'processing' | 'completed' | 'failed'
    message: string
  }
}

export interface PublicGenerationWorkflow {
  id: number
  name: string
  description?: string | null
  color: string
  is_active: boolean
  is_public_page: boolean
  public_slug?: string | null
  marked_fields: WorkflowMarkedField[]
}

export interface CreateGenerationWorkflowPayload {
  name: string
  description?: string
  workflow_json: string
  marked_fields?: WorkflowMarkedField[]
  api_endpoint?: string
  is_active?: boolean
  is_public_page?: boolean
  public_slug?: string | null
  color?: string
}
