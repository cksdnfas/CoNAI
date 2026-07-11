import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getWallpaperRuntimeBrowseContent, getWallpaperRuntimeGroupPreviewImages } from '@/lib/api-wallpaper-runtime'
import type { ImageRecord } from '@/types/image'

function getWallpaperPreviewImageKey(image: ImageRecord) {
  return String(
    image.composite_hash
      ?? image.id
      ?? image.original_file_path
      ?? image.image_url
      ?? image.thumbnail_url
      ?? '',
  )
}

function dedupeWallpaperPreviewImages(images: ImageRecord[]) {
  const seenKeys = new Set<string>()
  return images.filter((image) => {
    const key = getWallpaperPreviewImageKey(image)
    if (!key || seenKeys.has(key)) {
      return false
    }

    seenKeys.add(key)
    return true
  })
}

const WALLPAPER_BROWSE_CONTENT_QUERY_KEY = ['wallpaper-widget', 'browse-content'] as const
const browseContentRefreshIntervals = new Map<string, number>()
let browseContentRefreshTimer: ReturnType<typeof setInterval> | null = null

function syncBrowseContentRefreshTimer(refetch: () => void) {
  if (browseContentRefreshTimer) {
    clearInterval(browseContentRefreshTimer)
    browseContentRefreshTimer = null
  }

  const activeIntervals = Array.from(browseContentRefreshIntervals.values())
  if (activeIntervals.length === 0) {
    return
  }

  browseContentRefreshTimer = setInterval(refetch, Math.min(...activeIntervals))
}

/** Load one shared browse-content query at the shortest active widget cadence. */
export function useWallpaperBrowseContentQuery(scope: string, refreshIntervalMs: number) {
  const queryClient = useQueryClient()

  useEffect(() => {
    browseContentRefreshIntervals.set(scope, refreshIntervalMs)
    const refetch = () => {
      void queryClient.refetchQueries({ queryKey: WALLPAPER_BROWSE_CONTENT_QUERY_KEY, type: 'active' })
    }
    syncBrowseContentRefreshTimer(refetch)

    return () => {
      browseContentRefreshIntervals.delete(scope)
      syncBrowseContentRefreshTimer(refetch)
    }
  }, [queryClient, refreshIntervalMs, scope])

  return useQuery({
    queryKey: WALLPAPER_BROWSE_CONTENT_QUERY_KEY,
    queryFn: () => getWallpaperRuntimeBrowseContent(),
    staleTime: 1_000,
    refetchInterval: false,
  })
}

/** Load one wallpaper widget image set from the existing group preview API. */
export function useWallpaperGroupPreviewImagesQuery(scope: string, groupId: number | null, includeChildren: boolean, count: number) {
  return useQuery({
    queryKey: ['wallpaper-widget', scope, groupId, includeChildren, count],
    queryFn: async () => {
      const images = await getWallpaperRuntimeGroupPreviewImages(groupId as number, { includeChildren, count })
      return dedupeWallpaperPreviewImages(images)
    },
    enabled: groupId !== null,
    staleTime: 5 * 60_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  })
}
