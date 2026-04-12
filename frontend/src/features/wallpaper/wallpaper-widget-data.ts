import { useQuery } from '@tanstack/react-query'
import { getGraphWorkflowBrowseContent, getGroupPreviewImages } from '@/lib/api'
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

/** Load shared browse-content data for wallpaper widgets with a widget-scoped refresh cadence. */
export function useWallpaperBrowseContentQuery(scope: string, refreshIntervalMs: number) {
  return useQuery({
    queryKey: ['wallpaper-widget', scope, 'browse-content', refreshIntervalMs],
    queryFn: () => getGraphWorkflowBrowseContent(),
    staleTime: Math.max(1_000, refreshIntervalMs - 1_000),
    refetchInterval: refreshIntervalMs,
  })
}

/** Load one wallpaper widget image set from the existing group preview API. */
export function useWallpaperGroupPreviewImagesQuery(scope: string, groupId: number | null, includeChildren: boolean, count: number) {
  return useQuery({
    queryKey: ['wallpaper-widget', scope, groupId, includeChildren, count],
    queryFn: async () => {
      const images = await getGroupPreviewImages(groupId as number, { includeChildren, count })
      return dedupeWallpaperPreviewImages(images)
    },
    enabled: groupId !== null,
    staleTime: 5 * 60_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  })
}
