import { apiClient } from '@/lib/api/client'
import type {
  HealthResponse,
  ImagesResponse,
  SettingsResponse,
} from '@/lib/api/types'

export const fetchHealth = async (): Promise<HealthResponse> => {
  const { data } = await apiClient.get<HealthResponse>('/health')
  return data
}

export const fetchSettings = async () => {
  const { data } = await apiClient.get<SettingsResponse>('/api/settings')
  return data
}

export const fetchImages = async (limit = 12) => {
  const { data } = await apiClient.get<ImagesResponse>(`/api/images?page=1&limit=${limit}`)
  return data
}

export const buildThumbnailUrl = (compositeHash: string) => `/api/images/${compositeHash}/thumbnail`
