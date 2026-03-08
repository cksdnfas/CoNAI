import { API_BASE_URL, apiClient } from '@/lib/api/client'
import type { ImageListResponse, ImageRecord } from '@/types/image'
import type { ComplexSearchRequest, ComplexSearchResponse } from '@conai/shared'

export const imageApi = {
  async getImages(
    page = 1,
    limit = 25,
    sortBy: 'first_seen_date' | 'width' | 'height' | 'file_size' = 'first_seen_date',
    sortOrder: 'ASC' | 'DESC' = 'DESC',
    cursor?: { cursorDate: string; cursorHash: string },
  ): Promise<ImageListResponse> {
    let url = `/api/images?page=${page}&limit=${limit}&sortBy=${sortBy}&sortOrder=${sortOrder}`;
    if (cursor) {
      url += `&cursor_date=${encodeURIComponent(cursor.cursorDate)}&cursor_hash=${encodeURIComponent(cursor.cursorHash)}`;
    }
    const response = await apiClient.get(url)
    return response.data
  },

  async getImage(compositeHash: string): Promise<{ success: boolean; data?: ImageRecord; error?: string }> {
    const response = await apiClient.get(`/api/images/${compositeHash}`)
    return response.data
  },

  async searchComplex(request: ComplexSearchRequest): Promise<ComplexSearchResponse> {
    const response = await apiClient.post('/api/images/search/complex', request)
    return response.data
  },

  async searchComplexIds(
    request: ComplexSearchRequest,
  ): Promise<{ success: boolean; data?: { ids: string[]; total: number }; error?: string }> {
    const response = await apiClient.post('/api/images/search/complex/ids', request)
    return response.data
  },

  async getImagesBulk(compositeHashes: string[]): Promise<ImageListResponse> {
    const response = await apiClient.post('/api/images/batch', { composite_hashes: compositeHashes })
    return response.data
  },

  async deleteImageFiles(fileIds: number[]): Promise<{ success: boolean; error?: string; details?: unknown }> {
    try {
      const response = await apiClient.delete('/api/images/files/bulk', {
        data: { fileIds },
      })
      return response.data
    } catch {
      return {
        success: false,
        error: '파일 삭제 중 오류가 발생했습니다.',
      }
    }
  },

  getDownloadUrl(compositeHash: string): string {
    return `${API_BASE_URL}/api/images/${compositeHash}/download/original`
  },
}
