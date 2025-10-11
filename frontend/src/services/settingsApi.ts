import axios from 'axios';
import { API_BASE_URL } from './api';

export interface TaggerModel {
  name: 'vit' | 'swinv2' | 'convnext';
  label: string;
  description: string;
  downloaded: boolean;
}

export interface TaggerSettings {
  enabled: boolean;
  model: 'vit' | 'swinv2' | 'convnext';
  generalThreshold: number;
  characterThreshold: number;
  pythonPath: string;
  autoTagOnUpload: boolean;
  keepModelLoaded: boolean;        // 메모리 유지 여부
  autoUnloadMinutes: number;       // 자동 언로드 시간 (분)
}

export interface TaggerServerStatus {
  isRunning: boolean;              // Daemon 실행 상태
  modelLoaded: boolean;            // 모델 로드 상태
  currentModel: 'vit' | 'swinv2' | 'convnext' | null; // 현재 로드된 모델
  lastUsedAt: string | null;       // 마지막 사용 시간 (ISO string)
}

export interface AppSettings {
  tagger: TaggerSettings;
}

export interface DependencyCheckResult {
  available: boolean;
  message: string;
  details?: {
    python: boolean;
    torch: boolean;
    timm: boolean;
    huggingface_hub: boolean;
    pillow: boolean;
    pandas: boolean;
    numpy: boolean;
  };
}

const api = axios.create({
  baseURL: `${API_BASE_URL}/api/settings`,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const settingsApi = {
  /**
   * Get current application settings
   */
  getSettings: async (): Promise<AppSettings> => {
    const response = await api.get<{ success: boolean; data: AppSettings }>('/');
    return response.data.data;
  },

  /**
   * Update tagger settings
   */
  updateTaggerSettings: async (settings: Partial<TaggerSettings>): Promise<AppSettings> => {
    const response = await api.put<{ success: boolean; data: AppSettings; message: string }>(
      '/tagger',
      settings
    );
    return response.data.data;
  },

  /**
   * Get list of available tagger models with download status
   */
  getModelsList: async (): Promise<TaggerModel[]> => {
    const response = await api.get<{ success: boolean; data: TaggerModel[] }>('/tagger/models');
    return response.data.data;
  },

  /**
   * Check Python dependencies
   */
  checkDependencies: async (): Promise<DependencyCheckResult> => {
    const response = await api.post<{ success: boolean; data: DependencyCheckResult }>(
      '/tagger/check-dependencies'
    );
    return response.data.data;
  },

  /**
   * Download a tagger model
   */
  downloadModel: async (model: 'vit' | 'swinv2' | 'convnext'): Promise<{ downloaded: boolean; message: string }> => {
    const response = await api.post<{ success: boolean; data: any; message: string }>(
      '/tagger/download',
      { model }
    );
    return {
      downloaded: response.data.data.downloaded,
      message: response.data.message,
    };
  },

  /**
   * Get tagger daemon status
   */
  getTaggerStatus: async (): Promise<TaggerServerStatus> => {
    const response = await api.get<{ success: boolean; data: TaggerServerStatus }>('/tagger/status');
    return response.data.data;
  },

  /**
   * Load model into memory
   */
  loadModel: async (model?: 'vit' | 'swinv2' | 'convnext'): Promise<void> => {
    await api.post('/tagger/load-model', { model });
  },

  /**
   * Unload model from memory
   */
  unloadModel: async (): Promise<void> => {
    await api.post('/tagger/unload-model');
  },
};

const imageApi = axios.create({
  baseURL: `${API_BASE_URL}/api/images`,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface BatchTagResult {
  total: number;
  success_count: number;
  fail_count: number;
  results: Array<{
    image_id: number;
    success: boolean;
    auto_tags?: any;
    error?: string;
  }>;
}

export const taggerBatchApi = {
  /**
   * Tag unprocessed images (auto_tags IS NULL)
   */
  tagUnprocessed: async (limit?: number): Promise<BatchTagResult> => {
    const response = await imageApi.post<{ success: boolean; data: BatchTagResult }>(
      '/batch-tag-unprocessed',
      { limit }
    );
    return response.data.data;
  },

  /**
   * Tag all images (force retag)
   */
  tagAll: async (limit?: number, force?: boolean): Promise<BatchTagResult> => {
    const response = await imageApi.post<{ success: boolean; data: BatchTagResult }>(
      '/batch-tag-all',
      { limit, force }
    );
    return response.data.data;
  },

  /**
   * Test tagging on a single image
   */
  testImage: async (imageId: number): Promise<any> => {
    const response = await imageApi.post<{ success: boolean; data: any }>(
      `/${imageId}/tag`
    );
    return response.data.data;
  },

  /**
   * Get untagged images count
   */
  getUntaggedCount: async (): Promise<number> => {
    const response = await imageApi.get<{ success: boolean; data: { count: number } }>(
      '/untagged-count'
    );
    return response.data.data.count;
  },
};
