/**
 * Generation History API
 *
 * Image generation history management (used in Image Generation page):
 * - CRUD operations for generation history
 * - Filtering and statistics
 * - ComfyUI and NovelAI history creation
 * - Image upload for generated images
 * - Workflow-specific queries
 */

import apiClient from './apiClient';
import type {
  GenerationHistoryRecord,
  GenerationHistoryFilters,
  GenerationHistoryResponse,
  GenerationHistoryStatistics,
  CreateComfyUIHistoryRequest,
  CreateNAIHistoryRequest,
} from '@comfyui-image-manager/shared';

export const generationHistoryApi = {
  /**
   * Get all generation history with filters
   */
  getAll: async (filters?: GenerationHistoryFilters & { bustCache?: boolean }): Promise<GenerationHistoryResponse> => {
    const params = new URLSearchParams();
    if (filters?.service_type) params.append('service_type', filters.service_type);
    if (filters?.generation_status) params.append('generation_status', filters.generation_status);
    if (filters?.limit) params.append('limit', filters.limit.toString());
    if (filters?.offset) params.append('offset', filters.offset.toString());
    if (filters?.bustCache) params.append('_t', Date.now().toString());

    const response = await apiClient.get(`/api/generation-history?${params.toString()}`, {
      headers: filters?.bustCache ? { 'Cache-Control': 'no-cache, no-store, must-revalidate' } : {}
    });
    return response.data;
  },

  /**
   * Get recent generation history
   */
  getRecent: async (
    limit: number = 50
  ): Promise<{ success: boolean; records: GenerationHistoryRecord[] }> => {
    const response = await apiClient.get(`/api/generation-history/recent?limit=${limit}`);
    return response.data;
  },

  /**
   * Get generation statistics
   */
  getStatistics: async (): Promise<{
    success: boolean;
    statistics: GenerationHistoryStatistics;
  }> => {
    const response = await apiClient.get('/api/generation-history/statistics');
    return response.data;
  },

  /**
   * Get specific history by ID
   */
  getById: async (
    id: number,
    bustCache: boolean = false
  ): Promise<{ success: boolean; record: GenerationHistoryRecord }> => {
    const url = bustCache
      ? `/api/generation-history/${id}?_t=${Date.now()}`
      : `/api/generation-history/${id}`;

    const response = await apiClient.get(url, {
      headers: bustCache ? { 'Cache-Control': 'no-cache, no-store, must-revalidate' } : {}
    });
    return response.data;
  },

  /**
   * Create ComfyUI generation history
   */
  createComfyUI: async (
    data: CreateComfyUIHistoryRequest
  ): Promise<{ success: boolean; historyId: number; message: string }> => {
    const response = await apiClient.post('/api/generation-history/comfyui', data);
    return response.data;
  },

  /**
   * Create NovelAI generation history
   */
  createNovelAI: async (
    data: CreateNAIHistoryRequest
  ): Promise<{ success: boolean; historyId: number; message: string }> => {
    const response = await apiClient.post('/api/generation-history/novelai', data);
    return response.data;
  },

  /**
   * Upload image for generation history
   */
  uploadImage: async (
    historyId: number,
    imageBlob: Blob
  ): Promise<{ success: boolean; message: string }> => {
    const formData = new FormData();
    formData.append('image', imageBlob, 'generated.png');

    const response = await apiClient.post(
      `/api/generation-history/${historyId}/upload-image`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
    return response.data;
  },

  /**
   * Delete generation history
   */
  delete: async (id: number): Promise<{ success: boolean; message: string }> => {
    const response = await apiClient.delete(`/api/generation-history/${id}`);
    return response.data;
  },

  /**
   * Get generation history by workflow ID (ComfyUI only)
   */
  getByWorkflow: async (
    workflowId: number,
    filters?: Omit<GenerationHistoryFilters, 'workflow_id'> & { bustCache?: boolean }
  ): Promise<GenerationHistoryResponse> => {
    const params = new URLSearchParams();
    if (filters?.generation_status) params.append('generation_status', filters.generation_status);
    if (filters?.limit) params.append('limit', filters.limit.toString());
    if (filters?.offset) params.append('offset', filters.offset.toString());
    if (filters?.bustCache) params.append('_t', Date.now().toString());

    const response = await apiClient.get(
      `/api/generation-history/workflow/${workflowId}?${params.toString()}`,
      {
        headers: filters?.bustCache ? { 'Cache-Control': 'no-cache, no-store, must-revalidate' } : {}
      }
    );
    return response.data;
  },

  /**
   * Get workflow statistics (ComfyUI only)
   */
  getWorkflowStatistics: async (workflowId: number): Promise<{
    success: boolean;
    statistics: {
      total: number;
      completed: number;
      failed: number;
      pending: number;
      processing: number;
    };
    workflowId: number;
  }> => {
    const response = await apiClient.get(
      `/api/generation-history/workflow/${workflowId}/statistics`
    );
    return response.data;
  },

  /**
   * Cleanup only failed generation records
   */
  cleanupFailed: async (dryRun: boolean = false): Promise<{
    success: boolean;
    message: string;
    dry_run: boolean;
    deleted: number;
    summary: {
      failed_deleted: number;
      orphaned_deleted: number;
      no_hash_deleted: number;
      stale_updated: number;
    };
  }> => {
    const params = new URLSearchParams();
    if (dryRun) params.append('dry_run', 'true');

    const response = await apiClient.post(`/api/generation-history/cleanup-failed?${params.toString()}`);
    return response.data;
  },
};
