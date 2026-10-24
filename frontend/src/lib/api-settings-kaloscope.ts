import type { PageSettingsVersions } from '@conai/shared'
import type { AppSettings, KaloscopeServerStatus, KaloscopeSettings } from '@conai/shared'
import { fetchApiData } from '@/lib/api-client'

export interface AutoTestKaloscopeResult {
  model?: string
  topk?: number
  artists?: Record<string, number>
  taglist?: string
  tagged_at?: string
}

export async function updateKaloscopeSettings(settings: Partial<KaloscopeSettings>, revision?: string) {
  return fetchApiData<AppSettings & PageSettingsVersions>('/api/settings/kaloscope', 'settings.kaloscope.update', {
    method: 'PUT',
    headers: { ...(revision ? { 'If-Match': revision } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
}

export async function getKaloscopeStatus() {
  return fetchApiData<KaloscopeServerStatus>('/api/settings/kaloscope/status', 'settings.kaloscopeStatus.load')
}

export async function runKaloscopeAutoTest(imageId: string) {
  return fetchApiData<AutoTestKaloscopeResult>('/api/settings/kaloscope/test', 'settings.kaloscopeAutoTest.run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageId }),
  })
}
