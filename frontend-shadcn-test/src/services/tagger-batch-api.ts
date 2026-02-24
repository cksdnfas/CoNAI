import { apiClient } from '@/lib/api/client'

export const taggerBatchApi = {
  async testImage(imageId: string): Promise<unknown> {
    const response = await apiClient.post<{ success: boolean; data: unknown }>(`/api/images/${imageId}/tag`)
    return response.data.data
  },
}
