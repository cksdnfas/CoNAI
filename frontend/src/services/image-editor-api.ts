import { apiClient } from '@/lib/api/client'

export const imageEditorApi = {
  async getEditableImageBlob(fileId: number): Promise<Blob> {
    const response = await apiClient.get(`/api/image-editor/${fileId}/webp`, {
      responseType: 'blob',
    })
    return response.data as Blob
  },

  async saveEditedImage(fileId: number, imageData: string, quality = 90): Promise<void> {
    await apiClient.post(`/api/image-editor/${fileId}/save-webp`, {
      imageData,
      quality,
    })
  },
}
