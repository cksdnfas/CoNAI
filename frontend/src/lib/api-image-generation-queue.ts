import { requestJson } from './api-image-generation-request'
import type { CreateGenerationQueueJobPayload, GenerationQueueJobRecord, GenerationQueueJobStatus, GenerationQueueRequestDebugSnapshot, GenerationQueueStatusCounts } from './api-image-generation-types'

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

interface GenerationQueueStatsResponse {
  success: boolean
  global: GenerationQueueStatusCounts
  visible: GenerationQueueStatusCounts
  total_visible: number
  active_visible: number
}

interface GenerationQueueRequestDebugResponse {
  success: boolean
  data: GenerationQueueRequestDebugSnapshot
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

/** Load queue totals for operations or lightweight queue widgets. */
export async function getGenerationQueueStats(params?: {
  serviceType?: GenerationQueueJobRecord['service_type']
  workflowId?: number | null
}) {
  const searchParams = new URLSearchParams()
  if (params?.serviceType) {
    searchParams.set('service_type', params.serviceType)
  }
  if (params?.workflowId != null) {
    searchParams.set('workflow_id', String(params.workflowId))
  }

  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : ''
  return requestJson<GenerationQueueStatsResponse>(`/api/generation-queue/stats${suffix}`)
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

/** Load the final upstream request snapshot captured for one queue job. */
export async function getGenerationQueueRequestDebug(queueJobId: number) {
  return requestJson<GenerationQueueRequestDebugResponse>(`/api/generation-queue/${queueJobId}/request-debug`)
}

/** Retry one failed or cancelled queue job. */
export async function retryGenerationQueueJob(queueJobId: number) {
  return requestJson<GenerationQueueMutationResponse>(`/api/generation-queue/${queueJobId}/retry`, {
    method: 'POST',
  })
}

/** Request cancellation for a queue job. */
export async function cancelGenerationQueueJob(queueJobId: number) {
  return requestJson<GenerationQueueMutationResponse>(`/api/generation-queue/${queueJobId}/cancel`, {
    method: 'POST',
  })
}
