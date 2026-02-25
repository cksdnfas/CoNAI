import { useCallback, useEffect, useState } from 'react'
import type { ImageListResponse, ImageRecord } from '@/types/image'
import { imageApi } from '@/services/image-api'

interface UsePaginatedImagesProps {
  pageSize: number
}

export const usePaginatedImages = ({ pageSize: initialPageSize }: UsePaginatedImagesProps) => {
  const [images, setImages] = useState<ImageRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(initialPageSize)
  const [totalPages, setTotalPages] = useState(0)
  const [total, setTotal] = useState(0)

  const fetchImages = useCallback(async (currentPage: number, currentLimit: number) => {
    setLoading(true)
    setError(null)

    try {
      const response: ImageListResponse = await imageApi.getImages(currentPage, currentLimit)
      if (response.success && response.data) {
        setImages(response.data.images)
        setTotalPages(response.data.totalPages)
        setTotal(response.data.total)
      } else {
        setError(response.error || 'Failed to fetch images')
      }
    } catch (fetchError) {
      setError('An error occurred while fetching images')
      console.error(fetchError)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchImages(page, pageSize)
  }, [fetchImages, page, pageSize])

  useEffect(() => {
    if (initialPageSize !== pageSize) {
      setPageSize(initialPageSize)
      setPage(1)
    }
  }, [initialPageSize, pageSize])

  const changePage = useCallback((newPage: number) => {
    setPage(newPage)
  }, [])

  const changePageSize = useCallback((newSize: number) => {
    setPageSize(newSize)
    setPage(1)
  }, [])

  const refreshImages = useCallback(async () => {
    await fetchImages(page, pageSize)
  }, [fetchImages, page, pageSize])

  return {
    images,
    loading,
    error,
    page,
    pageSize,
    totalPages,
    total,
    setPage: changePage,
    setPageSize: changePageSize,
    refreshImages,
  }
}
