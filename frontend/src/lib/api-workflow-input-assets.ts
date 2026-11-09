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

const PUBLIC_WORKFLOW_PAGE_PATH = /^\/public\/workflows\/([^/]+)/

/**
 * On a shared workflow page the server accepts the page's slug in place of generation/gallery permissions.
 * Read from the URL so every caller, including previews rendered from a saved draft, is scoped without plumbing.
 */
function assetPath(path: string, params = new URLSearchParams()) {
  const slug = PUBLIC_WORKFLOW_PAGE_PATH.exec(window.location.pathname)?.[1]
  if (slug) params.set('publicWorkflow', decodeURIComponent(slug))
  const query = params.toString()
  return `${path}${query ? `?${query}` : ''}`
}

/** Upload one Director reference into CoNAI's persistent workflow input store. */
export async function uploadWorkflowInputAsset(file: File) {
  const formData = new FormData()
  formData.append('file', file, file.name)
  return requestApiData<WorkflowInputAssetRef>(assetPath('/api/workflow-input-assets'), {
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
  return buildApiUrl(assetPath(`/api/workflow-input-assets/${asset.id}`, searchParams))
}

/** Mark one removed Director draft asset for delayed server-side deletion. */
export async function deleteWorkflowInputAsset(assetId: string) {
  return requestApiData<{ removed: boolean }>(assetPath(`/api/workflow-input-assets/${assetId}`), {
    method: 'DELETE',
  })
}
