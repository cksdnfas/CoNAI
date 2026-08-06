import { buildApiUrl } from './api-client'
import { requestApiData } from './api-request'

export const WORKFLOW_INPUT_ASSET_REF_KIND = 'workflow-input-asset'

export type WorkflowInputAssetRef = {
  __ref: typeof WORKFLOW_INPUT_ASSET_REF_KIND
  id: string
  fileName: string
  mimeType?: string
  bytes: number
}

/** Upload one Director reference into CoNAI's persistent workflow input store. */
export async function uploadWorkflowInputAsset(file: File) {
  const formData = new FormData()
  formData.append('file', file, file.name)
  return requestApiData<WorkflowInputAssetRef>('/api/workflow-input-assets', {
    method: 'POST',
    body: formData,
  })
}

/** Build an authenticated media URL for image, video, or audio previews. */
export function buildWorkflowInputAssetUrl(asset: WorkflowInputAssetRef) {
  const searchParams = new URLSearchParams()
  if (asset.mimeType) {
    searchParams.set('mime', asset.mimeType)
  }
  const query = searchParams.toString()
  return buildApiUrl(`/api/workflow-input-assets/${asset.id}${query ? `?${query}` : ''}`)
}

/** Mark one removed Director draft asset for delayed server-side deletion. */
export async function deleteWorkflowInputAsset(assetId: string) {
  return requestApiData<{ removed: boolean }>(`/api/workflow-input-assets/${assetId}`, {
    method: 'DELETE',
  })
}
