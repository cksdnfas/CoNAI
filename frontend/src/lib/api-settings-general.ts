import type { PageSettingsVersions } from '@conai/shared'
import type {
  AppSettings,
  GeneralSettings,
  PublicHeaderNavigationSettings,
} from '@conai/shared'
import type { ApiResponse } from '@/types/image'
import { fetchJson } from '@/lib/api-client'
import { createApiFallbackError } from '@/i18n/api-error-fallbacks'

export async function getAppSettings() {
  const response = await fetchJson<ApiResponse<AppSettings & PageSettingsVersions>>('/api/settings')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.app.load')
  }
  return response.data
}

export async function getPublicHeaderNavigationSettings() {
  const response = await fetchJson<ApiResponse<PublicHeaderNavigationSettings>>('/api/settings/header-navigation-public')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.headerNavigationPublic.load')
  }
  return response.data
}

export async function updateGeneralSettings(settings: Partial<GeneralSettings>, revision?: string) {
  const response = await fetchJson<ApiResponse<AppSettings & PageSettingsVersions>>('/api/settings/general', {
    method: 'PUT',
    headers: { ...(revision ? { 'If-Match': revision } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.general.update')
  }
  return response.data
}
