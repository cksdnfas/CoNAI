import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRatingTiers } from '@/lib/api-search'
import type { RatingTierRecord } from '@/features/search/search-types'
import type { ImageRecord } from '@/types/image'
import { ImageRatingSafetyBadge, resolveImageFeedSafety } from './image-rating-safety'

/**
 * 마지막으로 받은 티어 정책의 로컬 캐시.
 *
 * 티어 쿼리가 첫 페인트 뒤에 도착하면 미지 상태 기본값(블러)이 잠깐 전체에 적용됐다가
 * 풀리면서 리스트가 흔들린다. 직전 세션의 정책을 placeholder 로 쓰면 재방문 시 첫
 * 렌더부터 올바른 블러/숨김이 적용되고, 정책이 실제로 바뀐 경우에만 한 번 갱신된다.
 */
const RATING_TIERS_STORAGE_KEY = 'conai:rating-tiers:v1'

function readStoredRatingTiers(): RatingTierRecord[] | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  try {
    const rawValue = window.localStorage.getItem(RATING_TIERS_STORAGE_KEY)
    if (!rawValue) {
      return undefined
    }

    const parsed: unknown = JSON.parse(rawValue)
    return Array.isArray(parsed) ? parsed as RatingTierRecord[] : undefined
  } catch {
    return undefined
  }
}

function persistRatingTiers(tiers: RatingTierRecord[]) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(RATING_TIERS_STORAGE_KEY, JSON.stringify(tiers))
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}

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
    placeholderData: readStoredRatingTiers,
  })

  useEffect(() => {
    // placeholder 는 data 로도 노출되므로, 서버 응답이 실제로 도착했을 때만 저장한다.
    if (ratingTiersQuery.isSuccess && !ratingTiersQuery.isPlaceholderData && ratingTiersQuery.data) {
      persistRatingTiers(ratingTiersQuery.data)
    }
  }, [ratingTiersQuery.data, ratingTiersQuery.isPlaceholderData, ratingTiersQuery.isSuccess])

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

  // Cache overlay elements per item so memoized list cells keep stable props across re-renders.
  const persistentOverlayByKey = useMemo(() => {
    const overlays = new Map<string, ReactNode>()
    for (const [key, safety] of itemSafetyById) {
      if (!safety?.tier) {
        continue
      }

      overlays.set(key, <ImageRatingSafetyBadge tier={safety.tier} visibility={visibilityMode === 'badge-only' ? 'show' : safety.visibility} />)
    }
    return overlays
  }, [itemSafetyById, visibilityMode])

  const renderItemPersistentOverlay = useCallback(
    (image: ImageRecord) => persistentOverlayByKey.get(getImageFeedSafetyKey(image)) ?? null,
    [persistentOverlayByKey],
  )

  const shouldBlurItemPreview = useCallback((image: ImageRecord) => visibilityMode === 'badge-only'
    ? false
    : itemSafetyById.get(getImageFeedSafetyKey(image))?.visibility === 'blur',
  [itemSafetyById, visibilityMode])

  return {
    visibleItems,
    hasOnlyHiddenItems: items.length > 0 && visibleItems.length === 0,
    renderItemPersistentOverlay,
    shouldBlurItemPreview,
  }
}

