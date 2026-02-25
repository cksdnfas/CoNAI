import apiClient from './api/apiClient';

// Types
export interface CivitaiSettings {
  enabled: boolean;
  apiCallInterval: number;
  totalLookups: number;
  successfulLookups: number;
  failedLookups: number;
  lastApiCall: string | null;
}

export interface CivitaiStats {
  totalLookups: number;
  successfulLookups: number;
  failedLookups: number;
  lastApiCall: string | null;
  successRate: number;
}

export interface ModelInfo {
  id: number;
  model_hash: string;
  model_name: string | null;
  model_version_id: string | null;
  civitai_model_id: number | null;
  model_type: string | null;
  civitai_data: string | null;
  thumbnail_path: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImageModelInfo {
  id: number;
  composite_hash: string;
  model_hash: string;
  model_role: 'base_model' | 'lora' | 'vae' | 'embedding';
  weight: number | null;
  civitai_checked: number;
  civitai_failed: number;
  checked_at: string | null;
  created_at: string;
  modelInfo: ModelInfo | null;
}

export interface IntentUrlResult {
  intentUrl: string;
  tokens: string[];
  expiresAt: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// API functions
export const civitaiApi = {
  // Settings
  async getSettings(): Promise<CivitaiSettings> {
    const response = await apiClient.get<ApiResponse<CivitaiSettings>>(
      '/api/civitai/settings'
    );
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to get settings');
    }
    return response.data.data;
  },

  async updateSettings(settings: Partial<Pick<CivitaiSettings, 'enabled' | 'apiCallInterval'>>): Promise<CivitaiSettings> {
    const response = await apiClient.put<ApiResponse<CivitaiSettings>>(
      '/api/civitai/settings',
      settings
    );
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to update settings');
    }
    return response.data.data;
  },

  // Statistics
  async getStats(): Promise<CivitaiStats> {
    const response = await apiClient.get<ApiResponse<CivitaiStats>>(
      '/api/civitai/stats'
    );
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to get stats');
    }
    return response.data.data;
  },

  async resetStats(): Promise<void> {
    const response = await apiClient.post<ApiResponse<void>>(
      '/api/civitai/stats/reset'
    );
    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to reset stats');
    }
  },

  // Models
  async getModels(limit = 100, offset = 0): Promise<ModelInfo[]> {
    const response = await apiClient.get<ApiResponse<ModelInfo[]>>(
      '/api/civitai/models',
      { params: { limit, offset } }
    );
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to get models');
    }
    return response.data.data;
  },

  async getModelByHash(hash: string): Promise<ModelInfo> {
    const response = await apiClient.get<ApiResponse<ModelInfo>>(
      `/api/civitai/models/${hash}`
    );
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to get model');
    }
    return response.data.data;
  },

  async getImageModels(compositeHash: string): Promise<ImageModelInfo[]> {
    const response = await apiClient.get<ApiResponse<ImageModelInfo[]>>(
      `/api/civitai/images/${compositeHash}/models`
    );
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to get image models');
    }
    return response.data.data;
  },

  // Manual lookup
  async lookupModel(hash: string): Promise<ModelInfo> {
    const response = await apiClient.post<ApiResponse<ModelInfo>>(
      `/api/civitai/lookup/${hash}`
    );
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Model not found on Civitai');
    }
    return response.data.data;
  },

  // Reset failed
  async resetFailed(): Promise<string> {
    const response = await apiClient.post<ApiResponse<void>>(
      '/api/civitai/reset-failed'
    );
    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to reset');
    }
    return response.data.message || 'Success';
  },

  // Clear cache
  async clearModelCache(): Promise<string> {
    const response = await apiClient.delete<ApiResponse<void>>(
      '/api/civitai/models'
    );
    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to clear cache');
    }
    return response.data.message || 'Success';
  },

  // Post Intent
  async createIntent(params: {
    compositeHashes: string[];
    includeMetadata?: boolean;
    title?: string;
    description?: string;
    tags?: string[];
  }): Promise<IntentUrlResult> {
    const response = await apiClient.post<ApiResponse<IntentUrlResult>>(
      '/api/civitai/create-intent',
      params
    );
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to create intent URL');
    }
    return response.data.data;
  },

  // Cleanup
  async cleanupTempUrls(): Promise<string> {
    const response = await apiClient.post<ApiResponse<void>>(
      '/api/civitai/cleanup-temp-urls'
    );
    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to cleanup');
    }
    return response.data.message || 'Success';
  },

  // Rescan
  async startRescan(): Promise<{ message: string; total: number }> {
    const response = await apiClient.post<ApiResponse<void> & { total?: number }>(
      '/api/civitai/rescan-all'
    );
    if (!response.data.success) {
      const error = response.data as any;
      throw new Error(error.error || 'Failed to start rescan');
    }
    return {
      message: response.data.message || 'Rescan started',
      total: (response.data as any).total || 0
    };
  },

  async getRescanProgress(): Promise<{
    isRunning: boolean;
    total: number;
    processed: number;
    added: number;
    percentage: number;
    startedAt: string | null;
  }> {
    const response = await apiClient.get<ApiResponse<{
      isRunning: boolean;
      total: number;
      processed: number;
      added: number;
      percentage: number;
      startedAt: string | null;
    }>>('/api/civitai/rescan-progress');
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to get rescan progress');
    }
    return response.data.data;
  },

  async getUncheckedCount(): Promise<number> {
    const response = await apiClient.get<ApiResponse<{ uncheckedCount: number }>>(
      '/api/civitai/unchecked-count'
    );
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to get unchecked count');
    }
    return response.data.data.uncheckedCount;
  }
};
