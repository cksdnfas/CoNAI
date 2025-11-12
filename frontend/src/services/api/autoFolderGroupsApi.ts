/**
 * Auto Folder Groups API
 *
 * Read-only folder-based automatic group management:
 * - Get folder hierarchy (parent/child navigation)
 * - View images in folder groups
 * - Rebuild folder structure
 * - Download folder contents
 */

import apiClient, { API_BASE_URL } from './apiClient';
import type { ImageRecord } from '../../types/image';
import type {
  AutoFolderGroupWithStats,
  AutoFolderGroupRebuildResult,
} from '@comfyui-image-manager/shared';

interface AutoFolderGroupResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export const autoFolderGroupsApi = {
  /**
   * Get all auto folder groups with statistics
   */
  getAll: async (): Promise<{
    success: boolean;
    data?: AutoFolderGroupWithStats[];
    error?: string;
  }> => {
    const response = await apiClient.get('/api/auto-folder-groups');
    return response.data;
  },

  /**
   * Get root level groups (parent_id = null)
   */
  getRootGroups: async (): Promise<{
    success: boolean;
    data?: AutoFolderGroupWithStats[];
    error?: string;
  }> => {
    const response = await apiClient.get('/api/auto-folder-groups/children/root');
    return response.data;
  },

  /**
   * Get child groups of specific parent
   */
  getChildGroups: async (parentId: number): Promise<{
    success: boolean;
    data?: AutoFolderGroupWithStats[];
    error?: string;
  }> => {
    const response = await apiClient.get(`/api/auto-folder-groups/children/${parentId}`);
    return response.data;
  },

  /**
   * Get specific auto folder group by ID
   */
  getGroup: async (id: number): Promise<AutoFolderGroupResponse> => {
    const response = await apiClient.get(`/api/auto-folder-groups/${id}`);
    return response.data;
  },

  /**
   * Get images in folder group (paginated)
   */
  getGroupImages: async (
    id: number,
    page: number = 1,
    pageSize: number = 50
  ): Promise<{
    success: boolean;
    data?: {
      items: ImageRecord[];
      pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
      };
    };
    error?: string;
  }> => {
    const response = await apiClient.get(`/api/auto-folder-groups/${id}/images`, {
      params: { page, pageSize },
    });
    return response.data;
  },

  /**
   * Get breadcrumb path for folder group
   */
  getBreadcrumbPath: async (groupId: number): Promise<{
    success: boolean;
    data?: Array<{ id: number; name: string; folder_path: string }>;
    error?: string;
  }> => {
    const response = await apiClient.get(`/api/auto-folder-groups/${groupId}/breadcrumb`);
    return response.data;
  },

  /**
   * Get thumbnail URL for folder group
   */
  getThumbnailUrl: (groupId: number): string => {
    return `${API_BASE_URL}/api/auto-folder-groups/${groupId}/thumbnail?t=${Date.now()}`;
  },

  /**
   * Rebuild all folder groups
   */
  rebuild: async (): Promise<{
    success: boolean;
    data?: AutoFolderGroupRebuildResult;
    error?: string;
  }> => {
    const response = await apiClient.post('/api/auto-folder-groups/rebuild');
    return response.data;
  },

  /**
   * Get file type counts for download preview
   */
  getFileCounts: async (
    groupId: number,
    selectedHashes?: string[]
  ): Promise<{
    success: boolean;
    data?: {
      thumbnailCount: number;
      originalCount: number;
      videoCount: number;
    };
    error?: string;
  }> => {
    const params: any = {};
    if (selectedHashes && selectedHashes.length > 0) {
      params.hashes = selectedHashes.join(',');
    }

    const response = await apiClient.get(`/api/auto-folder-groups/${groupId}/file-counts`, {
      params,
    });
    return response.data;
  },

  /**
   * Download folder group as ZIP
   */
  downloadGroup: async (
    groupId: number,
    type: 'thumbnail' | 'original' | 'video' = 'original',
    selectedHashes?: string[]
  ): Promise<void> => {
    const params: any = { type };
    if (selectedHashes && selectedHashes.length > 0) {
      params.hashes = selectedHashes.join(',');
    }

    const response = await apiClient.get(`/api/auto-folder-groups/${groupId}/download`, {
      params,
      responseType: 'blob',
    });

    // Create download link
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;

    // Extract filename from Content-Disposition header or use default
    const contentDisposition = response.headers['content-disposition'];
    let filename = `folder-group-${groupId}.zip`;
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (filenameMatch && filenameMatch[1]) {
        filename = filenameMatch[1].replace(/['"]/g, '');
      }
    }

    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};
