import type {
  AppSettings,
  GeneralSettings,
  HeaderNavigationSettings,
} from '@conai/shared'
import type { ApiResponse } from '@/types/image'
import { fetchJson } from '@/lib/api-client'
import { createApiFallbackError } from '@/i18n/api-error-fallbacks'

export async function getAppSettings() {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.app.load')
  }
  return response.data
}

export async function getPublicHeaderNavigationSettings() {
  const response = await fetchJson<ApiResponse<HeaderNavigationSettings>>('/api/settings/header-navigation-public')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.headerNavigationPublic.load')
  }
  return response.data
}

export async function updateGeneralSettings(settings: Partial<GeneralSettings>) {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings/general', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.general.update')
  }
  return response.data
}
