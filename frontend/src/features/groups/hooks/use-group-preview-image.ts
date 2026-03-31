import { useQuery } from '@tanstack/react-query'
import type { ImageRecord } from '@/types/image'

interface UseGroupPreviewImageOptions {
  groupId: number
  sourceKey: string
  loadPreviewImage?: (groupId: number) => Promise<ImageRecord | null>
  enabled?: boolean
}

/** Load and cache the representative preview image for a group card. */
export function useGroupPreviewImage({
  groupId,
  sourceKey,
  loadPreviewImage,
  enabled = true,
}: UseGroupPreviewImageOptions) {
  return useQuery({
    queryKey: ['group-preview-image', sourceKey, groupId],
    queryFn: () => loadPreviewImage?.(groupId) ?? Promise.resolve(null),
    enabled: enabled && Number.isFinite(groupId) && Boolean(loadPreviewImage),
    staleTime: 60_000,
  })
}
