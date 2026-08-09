import type { AppearanceSettings, AppSettings } from '@conai/shared'
import type { ApiResponse } from '@/types/image'
import { fetchJson } from '@/lib/api-client'
import { requestJson } from '@/lib/api-request'
import { createApiFallbackError } from '@/i18n/api-error-fallbacks'

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
}

export async function getPublicAppearanceSettings() {
  const response = await fetchJson<ApiResponse<AppearanceSettings>>('/api/settings/appearance-public')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.appearancePublic.load')
  }
  return response.data
}

export async function getWallpaperRuntimeSettings() {
  const response = await fetchJson<ApiResponse<WallpaperRuntimeSettings>>('/api/wallpaper-runtime/settings')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.wallpaperRuntime.load')
  }
  return response.data
}

export async function updateAppearanceSettings(settings: Partial<AppearanceSettings>) {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings/appearance', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.appearance.update')
  }
  return response.data
}

export async function uploadAppearanceFont(file: File, target: 'sans' | 'mono') {
  const formData = new FormData()
  formData.append('font', file)
  formData.append('target', target)

  const payload = await requestJson<ApiResponse<AppearanceFontUploadResult>>('/api/settings/appearance/font-upload', {
    method: 'POST',
    body: formData,
  })
  if (!payload.success) {
    throw createApiFallbackError(payload.error, 'settings.appearanceFont.upload')
  }
  return payload.data
}
