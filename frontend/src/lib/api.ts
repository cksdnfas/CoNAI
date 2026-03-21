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
