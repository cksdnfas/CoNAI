import { requestJson } from './api-image-generation-request'
import type { CodexGenerationStatus, CreateGenerationQueueJobPayload, GenerationQueueJobRecord, GenerationQueueJobStatus } from './api-image-generation-types'

interface GenerationQueueListResponse {
  success: boolean
  records: GenerationQueueJobRecord[]
  total: number
}

interface GenerationQueueMutationResponse {
  success: boolean
  record: GenerationQueueJobRecord | null
  message: string
}

interface CodexGenerationStatusResponse {
  success: boolean
  data: CodexGenerationStatus
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

/** Request cancellation for a queue job. */
export async function cancelGenerationQueueJob(queueJobId: number) {
  return requestJson<GenerationQueueMutationResponse>(`/api/generation-queue/${queueJobId}/cancel`, {
    method: 'POST',
  })
}
