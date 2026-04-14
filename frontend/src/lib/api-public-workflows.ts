import { requestJson } from './api-image-generation-request'
import type { GenerationHistoryRecord, PublicGenerationWorkflow } from './api-image-generation-types'

interface PublicWorkflowListResponse {
  success: boolean
  data: PublicGenerationWorkflow[]
}

interface PublicWorkflowDetailResponse {
  success: boolean
  data: PublicGenerationWorkflow
}

interface PublicWorkflowHistoryResponse {
  success: boolean
  records: GenerationHistoryRecord[]
  total: number
}

interface PublicWorkflowQueueResponse {
  success: boolean
  message: string
  record?: {
    id: number
  }
}

interface PublicWorkflowCleanupResponse {
  success: boolean
  message: string
  deleted: number
}

export async function getPublicGenerationWorkflows() {
  const response = await requestJson<PublicWorkflowListResponse>('/api/public-workflows')
  return response.data
}

export async function getPublicGenerationWorkflow(publicSlug: string) {
  const response = await requestJson<PublicWorkflowDetailResponse>(`/api/public-workflows/${encodeURIComponent(publicSlug)}`)
  return response.data
}

export async function getPublicGenerationWorkflowHistory(publicSlug: string, params?: { limit?: number; offset?: number }) {
  const searchParams = new URLSearchParams()
  if (params?.limit !== undefined) {
    searchParams.set('limit', String(params.limit))
  }
  if (params?.offset !== undefined) {
    searchParams.set('offset', String(params.offset))
  }

  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : ''
  return requestJson<PublicWorkflowHistoryResponse>(`/api/public-workflows/${encodeURIComponent(publicSlug)}/history${suffix}`)
}

export async function queuePublicGenerationWorkflowJob(publicSlug: string, payload: {
  request_payload: Record<string, unknown>
  request_summary?: string | null
}) {
  return requestJson<PublicWorkflowQueueResponse>(`/api/public-workflows/${encodeURIComponent(publicSlug)}/queue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export async function cleanupPublicGenerationWorkflowFailedHistory(publicSlug: string) {
  return requestJson<PublicWorkflowCleanupResponse>(`/api/public-workflows/${encodeURIComponent(publicSlug)}/cleanup-failed`, {
    method: 'POST',
  })
}
