import type {
  AppSettings,
  TaggerDependencyCheckResult,
  TaggerModelInfo,
  TaggerServerStatus,
  TaggerSettings,
} from '@conai/shared'
import type { ApiResponse } from '@/types/image'
import { fetchJson } from '@/lib/api-client'
import { createApiFallbackError } from '@/i18n/api-error-fallbacks'

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

export async function updateTaggerSettings(settings: Partial<TaggerSettings>) {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings/tagger', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.tagger.update')
  }
  return response.data
}

export async function getTaggerModels() {
  const response = await fetchJson<ApiResponse<TaggerModelInfo[]>>('/api/settings/tagger/models')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.taggerModels.load')
  }
  return response.data
}

export async function getTaggerStatus() {
  const response = await fetchJson<ApiResponse<TaggerServerStatus>>('/api/settings/tagger/status')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.taggerStatus.load')
  }
  return response.data
}

export async function checkTaggerDependencies() {
  const response = await fetchJson<ApiResponse<TaggerDependencyCheckResult>>('/api/settings/tagger/check-dependencies', {
    method: 'POST',
  })
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.taggerDependencies.check')
  }
  return response.data
}

export async function runTaggerAutoTest(imageId: string) {
  const response = await fetchJson<ApiResponse<AutoTestTaggerResult>>('/api/settings/tagger/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageId }),
  })
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.taggerAutoTest.run')
  }
  return response.data
}
