/**
 * Upload API
 *
 * Image upload functionality:
 * - Single image upload
 * - Multiple image upload
 * - Upload with progress (SSE streaming)
 * - Error handling for file size and count limits
 */

import apiClient, { API_BASE_URL } from './apiClient';
import type { UploadResponse, UploadProgressEvent } from '../../types/image';

export const uploadApi = {
  /**
   * Upload single image
   */
  uploadImage: async (file: File): Promise<UploadResponse> => {
    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await apiClient.post('/api/images/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 413) {
        return {
          success: false,
          error: '파일 크기가 너무 큽니다. 최대 50MB까지 업로드할 수 있습니다.',
        };
      }

      return {
        success: false,
        error:
          error.response?.data?.error || error.message || '업로드 중 오류가 발생했습니다.',
      };
    }
  },

  /**
   * Upload multiple images
   */
  uploadImages: async (files: File[]): Promise<UploadResponse[]> => {
    try {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append('images', file);
      });

      const response = await apiClient.post('/api/images/upload-multiple', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      // Backend response structure handling
      if (response.data.success && response.data.data) {
        const { uploaded, failed } = response.data.data;
        const results: UploadResponse[] = [];

        // Convert successful uploads to UploadResponse format
        uploaded.forEach((item: any) => {
          results.push({
            success: true,
            data: item,
          });
        });

        // Convert failed uploads to UploadResponse format
        failed.forEach((item: any) => {
          results.push({
            success: false,
            error: item.error,
          });
        });

        return results;
      }

      // Failure case
      return [
        {
          success: false,
          error: response.data.error || '업로드에 실패했습니다.',
        },
      ];
    } catch (error: any) {
      // Specific error handling
      if (
        error.response?.status === 400 &&
        error.response?.data?.error?.includes('LIMIT_FILE_COUNT')
      ) {
        return [
          {
            success: false,
            error: '업로드 파일 개수가 제한을 초과했습니다.',
          },
        ];
      }

      if (error.response?.status === 413) {
        return [
          {
            success: false,
            error: '파일 크기가 너무 큽니다. 파일당 최대 50MB까지 업로드할 수 있습니다.',
          },
        ];
      }

      return [
        {
          success: false,
          error:
            error.response?.data?.error || error.message || '업로드 중 오류가 발생했습니다.',
        },
      ];
    }
  },

  /**
   * Upload multiple images with SSE streaming progress
   */
  uploadImagesWithProgress: async (
    files: File[],
    onProgress: (event: UploadProgressEvent) => void
  ): Promise<void> => {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('images', file);
    });

    const response = await fetch(`${API_BASE_URL}/api/images/upload-multiple-stream`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Decode chunk to string and add to buffer
        buffer += decoder.decode(value, { stream: true });

        // Split by lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep last incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as UploadProgressEvent;
              onProgress(event);
            } catch (parseError) {
              console.warn('Failed to parse SSE event:', line, parseError);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
};
