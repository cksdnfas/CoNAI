import type { PageSettingsVersions } from '@conai/shared'
import type { AppearanceSettings, AppSettings } from '@conai/shared'
import { fetchApiData } from '@/lib/api-client'

export interface AppearanceFontUploadResult {
  target: 'sans' | 'mono'
  fileName: string
  originalName: string
  url: string
  mimeType: string
  size: number
}

export interface WallpaperRuntimeSettings {
  wallpaperLayoutPresets: AppearanceSettings['wallpaperLayoutPresets']
  wallpaperActivePresetId: string | null
  wallpaperSchedule?: AppearanceSettings['wallpaperSchedule']
}

export async function getPublicAppearanceSettings() {
  return fetchApiData<AppearanceSettings>('/api/settings/appearance-public', 'settings.appearancePublic.load')
}

export async function getWallpaperRuntimeSettings() {
  return fetchApiData<WallpaperRuntimeSettings>('/api/wallpaper-runtime/settings', 'settings.wallpaperRuntime.load')
}

export async function updateAppearanceSettings(settings: Partial<AppearanceSettings>, revision?: string) {
  return fetchApiData<AppSettings & PageSettingsVersions>('/api/settings/appearance', 'settings.appearance.update', {
    method: 'PUT',
    headers: { ...(revision ? { 'If-Match': revision } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
}

export async function uploadAppearanceFont(file: File, target: 'sans' | 'mono') {
  const formData = new FormData()
  formData.append('font', file)
  formData.append('target', target)

  return fetchApiData<AppearanceFontUploadResult>('/api/settings/appearance/font-upload', 'settings.appearanceFont.upload', {
    method: 'POST',
    body: formData,
  })
}
