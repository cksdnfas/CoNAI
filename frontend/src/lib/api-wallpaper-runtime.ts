import { createApiFallbackError } from '@/i18n/api-error-fallbacks'
import { fetchJson } from '@/lib/api-client'
import type { GraphWorkflowBrowseContentRecord } from '@/lib/api-module-graph'
import type { ImageRecord } from '@/types/image'
import type { ApiResponse } from '@/types/image'

async function requestWallpaperRuntimeData<T>(path: string, fallbackKey: Parameters<typeof createApiFallbackError>[1]) {
  const response = await fetchJson<ApiResponse<T>>(path)
  if (!response.success) {
    throw createApiFallbackError(response.error, fallbackKey)
  }
  return response.data
}

/** Load the read-only workflow browse snapshot used by wallpaper live widgets. */
export async function getWallpaperRuntimeBrowseContent(folderId?: number | null) {
  const searchParams = new URLSearchParams()
  if (typeof folderId === 'number') {
    searchParams.set('folder_id', String(folderId))
  }

  return requestWallpaperRuntimeData<GraphWorkflowBrowseContentRecord>(`/api/wallpaper-runtime/browse-content${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`, 'wallpaperRuntime.browseContent.load')
}

/** Load one read-only group preview image list for wallpaper live widgets. */
export async function getWallpaperRuntimeGroupPreviewImages(groupId: number, params?: { includeChildren?: boolean; count?: number }) {
  const searchParams = new URLSearchParams()
  searchParams.set('count', String(params?.count ?? 1))
  searchParams.set('includeChildren', String(params?.includeChildren ?? true))

  return requestWallpaperRuntimeData<ImageRecord[]>(`/api/wallpaper-runtime/groups/${groupId}/preview-images?${searchParams.toString()}`, 'wallpaperRuntime.groupPreview.load')
}
