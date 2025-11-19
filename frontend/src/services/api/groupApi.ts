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
  GroupWithHierarchy,
  GroupCreateData,
  GroupUpdateData,
  AutoCollectResult,
  BreadcrumbItem,
  HierarchyValidation,
  GroupMoveRequest,
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
   * @param id Group ID to delete
   * @param cascade If true, recursively delete all child groups. If false, only delete this group (children become root-level)
   */
  deleteGroup: async (id: number, cascade: boolean = false): Promise<GroupResponse> => {
    const response = await apiClient.delete(`/api/groups/${id}?cascade=${cascade}`);
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
   * Get preview images for group (for rotation display)
   * @param id Group ID
   * @param count Number of images to fetch (1-20, default 8)
   * @param includeChildren Search child groups if parent has no images (default true)
   */
  getPreviewImages: async (
    id: number,
    count: number = 8,
    includeChildren: boolean = true
  ): Promise<{
    success: boolean;
    data?: ImageRecord[];
    error?: string;
  }> => {
    const response = await apiClient.get(
      `/api/groups/${id}/preview-images?count=${count}&includeChildren=${includeChildren}`
    );
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

  /**
   * Download group images as ZIP (Blob-based)
   * @param id Group ID
   * @param type Download type: 'thumbnail' | 'original' | 'video'
   * @param compositeHashes Optional array of composite hashes for selected images
   */
  downloadGroupBlob: async (
    id: number,
    type: 'thumbnail' | 'original' | 'video',
    compositeHashes?: string[]
  ): Promise<void> => {
    let url = `/api/groups/${id}/download?type=${type}`;
    if (compositeHashes && compositeHashes.length > 0) {
      url += `&hashes=${encodeURIComponent(JSON.stringify(compositeHashes))}`;
    }

    const response = await apiClient.get(url, {
      responseType: 'blob',
    });

    // Create download link
    const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = blobUrl;

    // Extract filename from Content-Disposition header
    const contentDisposition = response.headers['content-disposition'];
    let filename = `group-${id}-${type}.zip`;
    if (contentDisposition) {
      // Handle both formats: filename="xxx" and filename*=UTF-8''xxx
      const filenameMatch = contentDisposition.match(/filename\*=UTF-8''(.+)|filename="?(.+?)"?(?:;|$)/);
      if (filenameMatch) {
        filename = decodeURIComponent(filenameMatch[1] || filenameMatch[2]);
      }
    }

    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(blobUrl);
  },

  // ===== Hierarchy-related methods =====

  /**
   * Get root groups (groups with no parent)
   */
  getRootGroups: async (): Promise<{
    success: boolean;
    data?: GroupWithHierarchy[];
    error?: string;
  }> => {
    const response = await apiClient.get('/api/groups/hierarchy/roots');
    return response.data;
  },

  /**
   * Get child groups of a specific parent
   */
  getChildGroups: async (parentId: number): Promise<{
    success: boolean;
    data?: GroupWithHierarchy[];
    error?: string;
  }> => {
    const response = await apiClient.get(`/api/groups/${parentId}/children`);
    return response.data;
  },

  /**
   * Get breadcrumb path for a group (from root to current)
   */
  getBreadcrumbPath: async (groupId: number): Promise<{
    success: boolean;
    data?: BreadcrumbItem[];
    error?: string;
  }> => {
    const response = await apiClient.get(`/api/groups/${groupId}/breadcrumb`);
    return response.data;
  },

  /**
   * Move group to a new parent
   */
  moveGroup: async (groupId: number, newParentId: number | null): Promise<GroupResponse> => {
    const requestData: GroupMoveRequest = { parent_id: newParentId };
    const response = await apiClient.post(`/api/groups/${groupId}/move`, requestData);
    return response.data;
  },

  /**
   * Validate hierarchy before moving/updating
   */
  validateHierarchy: async (groupId: number, newParentId: number | null): Promise<{
    success: boolean;
    data?: HierarchyValidation;
    error?: string;
  }> => {
    const response = await apiClient.post(`/api/groups/${groupId}/validate-hierarchy`, {
      parent_id: newParentId,
    });
    return response.data;
  },

  /**
   * Get all groups with hierarchy information
   */
  getAllGroupsWithHierarchy: async (): Promise<{
    success: boolean;
    data?: GroupWithHierarchy[];
    error?: string;
  }> => {
    const response = await apiClient.get('/api/groups/hierarchy/all');
    return response.data;
  },
};
