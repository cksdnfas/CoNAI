import { requestJson } from './api-image-generation-request'
import type { GenerationHistoryRecord, GenerationServiceType, SaveBrowserImageRecord } from './api-image-generation-types'

export interface GenerationHistoryResponse {
  success: boolean
  records: GenerationHistoryRecord[]
  total: number
  limit?: number
  offset?: number
}

export interface GenerationHistoryQueryParams {
  limit?: number
  offset?: number
  queueJobId?: number
  requestedByAccountId?: number
  requestedByAccountType?: 'admin' | 'guest'
  serverId?: number
  mine?: boolean
}

function appendGenerationHistoryFilters(searchParams: URLSearchParams, params?: GenerationHistoryQueryParams) {
  if (!params) {
    return
  }

  if (params.queueJobId !== undefined) {
    searchParams.set('queue_job_id', String(params.queueJobId))
  }
  if (params.requestedByAccountId !== undefined) {
    searchParams.set('requested_by_account_id', String(params.requestedByAccountId))
  }
  if (params.requestedByAccountType) {
    searchParams.set('requested_by_account_type', params.requestedByAccountType)
  }
  if (params.serverId !== undefined) {
    searchParams.set('server_id', String(params.serverId))
  }
  if (params.mine) {
    searchParams.set('mine', 'true')
  }
}

/** Load paginated generation history for the image generation page. */
export async function getGenerationHistory(serviceType?: GenerationServiceType, params?: GenerationHistoryQueryParams) {
  const searchParams = new URLSearchParams({
    limit: String(params?.limit ?? 40),
    offset: String(params?.offset ?? 0),
  })
  if (serviceType) {
    searchParams.set('service_type', serviceType)
  }
  appendGenerationHistoryFilters(searchParams, params)

  const response = await requestJson<GenerationHistoryResponse>(`/api/generation-history?${searchParams.toString()}`)
  return response
}

/** Load paginated generation history for a specific ComfyUI workflow. */
export async function getGenerationWorkflowHistory(workflowId: number, params?: GenerationHistoryQueryParams) {
  const searchParams = new URLSearchParams({
    limit: String(params?.limit ?? 40),
    offset: String(params?.offset ?? 0),
  })
  appendGenerationHistoryFilters(searchParams, params)
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
  return requestJson<{ success: boolean; message: string; deleted: number }>('/api/generation-history/cleanup-failed', {
    method: 'POST',
  })
}

/** Load browser-ready image entries from the runtime save directory. */
export async function listGenerationSaveImages() {
  const response = await requestJson<{ success: boolean; data: { items: SaveBrowserImageRecord[]; total: number } }>('/api/image-editor/save-images')
  return response.data.items
}
