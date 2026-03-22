import { buildApiUrl, fetchJson, triggerBlobDownload, triggerBrowserDownload } from '@/lib/api-client'
import type { ApiResponse, ImageListPayload, ImageRecord } from '@/types/image'
import type { SimilaritySortBy, SimilaritySortOrder } from '@/types/settings'
import type { SimilarityQueryResult } from '@/types/similarity'

export async function getImages(params?: { page?: number; limit?: number }) {
  const searchParams = new URLSearchParams()
  searchParams.set('page', String(params?.page ?? 1))
  searchParams.set('limit', String(params?.limit ?? 12))
  searchParams.set('sortBy', 'first_seen_date')
  searchParams.set('sortOrder', 'DESC')

  const response = await fetchJson<ApiResponse<ImageListPayload>>(`/api/images?${searchParams.toString()}`)
  if (!response.success) {
    throw new Error(response.error || '이미지 목록을 불러오지 못했어.')
  }
  return response.data
}

export async function getImage(compositeHash: string) {
  const response = await fetchJson<ApiResponse<ImageRecord>>(`/api/images/${compositeHash}`)
  if (!response.success) {
    throw new Error(response.error || '이미지를 불러오지 못했어.')
  }
  return response.data
}

export async function getImageDuplicates(compositeHash: string, threshold = 5) {
  const response = await fetchJson<ApiResponse<SimilarityQueryResult>>(`/api/images/${compositeHash}/duplicates?threshold=${threshold}`)
  if (!response.success) {
    throw new Error(response.error || '중복 이미지를 불러오지 못했어.')
  }
  return response.data
}

export async function getSimilarImages(
  compositeHash: string,
  params?: {
    threshold?: number
    limit?: number
    includeColorSimilarity?: boolean
    sortBy?: SimilaritySortBy
    sortOrder?: SimilaritySortOrder
  },
) {
  const searchParams = new URLSearchParams()
  searchParams.set('threshold', String(params?.threshold ?? 15))
  searchParams.set('limit', String(params?.limit ?? 24))
  searchParams.set('includeColorSimilarity', String(params?.includeColorSimilarity ?? false))
  searchParams.set('sortBy', params?.sortBy ?? 'similarity')
  searchParams.set('sortOrder', params?.sortOrder ?? 'DESC')

  const response = await fetchJson<ApiResponse<SimilarityQueryResult>>(`/api/images/${compositeHash}/similar?${searchParams.toString()}`)
  if (!response.success) {
    throw new Error(response.error || '유사 이미지를 불러오지 못했어.')
  }
  return response.data
}

export async function downloadImageSelection(compositeHashes: string[]) {
  if (compositeHashes.length === 0) {
    return
  }

  if (compositeHashes.length === 1) {
    triggerBrowserDownload(buildApiUrl(`/api/images/${compositeHashes[0]}/download/original`))
    return
  }

  const response = await fetch(buildApiUrl('/api/images/download/batch'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/zip',
    },
    body: JSON.stringify({ compositeHashes }),
  })

  if (!response.ok) {
    throw new Error(`Batch download failed: ${response.status}`)
  }

  const blob = await response.blob()
  triggerBlobDownload(blob, `conai-images-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.zip`)
}
