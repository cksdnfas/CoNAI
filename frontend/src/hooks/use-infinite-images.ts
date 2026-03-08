import { useCallback, useMemo } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { PageSize } from '@/types/image'
import { imageApi } from '@/services/image-api'

const PAGE_SIZE: PageSize = 50

interface CursorParam {
  cursorDate: string
  cursorHash: string
}

export const useInfiniteImages = () => {
  const queryClient = useQueryClient()

  const { data, error, fetchNextPage, hasNextPage, isFetching, isFetchingNextPage, refetch } = useInfiniteQuery({
    queryKey: ['images', 'infinite'],
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam as CursorParam | undefined
      const response = await imageApi.getImages(
        1,
        PAGE_SIZE,
        'first_seen_date',
        'DESC',
        cursor,
      )

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to fetch images')
      }

      return response.data
    },
    getNextPageParam: (lastPage) => {
      // 백엔드의 hasMore를 신뢰 (limit+1 방식으로 정확하게 계산됨)
      const hasMore = (lastPage as any).hasMore
      if (hasMore === false || lastPage.images.length === 0) {
        return undefined
      }

      // hasMore가 없는 경우에만 fallback (이전 호환)
      if (hasMore === undefined && lastPage.images.length < PAGE_SIZE) {
        return undefined
      }

      // 마지막 이미지의 first_seen_date와 composite_hash를 커서로 사용
      const lastImage = lastPage.images[lastPage.images.length - 1]
      if (!lastImage?.first_seen_date || !lastImage?.composite_hash) {
        return undefined
      }

      return {
        cursorDate: lastImage.first_seen_date,
        cursorHash: lastImage.composite_hash,
      } as CursorParam
    },
    initialPageParam: undefined as CursorParam | undefined,
    staleTime: 60000,
    gcTime: 300000,
  })

  // composite_hash 기준으로 중복 제거 (같은 hash에 여러 file이 있으면 첫 번째만)
  const images = useMemo(() => {
    const all = data?.pages.flatMap((page) => page.images) ?? []
    const seen = new Set<string>()
    return all.filter((img) => {
      if (!img.composite_hash) return true
      if (seen.has(img.composite_hash)) return false
      seen.add(img.composite_hash)
      return true
    })
  }, [data])

  // raw total (중복 포함) — InfiniteScroll의 dataLength 감지용
  const rawTotal = useMemo(() => {
    return data?.pages.reduce((sum, page) => sum + page.images.length, 0) ?? 0
  }, [data])

  const loading = isFetching && !isFetchingNextPage
  const errorMessage = error instanceof Error ? error.message : null

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage()
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const refreshImages = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['images'] })
    await refetch()
  }, [queryClient, refetch])

  return {
    images,
    rawTotal,
    loading,
    error: errorMessage,
    hasMore: hasNextPage ?? false,
    loadMore,
    refreshImages,
  }
}
