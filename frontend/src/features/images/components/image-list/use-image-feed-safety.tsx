import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRatingTiers } from '@/lib/api-search'
import type { ImageRecord } from '@/types/image'
import { ImageRatingSafetyBadge, resolveImageFeedSafety } from './image-rating-safety'

function getImageFeedSafetyKey(image: ImageRecord) {
  return String(image.composite_hash ?? image.id)
}

/** Reuse the same feed safety resolution across Home and Group image lists. */
export function useImageFeedSafety({
  items,
  enabled = true,
  hasMore = false,
  isLoading = false,
  isError = false,
  isLoadingMore = false,
  onLoadMore,
  visibilityMode = 'feed',
}: {
  items: ImageRecord[]
  enabled?: boolean
  hasMore?: boolean
  isLoading?: boolean
  isError?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => Promise<unknown> | void
  visibilityMode?: 'feed' | 'badge-only'
}) {
  const ratingTiersQuery = useQuery({
    queryKey: ['rating-tiers'],
    queryFn: getRatingTiers,
    enabled,
    staleTime: 60_000,
  })

  const itemSafetyById = useMemo(
    () => new Map(items.map((image) => [getImageFeedSafetyKey(image), resolveImageFeedSafety(image, ratingTiersQuery.data)])),
    [items, ratingTiersQuery.data],
  )

  const visibleItems = useMemo(
    () => visibilityMode === 'badge-only'
      ? items
      : items.filter((image) => itemSafetyById.get(getImageFeedSafetyKey(image))?.visibility !== 'hide'),
    [itemSafetyById, items, visibilityMode],
  )

  useEffect(() => {
    if (!onLoadMore || isLoading || isError || isLoadingMore) {
      return
    }

    if (items.length === 0 || visibleItems.length > 0 || !hasMore) {
      return
    }

    void onLoadMore()
  }, [hasMore, isError, isLoading, isLoadingMore, items.length, onLoadMore, visibleItems.length])

  return {
    visibleItems,
    hasOnlyHiddenItems: items.length > 0 && visibleItems.length === 0,
    renderItemPersistentOverlay: (image: ImageRecord) => {
      const safety = itemSafetyById.get(getImageFeedSafetyKey(image))
      if (!safety?.tier) {
        return null
      }

      return <ImageRatingSafetyBadge tier={safety.tier} visibility={visibilityMode === 'badge-only' ? 'show' : safety.visibility} />
    },
    shouldBlurItemPreview: (image: ImageRecord) => visibilityMode === 'badge-only'
      ? false
      : itemSafetyById.get(getImageFeedSafetyKey(image))?.visibility === 'blur',
  }
}
