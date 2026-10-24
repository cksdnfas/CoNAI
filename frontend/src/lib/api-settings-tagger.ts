import type { PageSettingsVersions } from '@conai/shared'
import type {
  AppSettings,
  TaggerDependencyCheckResult,
  TaggerModelInfo,
  TaggerServerStatus,
  TaggerSettings,
} from '@conai/shared'
import { fetchApiData } from '@/lib/api-client'

export interface AutoTestTaggerResult {
  caption?: string
  taglist?: string
  model?: string
  rating?: Record<string, number>
  general?: Record<string, number>
  character?: Record<string, number>
  thresholds?: {
    general: number
    character: number
  }
}

export async function updateTaggerSettings(settings: Partial<TaggerSettings>, revision?: string) {
  return fetchApiData<AppSettings & PageSettingsVersions>('/api/settings/tagger', 'settings.tagger.update', {
    method: 'PUT',
    headers: { ...(revision ? { 'If-Match': revision } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
}

export async function getTaggerModels() {
  return fetchApiData<TaggerModelInfo[]>('/api/settings/tagger/models', 'settings.taggerModels.load')
}

export async function getTaggerStatus() {
  return fetchApiData<TaggerServerStatus>('/api/settings/tagger/status', 'settings.taggerStatus.load')
}

export async function checkTaggerDependencies() {
  return fetchApiData<TaggerDependencyCheckResult>('/api/settings/tagger/check-dependencies', 'settings.taggerDependencies.check', {
    method: 'POST',
  })
}

export async function runTaggerAutoTest(imageId: string) {
  return fetchApiData<AutoTestTaggerResult>('/api/settings/tagger/test', 'settings.taggerAutoTest.run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageId }),
  })
}
