import type { AppSettings, SimilaritySettings, SimilaritySortBy, SimilaritySortOrder } from '@/types/settings'
import type { SimilarityQueryResult } from '@/types/similarity'
import type { ApiResponse, ImageListPayload, ImageRecord } from '@/types/image'

const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

/** Trigger a browser download from the current frontend context. */
function triggerBrowserDownload(url: string, filename?: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  if (filename) {
    anchor.download = filename
  }
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** Trigger a Blob download using a temporary object URL. */
function triggerBlobDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob)
  try {
    triggerBrowserDownload(objectUrl, filename)
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
  }
}

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

export async function getAppSettings() {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings')
  if (!response.success) {
    throw new Error(response.error || '설정을 불러오지 못했어.')
  }
  return response.data
}

export async function updateSimilaritySettings(settings: Partial<SimilaritySettings>) {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings/similarity', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

  if (!response.success) {
    throw new Error(response.error || '유사도 설정을 저장하지 못했어.')
  }

  return response.data
}

export async function getImageDuplicates(compositeHash: string, threshold = 5) {
  const response = await fetchJson<ApiResponse<SimilarityQueryResult>>(
    `/api/images/${compositeHash}/duplicates?threshold=${threshold}`,
  )
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

  const response = await fetchJson<ApiResponse<SimilarityQueryResult>>(
    `/api/images/${compositeHash}/similar?${searchParams.toString()}`,
  )
  if (!response.success) {
    throw new Error(response.error || '유사 이미지를 불러오지 못했어.')
  }
  return response.data
}

/** Download one or many image originals, using ZIP for multi-select. */
export async function downloadImageSelection(compositeHashes: string[]) {
  if (compositeHashes.length === 0) {
    return
  }

  if (compositeHashes.length === 1) {
    triggerBrowserDownload(`${API_BASE}/api/images/${compositeHashes[0]}/download/original`)
    return
  }

  const response = await fetch(`${API_BASE}/api/images/download/batch`, {
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
