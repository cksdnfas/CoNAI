import type { PageSettingsVersions } from '@conai/shared'
import type {
  AppSettings,
  GeneralSettings,
  PublicHeaderNavigationSettings,
  ServerTimeZoneInfo,
} from '@conai/shared'
import { requestApiData } from '@/lib/api-request'

export type NativeSettingsVersions = PageSettingsVersions & {
  pageSettingsRevisions?: NonNullable<PageSettingsVersions['pageSettingsRevisions']> & { 'ai-runtime'?: string }
}

export async function getAppSettings() {
  return requestApiData<AppSettings & NativeSettingsVersions>('/api/settings', 'settings.app.load')
}

export async function getPublicHeaderNavigationSettings() {
  return requestApiData<PublicHeaderNavigationSettings>('/api/settings/header-navigation-public', 'settings.headerNavigationPublic.load')
}

export const SERVER_TIME_ZONE_QUERY_KEY = ['server-time-zone'] as const

/** The zone the server's clock runs in and its time (admin-only, like every settings route). */
export async function getServerTimeZone() {
  return requestApiData<ServerTimeZoneInfo>('/api/settings/time-zone', 'settings.timeZone.load')
}

export async function updateGeneralSettings(settings: Partial<GeneralSettings>, revision?: string) {
  return requestApiData<AppSettings & PageSettingsVersions>('/api/settings/general', 'settings.general.update', {
    method: 'PUT',
    headers: { ...(revision ? { 'If-Match': revision } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
}
