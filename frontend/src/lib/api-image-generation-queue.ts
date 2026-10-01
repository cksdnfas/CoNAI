import { requestJson } from './api-image-generation-request'
import type { CodexCliVersionInfo, CodexDeviceLoginState, CodexGenerationStatus, CreateGenerationQueueJobPayload, GenerationQueueJobRecord, GenerationQueueJobStatus } from './api-image-generation-types'

interface GenerationQueueListResponse {
  success: boolean
  records: GenerationQueueJobRecord[]
  total: number
}

interface GenerationQueueMutationResponse {
  success: boolean
  record: GenerationQueueJobRecord | null
  /** Number of jobs the server actually created for this request (>= 1). */
  enqueued_count?: number
  message: string
}

interface CodexGenerationStatusResponse {
  success: boolean
  data: CodexGenerationStatus
}

interface CodexDeviceLoginResponse {
  success: boolean
  data: CodexDeviceLoginState
}

/** Load queue jobs for the image generation workspace. */
export async function getGenerationQueue(params?: {
  status?: GenerationQueueJobStatus[]
  mine?: boolean
  serviceType?: GenerationQueueJobRecord['service_type']
  workflowId?: number | null
}) {
  const searchParams = new URLSearchParams()
  if (params?.status && params.status.length > 0) {
    searchParams.set('status', params.status.join(','))
  }
  if (params?.mine) {
    searchParams.set('mine', 'true')
  }
  if (params?.serviceType) {
    searchParams.set('service_type', params.serviceType)
  }
  if (params?.workflowId != null) {
    searchParams.set('workflow_id', String(params.workflowId))
  }

  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : ''
  return requestJson<GenerationQueueListResponse>(`/api/generation-queue${suffix}`)
}

/** Create one durable image generation queue job. */
export async function createGenerationQueueJob(payload: CreateGenerationQueueJobPayload) {
  return requestJson<GenerationQueueMutationResponse>('/api/generation-queue', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Load current Codex CLI availability/authentication state for the image-generation workspace. */
export async function getCodexGenerationStatus() {
  return requestJson<CodexGenerationStatusResponse>('/api/generation-queue/codex/status')
}

/** Start (or rejoin) the server's Codex device-code sign-in; resolves once the one-time code is ready. */
export async function startCodexDeviceLogin() {
  return requestJson<CodexDeviceLoginResponse>('/api/generation-queue/codex/login', { method: 'POST' })
}

export async function getCodexDeviceLogin() {
  return requestJson<CodexDeviceLoginResponse>('/api/generation-queue/codex/login')
}

export async function cancelCodexDeviceLogin() {
  return requestJson<CodexDeviceLoginResponse>('/api/generation-queue/codex/login', { method: 'DELETE' })
}

export async function getCodexCliVersion(options?: { refresh?: boolean }) {
  return requestJson<{ success: boolean; data: CodexCliVersionInfo }>(`/api/generation-queue/codex/cli${options?.refresh ? '?refresh=true' : ''}`)
}

/** Install the latest Codex CLI on the server; rejected while Codex jobs are running. */
export async function updateCodexCli() {
  return requestJson<{ success: boolean; data: CodexCliVersionInfo }>('/api/generation-queue/codex/cli/update', { method: 'POST' })
}

export type CodexModelOption = { id: string; label: string; isDefault?: boolean }

/** Models the server's Codex CLI offers; custom model IDs remain supported when the list is unavailable. */
export async function getCodexGenerationModels() {
  return requestJson<{ success: boolean; data: { models: CodexModelOption[]; source: 'cli' | 'cli-cache' | 'unavailable' } }>('/api/generation-queue/codex/models')
}

/** Request cancellation for a queue job. */
export async function cancelGenerationQueueJob(queueJobId: number) {
  return requestJson<GenerationQueueMutationResponse>(`/api/generation-queue/${queueJobId}/cancel`, {
    method: 'POST',
  })
}

/** Create a new queued job from a failed or cancelled queue record. */
export async function retryGenerationQueueJob(queueJobId: number) {
  return requestJson<GenerationQueueMutationResponse>(`/api/generation-queue/${queueJobId}/retry`, {
    method: 'POST',
  })
}
