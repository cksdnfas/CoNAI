import { API_BASE_URL, apiClient } from '@/lib/api/client'
import type { UploadProgressEvent, UploadResponse } from '@/types/image'

export const uploadApi = {
  uploadImage: async (file: File): Promise<UploadResponse> => {
    try {
      const formData = new FormData()
      formData.append('image', file)

      const response = await apiClient.post('/api/images/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })

      return response.data
    } catch (error: unknown) {
      if (typeof error === 'object' && error && 'response' in error) {
        const response = (error as { response?: { status?: number; data?: { error?: string } } }).response
        if (response?.status === 413) {
          return {
            success: false,
            error: '파일 크기가 너무 큽니다. 최대 50MB까지 업로드할 수 있습니다.',
          }
        }

        return {
          success: false,
          error: response?.data?.error || '업로드 중 오류가 발생했습니다.',
        }
      }

      const message = error instanceof Error ? error.message : '업로드 중 오류가 발생했습니다.'
      return {
        success: false,
        error: message,
      }
    }
  },

  uploadImagesWithProgress: async (files: File[], onProgress: (event: UploadProgressEvent) => void): Promise<void> => {
    const formData = new FormData()
    files.forEach((file) => {
      formData.append('images', file)
    })

    const response = await fetch(`${API_BASE_URL}/api/images/upload-multiple-stream`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Upload stream is not available')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as UploadProgressEvent
              onProgress(event)
            } catch (parseError) {
              console.warn('Failed to parse SSE event:', line, parseError)
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  },
}
