import { useEffect, useRef } from 'react'

interface UseImageListLoadMoreParams {
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore?: () => Promise<unknown> | void
}

/** Trigger infinite loading when the sentinel becomes visible in the viewport. */
export function useImageListLoadMore({ hasMore, isLoadingMore, onLoadMore }: UseImageListLoadMoreParams) {
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const isLoadMorePendingRef = useRef(false)
  // Track the latest callback in a ref so per-render identity changes never rebuild the observer.
  const onLoadMoreRef = useRef(onLoadMore)
  const isLoadingMoreRef = useRef(isLoadingMore)
  const hasLoadMoreCallback = Boolean(onLoadMore)

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore
    if (!hasMore || !onLoadMore) {
      isLoadMorePendingRef.current = false
    }
  }, [hasMore, onLoadMore])

  useEffect(() => {
    isLoadingMoreRef.current = isLoadingMore
    if (!isLoadingMore) {
      isLoadMorePendingRef.current = false
    }
  }, [isLoadingMore])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore || !hasLoadMoreCallback) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting || isLoadingMoreRef.current || isLoadMorePendingRef.current) return

        const loadMore = onLoadMoreRef.current
        if (!loadMore) return

        isLoadMorePendingRef.current = true
        void Promise.resolve(loadMore()).finally(() => {
          requestAnimationFrame(() => {
            if (!isLoadingMoreRef.current) {
              isLoadMorePendingRef.current = false
            }
          })
        })
      },
      {
        root: null,
        rootMargin: '1200px 0px 1200px 0px',
        threshold: 0,
      },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, hasLoadMoreCallback, isLoadingMore])

  return sentinelRef
}
