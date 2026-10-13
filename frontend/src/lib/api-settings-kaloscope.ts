import type { PageSettingsVersions } from '@conai/shared'
import type { AppSettings, KaloscopeServerStatus, KaloscopeSettings } from '@conai/shared'
import type { ApiResponse } from '@/types/image'
import { fetchJson } from '@/lib/api-client'
import { createApiFallbackError } from '@/i18n/api-error-fallbacks'

export interface AutoTestKaloscopeResult {
  model?: string
  topk?: number
  artists?: Record<string, number>
  taglist?: string
  tagged_at?: string
}

export async function updateKaloscopeSettings(settings: Partial<KaloscopeSettings>, revision?: string) {
  const response = await fetchJson<ApiResponse<AppSettings & PageSettingsVersions>>('/api/settings/kaloscope', {
    method: 'PUT',
    headers: { ...(revision ? { 'If-Match': revision } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.kaloscope.update')
  }
  return response.data
}

export async function getKaloscopeStatus() {
  const response = await fetchJson<ApiResponse<KaloscopeServerStatus>>('/api/settings/kaloscope/status')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.kaloscopeStatus.load')
  }
  return response.data
}

export async function runKaloscopeAutoTest(imageId: string) {
  const response = await fetchJson<ApiResponse<AutoTestKaloscopeResult>>('/api/settings/kaloscope/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageId }),
  })
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.kaloscopeAutoTest.run')
  }
  return response.data
}
