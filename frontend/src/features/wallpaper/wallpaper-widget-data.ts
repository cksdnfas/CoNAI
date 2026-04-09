import { useQuery } from '@tanstack/react-query'
import { getGraphWorkflowBrowseContent, getGroupPreviewImages } from '@/lib/api'

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
    queryFn: () => getGroupPreviewImages(groupId as number, { includeChildren, count }),
    enabled: groupId !== null,
    staleTime: 5 * 60_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  })
}
