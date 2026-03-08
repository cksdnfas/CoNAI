import { useCallback, useState } from 'react'
import type { ComplexSearchRequest } from '@conai/shared'
import type { ImageRecord, PageSize } from '@/types/image'
import { imageApi } from '@/services/image-api'

const DEFAULT_PAGE_SIZE: PageSize = 25

function shuffleIds(ids: string[]): string[] {
  const list = [...ids]
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const current = list[i]
    list[i] = list[j]
    list[j] = current
  }
  return list
}

export const useSearch = () => {
  const [images, setImages] = useState<ImageRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE)
  const [totalPages, setTotalPages] = useState(0)
  const [total, setTotal] = useState(0)

  const [lastRequest, setLastRequest] = useState<ComplexSearchRequest | null>(null)
  const [isShuffle, setIsShuffle] = useState(false)
  const [shuffledIds, setShuffledIds] = useState<string[]>([])

  const fetchBulk = useCallback(async (ids: string[]) => {
    if (ids.length === 0) {
      return []
    }

    const response = await imageApi.getImagesBulk(ids)
    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to load shuffled images')
    }
    return response.data.images
  }, [])

  const runComplexSearch = useCallback(
    async (request: ComplexSearchRequest, page: number, limit: number, append: boolean) => {
      const response = await imageApi.searchComplex({
        ...request,
        page,
        limit,
      })

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to search images')
      }

      const nextImages = response.data.images || []
      setImages((prev) => (append ? [...prev, ...nextImages] : nextImages))
      setCurrentPage(response.data.page || page)
      setTotalPages(response.data.totalPages || 0)
      setTotal(response.data.total || 0)
    },
    [],
  )

  const searchComplex = useCallback(
    async (request: ComplexSearchRequest, options?: { shuffle?: boolean }) => {
      const shuffle = options?.shuffle ?? false
      const limit = request.limit || pageSize
      const baseRequest: ComplexSearchRequest = {
        ...request,
        page: 1,
        limit,
      }

      setLoading(true)
      setError(null)

      try {
        if (shuffle) {
          const idsResponse = await imageApi.searchComplexIds(baseRequest)
          if (!idsResponse.success || !idsResponse.data) {
            throw new Error(idsResponse.error || 'Failed to load image IDs for shuffle')
          }

          const randomizedIds = shuffleIds(idsResponse.data.ids || [])
          const firstPageIds = randomizedIds.slice(0, limit)
          const firstPageImages = await fetchBulk(firstPageIds)

          setImages(firstPageImages)
          setCurrentPage(1)
          setTotal(randomizedIds.length)
          setTotalPages(Math.ceil(randomizedIds.length / limit))
          setIsShuffle(true)
          setShuffledIds(randomizedIds)
        } else {
          await runComplexSearch(baseRequest, 1, limit, false)
          setIsShuffle(false)
          setShuffledIds([])
        }

        setLastRequest(baseRequest)
      } catch (searchError) {
        const message = searchError instanceof Error ? searchError.message : 'Search failed'
        setError(message)
        setImages([])
        setTotal(0)
        setTotalPages(0)
      } finally {
        setLoading(false)
      }
    },
    [fetchBulk, pageSize, runComplexSearch],
  )

  const changePage = useCallback(
    async (nextPage: number) => {
      if (!lastRequest) return

      setLoading(true)
      setError(null)

      try {
        if (isShuffle && shuffledIds.length > 0) {
          const start = (nextPage - 1) * pageSize
          const end = start + pageSize
          const pageImages = await fetchBulk(shuffledIds.slice(start, end))
          setImages(pageImages)
          setCurrentPage(nextPage)
        } else {
          await runComplexSearch(lastRequest, nextPage, pageSize, false)
        }
      } catch (pageError) {
        const message = pageError instanceof Error ? pageError.message : 'Failed to change page'
        setError(message)
      } finally {
        setLoading(false)
      }
    },
    [fetchBulk, isShuffle, lastRequest, pageSize, runComplexSearch, shuffledIds],
  )

  const changePageSize = useCallback(
    async (nextPageSize: PageSize) => {
      setPageSize(nextPageSize)
      if (!lastRequest) return

      setLoading(true)
      setError(null)

      try {
        if (isShuffle && shuffledIds.length > 0) {
          const firstPageImages = await fetchBulk(shuffledIds.slice(0, nextPageSize))
          setImages(firstPageImages)
          setCurrentPage(1)
          setTotalPages(Math.ceil(shuffledIds.length / nextPageSize))
        } else {
          await runComplexSearch(lastRequest, 1, nextPageSize, false)
        }

        setLastRequest({
          ...lastRequest,
          page: 1,
          limit: nextPageSize,
        })
      } catch (pageSizeError) {
        const message = pageSizeError instanceof Error ? pageSizeError.message : 'Failed to change page size'
        setError(message)
      } finally {
        setLoading(false)
      }
    },
    [fetchBulk, isShuffle, lastRequest, runComplexSearch, shuffledIds],
  )

  const refreshSearch = useCallback(async () => {
    if (!lastRequest) return

    setLoading(true)
    setError(null)

    try {
      if (isShuffle && shuffledIds.length > 0) {
        const start = (currentPage - 1) * pageSize
        const end = start + pageSize
        const pageImages = await fetchBulk(shuffledIds.slice(start, end))
        setImages(pageImages)
      } else {
        await runComplexSearch(lastRequest, currentPage, pageSize, false)
      }
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : 'Failed to refresh search'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [currentPage, fetchBulk, isShuffle, lastRequest, pageSize, runComplexSearch, shuffledIds])

  const loadMore = useCallback(async () => {
    if (loading || !lastRequest || currentPage >= totalPages) return

    const nextPage = currentPage + 1
    setLoading(true)
    setError(null)

    try {
      if (isShuffle && shuffledIds.length > 0) {
        const start = (nextPage - 1) * pageSize
        const end = start + pageSize
        const pageImages = await fetchBulk(shuffledIds.slice(start, end))
        setImages((prev) => [...prev, ...pageImages])
        setCurrentPage(nextPage)
      } else {
        await runComplexSearch(lastRequest, nextPage, pageSize, true)
      }
    } catch (loadMoreError) {
      const message = loadMoreError instanceof Error ? loadMoreError.message : 'Failed to load more'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [currentPage, fetchBulk, isShuffle, lastRequest, loading, pageSize, runComplexSearch, shuffledIds, totalPages])

  return {
    images,
    loading,
    error,
    currentPage,
    pageSize,
    totalPages,
    total,
    isShuffle,
    searchComplex,
    changePage,
    changePageSize,
    refreshSearch,
    loadMore,
    hasMore: currentPage < totalPages,
  }
}
