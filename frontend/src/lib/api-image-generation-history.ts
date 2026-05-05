import { buildApiUrl, triggerBlobDownload } from '@/lib/api-client'
import { requestJson } from './api-image-generation-request'
import type { ImageDownloadType } from './api-images'
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

/** Download selected generation-history outputs without applying gallery safety hiding. */
export async function downloadGenerationHistorySelection(historyIds: number[], type: ImageDownloadType = 'original') {
  if (historyIds.length === 0) {
    return
  }

  const response = await fetch(buildApiUrl('/api/generation-history/download/batch'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/zip',
    },
    body: JSON.stringify({ historyIds, type }),
  })

  if (!response.ok) {
    throw new Error(`Generation history download failed: ${response.status}`)
  }

  const blob = await response.blob()
  triggerBlobDownload(blob, `conai-generation-history-${type}-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.zip`)
}

/** Load browser-ready image entries from the runtime save directory. */
export async function listGenerationSaveImages() {
  const response = await requestJson<{ success: boolean; data: { items: SaveBrowserImageRecord[]; total: number } }>('/api/image-editor/save-images')
  return response.data.items
}
