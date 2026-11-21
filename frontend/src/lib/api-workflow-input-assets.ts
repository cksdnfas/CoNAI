import { buildApiUrl } from './api-client'
import { withPublicWorkflowScope } from './public-workflow-scope'
import { requestApiData } from './api-request'

export const WORKFLOW_INPUT_ASSET_REF_KIND = 'workflow-input-asset'

export type WorkflowInputAssetRef = {
  __ref: typeof WORKFLOW_INPUT_ASSET_REF_KIND
  id: string
  fileName: string
  mimeType?: string
  bytes: number
}

/**
 * The name to show for an uploaded file. Uploads from before file names were read as UTF-8 came back with Korean
 * names as latin1 mojibake ("ì\u0098¤"); such a name is read back, any other name is returned as it is.
 */
export function readableUploadName(name: string): string {
  const codes = Array.from(name, (char) => char.codePointAt(0) ?? 0)
  // Only single-byte characters with at least one high byte can be UTF-8 that was read as latin1.
  if (codes.some((code) => code > 0xff) || !codes.some((code) => code >= 0x80)) return name
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(codes)) } catch { return name }
}

/** Upload one Director reference into CoNAI's persistent workflow input store. */
export async function uploadWorkflowInputAsset(file: File) {
  const formData = new FormData()
  formData.append('file', file, file.name)
  return requestApiData<WorkflowInputAssetRef>(withPublicWorkflowScope('/api/workflow-input-assets'), {
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
  return buildApiUrl(withPublicWorkflowScope(`/api/workflow-input-assets/${asset.id}`, searchParams))
}

/** Mark one removed Director draft asset for delayed server-side deletion. */
export async function deleteWorkflowInputAsset(assetId: string) {
  return requestApiData<{ removed: boolean }>(withPublicWorkflowScope(`/api/workflow-input-assets/${assetId}`), {
    method: 'DELETE',
  })
}
