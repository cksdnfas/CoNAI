import type { PageSettingsScopeId, PageSettingsSnapshot, PageSettingValue } from '@conai/shared'
import { fetchJson } from './api-client'

export async function readPageSettings(scope: PageSettingsScopeId, signal?: AbortSignal): Promise<PageSettingsSnapshot> {
  const response = await fetchJson<{ success: boolean; data: PageSettingsSnapshot; error?: string }>(`/api/page-settings/${scope}`, { signal })
  if (!response.success) throw new Error(response.error)
  return response.data
}
export async function savePageSettings(scope: PageSettingsScopeId, revision: string, patch: Record<string, PageSettingValue>): Promise<PageSettingsSnapshot> {
  const response = await fetchJson<{ success: boolean; data: PageSettingsSnapshot; error?: string }>(`/api/page-settings/${scope}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': revision }, body: JSON.stringify(patch),
  })
  if (!response.success) throw new Error(response.error)
  return response.data
}
