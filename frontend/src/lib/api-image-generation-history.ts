import { requestJson } from './api-image-generation-request'
import type { GenerationHistoryRecord, GenerationServiceType, SaveBrowserImageRecord } from './api-image-generation-types'

export interface GenerationHistoryResponse {
  success: boolean
  records: GenerationHistoryRecord[]
  total: number
  limit?: number
  offset?: number
}

/** Load paginated generation history for the image generation page. */
export async function getGenerationHistory(serviceType?: GenerationServiceType, params?: { limit?: number; offset?: number }) {
  const searchParams = new URLSearchParams({
    limit: String(params?.limit ?? 40),
    offset: String(params?.offset ?? 0),
  })
  if (serviceType) {
    searchParams.set('service_type', serviceType)
  }

  const response = await requestJson<GenerationHistoryResponse>(`/api/generation-history?${searchParams.toString()}`)
  return response
}

/** Load paginated generation history for a specific ComfyUI workflow. */
export async function getGenerationWorkflowHistory(workflowId: number, params?: { limit?: number; offset?: number }) {
  const searchParams = new URLSearchParams({
    limit: String(params?.limit ?? 40),
    offset: String(params?.offset ?? 0),
  })
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
  const response = await requestJson<{ items: SaveBrowserImageRecord[]; total: number }>('/api/image-editor/save-images')
  return response.items
}
