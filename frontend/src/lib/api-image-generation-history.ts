import { requestJson } from './api-image-generation-request'
import type { GenerationHistoryRecord, GenerationServiceType, SaveBrowserImageRecord } from './api-image-generation-types'

interface GenerationHistoryResponse {
  success: boolean
  records: GenerationHistoryRecord[]
  total: number
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
  return requestJson<{ success: boolean; message: string; deleted: number }>('/api/generation-history/cleanup-failed', {
    method: 'POST',
  })
}

/** Load browser-ready image entries from the runtime save directory. */
export async function listGenerationSaveImages() {
  const response = await requestJson<{ items: SaveBrowserImageRecord[]; total: number }>('/api/image-editor/save-images')
  return response.items
}
