import { apiClient } from '@/lib/api/client'

export const taggerBatchApi = {
  async testImage(imageId: string): Promise<unknown> {
    const response = await apiClient.post<{ success: boolean; data: unknown }>(`/api/images/${imageId}/tag`)
    return response.data.data
  },

  async resetAutoTags(): Promise<{ changes: number; message: string }> {
    const response = await apiClient.post<{ success: boolean; data: { changes: number; message: string } }>('/api/images/reset-auto-tags')
    return response.data.data
  },
}
