import { createApiFallbackError } from '@/i18n/api-error-fallbacks'
import { fetchJson } from '@/lib/api-client'
import type { GraphWorkflowBrowseContentRecord } from '@/lib/api-module-graph'
import type { ImageRecord } from '@/types/image'
import type { ApiResponse } from '@/types/image'

/** Load the read-only workflow browse snapshot used by wallpaper live widgets. */
export async function getWallpaperRuntimeBrowseContent(folderId?: number | null) {
  const searchParams = new URLSearchParams()
  if (typeof folderId === 'number') {
    searchParams.set('folder_id', String(folderId))
  }

  const response = await fetchJson<ApiResponse<GraphWorkflowBrowseContentRecord>>(`/api/wallpaper-runtime/browse-content${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`)
  if (!response.success) {
    throw createApiFallbackError(response.error, 'wallpaperRuntime.browseContent.load')
  }
  return response.data
}

/** Load one read-only group preview image list for wallpaper live widgets. */
export async function getWallpaperRuntimeGroupPreviewImages(groupId: number, params?: { includeChildren?: boolean; count?: number }) {
  const searchParams = new URLSearchParams()
  searchParams.set('count', String(params?.count ?? 1))
  searchParams.set('includeChildren', String(params?.includeChildren ?? true))

  const response = await fetchJson<ApiResponse<ImageRecord[]>>(`/api/wallpaper-runtime/groups/${groupId}/preview-images?${searchParams.toString()}`)
  if (!response.success) {
    throw createApiFallbackError(response.error, 'wallpaperRuntime.groupPreview.load')
  }
  return response.data
}
