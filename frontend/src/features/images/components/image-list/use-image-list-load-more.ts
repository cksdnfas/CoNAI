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

  useEffect(() => {
    if (!hasMore || !onLoadMore) {
      isLoadMorePendingRef.current = false
    }
  }, [hasMore, onLoadMore])

  useEffect(() => {
    if (!isLoadingMore) {
      isLoadMorePendingRef.current = false
    }
  }, [isLoadingMore])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore || !onLoadMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting || isLoadingMore || isLoadMorePendingRef.current) return

        isLoadMorePendingRef.current = true
        void Promise.resolve(onLoadMore()).finally(() => {
          requestAnimationFrame(() => {
            if (!isLoadingMore) {
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
  }, [hasMore, isLoadingMore, onLoadMore])

  return sentinelRef
}
