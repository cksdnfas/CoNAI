import { useCallback, useMemo } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { PageSize } from '@/types/image'
import { imageApi } from '@/services/image-api'

const PAGE_SIZE: PageSize = 50

export const useInfiniteImages = () => {
  const queryClient = useQueryClient()

  const { data, error, fetchNextPage, hasNextPage, isFetching, isFetchingNextPage, refetch } = useInfiniteQuery({
    queryKey: ['images', 'infinite'],
    queryFn: async ({ pageParam = 1 }) => {
      const response = await imageApi.getImages(pageParam, PAGE_SIZE)

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to fetch images')
      }

      return response.data
    },
    getNextPageParam: (lastPage) => {
      return lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined
    },
    initialPageParam: 1,
    staleTime: 60000,
    gcTime: 300000,
  })

  const images = useMemo(() => data?.pages.flatMap((page) => page.images) ?? [], [data])
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
    loading,
    error: errorMessage,
    hasMore: hasNextPage ?? false,
    loadMore,
    refreshImages,
  }
}
