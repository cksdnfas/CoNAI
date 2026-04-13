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
}: {
  items: ImageRecord[]
  enabled?: boolean
  hasMore?: boolean
  isLoading?: boolean
  isError?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => Promise<unknown> | void
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
    () => items.filter((image) => itemSafetyById.get(getImageFeedSafetyKey(image))?.visibility !== 'hide'),
    [itemSafetyById, items],
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
      return safety?.tier ? <ImageRatingSafetyBadge tier={safety.tier} visibility={safety.visibility} /> : null
    },
    shouldBlurItemPreview: (image: ImageRecord) => itemSafetyById.get(getImageFeedSafetyKey(image))?.visibility === 'blur',
  }
}
