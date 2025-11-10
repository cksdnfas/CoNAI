/**
 * Image API
 *
 * All image-related API operations:
 * - CRUD operations (composite_hash based)
 * - Search and filtering
 * - Random image selection
 * - Metadata management
 * - URL generation for downloads and thumbnails
 */

import apiClient, { API_BASE_URL } from './apiClient';
import type {
  ImageRecord,
  ImageListResponse,
  ImageSearchParams,
  AutoTagSearchParams,
} from '../../types/image';
import type { ComplexSearchRequest, ComplexSearchResponse } from '@comfyui-image-manager/shared';

export const imageApi = {
  /**
   * Get paginated list of images
   */
  getImages: async (
    page: number = 1,
    limit: number = 25,
    sortBy: 'first_seen_date' | 'width' | 'height' | 'file_size' = 'first_seen_date',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
  ): Promise<ImageListResponse> => {
    const response = await apiClient.get(
      `/api/images?page=${page}&limit=${limit}&sortBy=${sortBy}&sortOrder=${sortOrder}`
    );
    return response.data;
  },

  /**
   * Search images with filters
   */
  searchImages: async (params: ImageSearchParams): Promise<ImageListResponse> => {
    const response = await apiClient.post('/api/images/search', params);
    return response.data;
  },

  /**
   * Search images by auto tags
   */
  searchByAutoTags: async (params: AutoTagSearchParams): Promise<ImageListResponse> => {
    const response = await apiClient.post('/api/images/search-by-autotags', params);
    return response.data;
  },

  /**
   * Complex filter search
   */
  searchComplex: async (request: ComplexSearchRequest): Promise<ComplexSearchResponse> => {
    const response = await apiClient.post('/api/images/search/complex', request);
    return response.data;
  },

  /**
   * Get composite_hash list for complex search (for random selection)
   */
  searchComplexIds: async (
    request: ComplexSearchRequest
  ): Promise<{ success: boolean; data?: { composite_hashes: string[]; total: number }; error?: string }> => {
    const response = await apiClient.post('/api/images/search/complex/ids', request);
    return response.data;
  },

  /**
   * Get image details by composite_hash
   */
  getImage: async (
    compositeHash: string
  ): Promise<{ success: boolean; data?: ImageRecord; error?: string }> => {
    const response = await apiClient.get(`/api/images/${compositeHash}`);
    return response.data;
  },

  /**
   * Delete image by composite_hash
   */
  deleteImage: async (
    compositeHash: string
  ): Promise<{ success: boolean; error?: string }> => {
    const response = await apiClient.delete(`/api/images/${compositeHash}`);
    return response.data;
  },

  /**
   * Delete multiple images by composite_hash
   */
  deleteImages: async (
    compositeHashes: string[]
  ): Promise<{ success: boolean; error?: string; details?: any }> => {
    try {
      const results = await Promise.all(
        compositeHashes.map((hash) => imageApi.deleteImage(hash))
      );

      const failed = results.filter(r => !r.success);

      if (failed.length > 0) {
        return {
          success: false,
          error: `${failed.length}/${compositeHashes.length} 이미지 삭제 실패`,
          details: { failed, total: compositeHashes.length }
        };
      }

      return {
        success: true,
        details: { deleted: compositeHashes.length }
      };
    } catch (error) {
      return {
        success: false,
        error: '이미지 삭제 중 오류가 발생했습니다.'
      };
    }
  },

  /**
   * Delete specific image files by file_id (for individual file deletion in duplicate groups)
   */
  deleteImageFiles: async (
    fileIds: number[]
  ): Promise<{ success: boolean; error?: string; details?: any }> => {
    try {
      const response = await apiClient.delete('/api/images/files/bulk', {
        data: { fileIds }
      });
      return response.data;
    } catch (error) {
      return {
        success: false,
        error: '파일 삭제 중 오류가 발생했습니다.'
      };
    }
  },

  /**
   * Get random image
   */
  getRandomImage: async (): Promise<{
    success: boolean;
    data?: ImageRecord;
    error?: string;
  }> => {
    const response = await apiClient.get('/api/images/random');
    return response.data;
  },

  /**
   * Get random image from search results
   */
  getRandomFromSearch: async (params: ImageSearchParams): Promise<{
    success: boolean;
    data?: ImageRecord;
    error?: string;
  }> => {
    const response = await apiClient.post('/api/images/random-from-search', params);
    return response.data;
  },

  /**
   * Get composite_hash list for search (for random selection)
   */
  searchImageIds: async (params: ImageSearchParams): Promise<{
    success: boolean;
    data?: { ids: number[]; total: number };  // ✅ Changed to ids: number[]
    error?: string;
  }> => {
    const response = await apiClient.post('/api/images/search/ids', params);
    return response.data;
  },

  /**
   * Get image metadata by composite_hash
   */
  getMetadata: async (compositeHash: string): Promise<ImageRecord> => {
    const response = await apiClient.get(`/api/images/metadata/${compositeHash}`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error || 'Failed to fetch metadata');
  },

  /**
   * Generate composite hash for image file
   */
  generateHash: async (params: {
    file_path?: string;
    file_id?: number;
  }): Promise<{
    success: boolean;
    data?: {
      composite_hash: string;
      perceptual_hash: string;
      dhash: string;
      ahash: string;
      file_path: string;
      saved_to_db: boolean;
    };
    error?: string;
  }> => {
    const response = await apiClient.post('/api/images/generate-hash', params);
    return response.data;
  },

  /**
   * Get download URL for original image
   */
  getDownloadUrl: (compositeHash: string): string => {
    return `${API_BASE_URL}/api/images/${compositeHash}/download/original`;
  },

  /**
   * Get thumbnail URL
   */
  getThumbnailUrl: (compositeHash: string): string => {
    return `${API_BASE_URL}/api/images/${compositeHash}/thumbnail`;
  },
};
