/**
 * Group API
 *
 * Group management operations:
 * - CRUD operations for image groups
 * - Image-group relationships (composite_hash based)
 * - Auto-collection functionality
 * - Group thumbnails and random images
 */

import apiClient, { API_BASE_URL } from './apiClient';
import type { ImageRecord } from '../../types/image';
import type {
  GroupRecord,
  GroupResponse,
  GroupWithStats,
  GroupCreateData,
  GroupUpdateData,
  AutoCollectResult,
} from '@comfyui-image-manager/shared';

export const groupApi = {
  /**
   * Get all groups with statistics
   */
  getGroups: async (): Promise<{
    success: boolean;
    data?: GroupWithStats[];
    error?: string;
  }> => {
    const response = await apiClient.get('/api/groups');
    return response.data;
  },

  /**
   * Get specific group by ID
   */
  getGroup: async (id: number): Promise<{
    success: boolean;
    data?: GroupRecord;
    error?: string;
  }> => {
    const response = await apiClient.get(`/api/groups/${id}`);
    return response.data;
  },

  /**
   * Create new group
   */
  createGroup: async (groupData: GroupCreateData): Promise<GroupResponse> => {
    const response = await apiClient.post('/api/groups', groupData);
    return response.data;
  },

  /**
   * Update group
   */
  updateGroup: async (id: number, groupData: GroupUpdateData): Promise<GroupResponse> => {
    const response = await apiClient.put(`/api/groups/${id}`, groupData);
    return response.data;
  },

  /**
   * Delete group
   */
  deleteGroup: async (id: number): Promise<GroupResponse> => {
    const response = await apiClient.delete(`/api/groups/${id}`);
    return response.data;
  },

  /**
   * Get images in group
   */
  getGroupImages: async (
    id: number,
    page: number = 1,
    limit: number = 20,
    collectionType?: 'manual' | 'auto'
  ): Promise<GroupResponse> => {
    let url = `/api/groups/${id}/images?page=${page}&limit=${limit}`;
    if (collectionType) {
      url += `&collection_type=${collectionType}`;
    }
    const response = await apiClient.get(url);
    return response.data;
  },

  /**
   * Add single image to group (composite_hash based)
   */
  addImageToGroup: async (
    groupId: number,
    compositeHash: string,
    orderIndex: number = 0
  ): Promise<GroupResponse> => {
    const response = await apiClient.post(`/api/groups/${groupId}/images`, {
      composite_hash: compositeHash,
      order_index: orderIndex,
    });
    return response.data;
  },

  /**
   * Add multiple images to group (composite_hash based)
   */
  addImagesToGroup: async (
    groupId: number,
    compositeHashes: string[]
  ): Promise<GroupResponse> => {
    const response = await apiClient.post(`/api/groups/${groupId}/images/bulk`, {
      composite_hashes: compositeHashes,
    });
    return response.data;
  },

  /**
   * Remove image from group (composite_hash based)
   */
  removeImageFromGroup: async (
    groupId: number,
    compositeHash: string
  ): Promise<GroupResponse> => {
    const response = await apiClient.delete(`/api/groups/${groupId}/images/${compositeHash}`);
    return response.data;
  },

  /**
   * Remove multiple images from group (composite_hash based)
   */
  removeImagesFromGroup: async (
    groupId: number,
    compositeHashes: string[]
  ): Promise<{ success: boolean; removed: number; errors: string[] }> => {
    let removedCount = 0;
    const errors: string[] = [];

    for (const compositeHash of compositeHashes) {
      try {
        const response = await apiClient.delete(`/api/groups/${groupId}/images/${compositeHash}`);
        if (response.data.success) {
          removedCount++;
        } else {
          errors.push(`Image ${compositeHash}: ${response.data.error || 'Failed to remove'}`);
        }
      } catch (error: any) {
        errors.push(
          `Image ${compositeHash}: ${error.response?.data?.error || error.message || 'Failed to remove'}`
        );
      }
    }

    return {
      success: errors.length === 0,
      removed: removedCount,
      errors,
    };
  },

  /**
   * Run auto-collection for specific group
   */
  runAutoCollection: async (id: number): Promise<{
    success: boolean;
    data?: AutoCollectResult;
    error?: string;
  }> => {
    const response = await apiClient.post(`/api/groups/${id}/auto-collect`);
    return response.data;
  },

  /**
   * Run auto-collection for all groups
   */
  runAllAutoCollection: async (): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> => {
    const response = await apiClient.post('/api/groups/auto-collect-all');
    return response.data;
  },

  /**
   * Get thumbnail URL for group
   */
  getThumbnailUrl: (id: number): string => {
    return `${API_BASE_URL}/api/groups/${id}/thumbnail`;
  },

  /**
   * Get random image from group
   */
  getRandomImageFromGroup: async (id: number): Promise<{
    success: boolean;
    data?: ImageRecord;
    error?: string;
  }> => {
    const response = await apiClient.get(`/api/groups/${id}/random-image`);
    return response.data;
  },

  /**
   * Get composite_hash list for group (for random selection)
   */
  getImageIdsForGroup: async (id: number): Promise<{
    success: boolean;
    data?: { ids: number[]; total: number };  // ✅ Changed to ids: number[]
    error?: string;
  }> => {
    const response = await apiClient.get(`/api/groups/${id}/image-ids`);
    return response.data;
  },

  /**
   * Get download URL for group images (ZIP)
   * @param id Group ID
   * @param type Download type: 'thumbnail' | 'original' | 'video'
   * @param compositeHashes Optional array of composite hashes for selected images
   */
  getDownloadUrl: (id: number, type: 'thumbnail' | 'original' | 'video', compositeHashes?: string[]): string => {
    let url = `${API_BASE_URL}/api/groups/${id}/download?type=${type}`;
    if (compositeHashes && compositeHashes.length > 0) {
      url += `&hashes=${encodeURIComponent(JSON.stringify(compositeHashes))}`;
    }
    return url;
  },

  /**
   * Get file counts by type for group (for download preview)
   */
  getFileCountsByType: async (id: number): Promise<{
    success: boolean;
    data?: { thumbnail: number; original: number; video: number };
    error?: string;
  }> => {
    const response = await apiClient.get(`/api/groups/${id}/file-counts`);
    return response.data;
  },
};
