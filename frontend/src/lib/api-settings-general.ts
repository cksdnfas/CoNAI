import type { PageSettingsVersions } from '@conai/shared'
import type {
  AppSettings,
  GeneralSettings,
  PublicHeaderNavigationSettings,
} from '@conai/shared'
import { fetchApiData } from '@/lib/api-client'

export async function getAppSettings() {
  return fetchApiData<AppSettings & PageSettingsVersions>('/api/settings', 'settings.app.load')
}

export async function getPublicHeaderNavigationSettings() {
  return fetchApiData<PublicHeaderNavigationSettings>('/api/settings/header-navigation-public', 'settings.headerNavigationPublic.load')
}

export async function updateGeneralSettings(settings: Partial<GeneralSettings>, revision?: string) {
  return fetchApiData<AppSettings & PageSettingsVersions>('/api/settings/general', 'settings.general.update', {
    method: 'PUT',
    headers: { ...(revision ? { 'If-Match': revision } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
}
