import type { PluginDraft, PluginDraftFile, PluginDraftSummary, PluginPackageReview } from '@conai/shared'
import { pluginRequest } from './api-plugins'
import { buildApiUrl } from './api-url'
import { prepareDownloadTarget, readDownloadBlob, saveDownloadBlob } from './download-utils'

const root = '/authoring'
export const PLUGIN_DRAFTS_QUERY_KEY = ['plugin-drafts'] as const
export const listPluginDrafts = () => pluginRequest<PluginDraftSummary[]>(`${root}/drafts`)
export const getPluginDraft = (id: string) => pluginRequest<PluginDraft>(`${root}/drafts/${id}`)
export const createPluginDraft = (input: { requestId: string; pluginId: string; name?: string; fromInstalled?: boolean }) => pluginRequest<PluginDraft>(`${root}/drafts`, 'POST', input)
export const readPluginDraft = (draftId: string, target: string, revision: number, offset = 0) => pluginRequest<PluginDraftFile>(`${root}/read`, 'POST', { draftId, target, revision, offset, limit: 128 * 1024 })
export type PluginDraftChange = { kind: 'write'; target: string; text: string } | { kind: 'delete'; target: string } | { kind: 'move'; target: string; destination: string }
export const changePluginDraft = (draftId: string, revision: number, requestId: string, operations: PluginDraftChange[]) => pluginRequest<PluginDraft>(`${root}/changes`, 'POST', { draftId, revision, requestId, operations })
export const reviewPluginDraft = (draftId: string, revision: number) => pluginRequest<PluginPackageReview>(`${root}/review`, 'POST', { draftId, revision })
export const installPluginDraft = (review: PluginPackageReview) => pluginRequest<{ pluginId: string; version: string; enabled: boolean }>(`${root}/install`, 'POST', { draftId: review.draftId, revision: review.revision, digest: review.digest, enabled: review.enabled })
export const deletePluginDraft = (draftId: string, revision: number) => pluginRequest(`${root}/drafts/${draftId}`, 'DELETE', { revision })
export function uploadPluginDraftAsset(draftId: string, revision: number, requestId: string, target: string, file: File, replace: boolean) {
  const body = new FormData()
  for (const [key, value] of Object.entries({ draftId, revision, requestId, target, replace })) body.append(key, String(value))
  body.append('file', file)
  return pluginRequest<PluginDraft>(`${root}/upload`, 'POST', body)
}
export async function downloadPluginPackage(filename: string, source: { pluginId: string } | { draftId: string; revision: number }) {
  const target = await prepareDownloadTarget(filename)
  if (!target) return
  const installed = 'pluginId' in source
  const response = await fetch(buildApiUrl(`/api/plugins${root}${installed ? `/installed/${encodeURIComponent(source.pluginId)}/export` : '/export'}`), {
    method: installed ? 'GET' : 'POST', credentials: 'include',
    headers: { 'X-CoNAI-Plugin-Host': '1', ...(!installed ? { 'Content-Type': 'application/json' } : {}) },
    ...(!installed ? { body: JSON.stringify(source) } : {}),
  })
  await saveDownloadBlob(target, await readDownloadBlob(response), filename)
}
