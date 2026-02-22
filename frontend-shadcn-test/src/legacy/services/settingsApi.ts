import apiClient, { API_BASE_URL } from './api/apiClient';

export type SupportedLanguage = 'ko' | 'en' | 'ja' | 'zh-CN' | 'zh-TW';

export interface DeleteProtectionSettings {
  enabled: boolean;
  recycleBinPath: string;
}

export interface GeneralSettings {
  language: SupportedLanguage;
  deleteProtection: DeleteProtectionSettings;
  enableGallery?: boolean;
  autoCleanupCanvasOnShutdown?: boolean;
  showRatingBadges?: boolean;
}

export interface TaggerModel {
  name: 'vit' | 'swinv2' | 'convnext';
  label: string;
  description: string;
  downloaded: boolean;
}

export type TaggerDevice = 'auto' | 'cpu' | 'cuda';

export interface TaggerSettings {
  enabled: boolean;                // Tagger 활성화 (활성화 시 자동으로 미처리 이미지 태깅)
  autoTagOnUpload: boolean;        // 업로드 시 자동 태깅 여부
  model: 'vit' | 'swinv2' | 'convnext';
  device: TaggerDevice;            // 디바이스 선택 (auto/cpu/cuda)
  generalThreshold: number;
  characterThreshold: number;
  pythonPath: string;
  keepModelLoaded: boolean;        // 메모리 유지 여부
  autoUnloadMinutes: number;       // 자동 언로드 시간 (분)
}

export interface TaggerServerStatus {
  isRunning: boolean;              // Daemon 실행 상태
  modelLoaded: boolean;            // 모델 로드 상태
  currentModel: 'vit' | 'swinv2' | 'convnext' | null; // 현재 로드된 모델
  currentDevice: string | null;    // 현재 사용 중인 디바이스 (예: "cuda:0", "cpu")
  lastUsedAt: string | null;       // 마지막 사용 시간 (ISO string)
}

export interface SimilaritySettings {
  autoGenerateHashOnUpload: boolean;  // 업로드 시 자동 해시 생성 여부
}

export type StealthScanMode = 'fast' | 'full' | 'skip';

export interface MetadataExtractionSettings {
  enableSecondaryExtraction: boolean;
  stealthScanMode: StealthScanMode;
  stealthMaxFileSizeMB: number;
  stealthMaxResolutionMP: number;
  skipStealthForComfyUI: boolean;
  skipStealthForWebUI: boolean;
}

export type ThumbnailSize = 'original' | '2048' | '1080' | '720' | '512';

export interface ThumbnailSettings {
  size: ThumbnailSize;   // 썸네일 크기 (original = 원본 크기 유지)
  quality: number;       // 썸네일 품질 (60-100)
}

export interface AppSettings {
  general: GeneralSettings;
  tagger: TaggerSettings;
  similarity: SimilaritySettings;
  metadataExtraction: MetadataExtractionSettings;
  thumbnail: ThumbnailSettings;
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

// Using centralized apiClient - all settings API calls will use /api/settings prefix

export const settingsApi = {
  /**
   * Get current application settings
   */
  getSettings: async (): Promise<AppSettings> => {
    const response = await apiClient.get<{ success: boolean; data: AppSettings }>('/api/settings/');
    return response.data.data;
  },

  /**
   * Update general settings
   */
  updateGeneralSettings: async (settings: Partial<GeneralSettings>): Promise<AppSettings> => {
    const response = await apiClient.put<{ success: boolean; data: AppSettings; message: string }>(
      '/api/settings/general',
      settings
    );
    return response.data.data;
  },

  /**
   * Update tagger settings
   */
  updateTaggerSettings: async (settings: Partial<TaggerSettings>): Promise<AppSettings> => {
    const response = await apiClient.put<{ success: boolean; data: AppSettings; message: string }>(
      '/api/settings/tagger',
      settings
    );
    return response.data.data;
  },

  /**
   * Get list of available tagger models with download status
   */
  getModelsList: async (): Promise<TaggerModel[]> => {
    const response = await apiClient.get<{ success: boolean; data: TaggerModel[] }>('/api/settings/tagger/models');
    return response.data.data;
  },

  /**
   * Check Python dependencies
   */
  checkDependencies: async (): Promise<DependencyCheckResult> => {
    const response = await apiClient.post<{ success: boolean; data: DependencyCheckResult }>(
      '/api/settings/tagger/check-dependencies'
    );
    return response.data.data;
  },

  /**
   * Download a tagger model
   */
  downloadModel: async (model: 'vit' | 'swinv2' | 'convnext'): Promise<{ downloaded: boolean; message: string }> => {
    const response = await apiClient.post<{ success: boolean; data: any; message: string }>(
      '/api/settings/tagger/download',
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
    const response = await apiClient.get<{ success: boolean; data: TaggerServerStatus }>('/api/settings/tagger/status');
    return response.data.data;
  },

  /**
   * Load model into memory
   */
  loadModel: async (model?: 'vit' | 'swinv2' | 'convnext'): Promise<void> => {
    await apiClient.post('/api/settings/tagger/load-model', { model });
  },

  /**
   * Unload model from memory
   */
  unloadModel: async (): Promise<void> => {
    await apiClient.post('/api/settings/tagger/unload-model');
  },

  /**
   * Update similarity settings
   */
  updateSimilaritySettings: async (settings: Partial<SimilaritySettings>): Promise<AppSettings> => {
    const response = await apiClient.put<{ success: boolean; data: AppSettings; message: string }>(
      '/api/settings/similarity',
      settings
    );
    return response.data.data;
  },

  /**
   * Update metadata extraction settings
   */
  updateMetadataSettings: async (settings: Partial<MetadataExtractionSettings>): Promise<AppSettings> => {
    const response = await apiClient.put<{ success: boolean; data: AppSettings; message: string }>(
      '/api/settings/metadata',
      settings
    );
    return response.data.data;
  },

  /**
   * Update thumbnail settings
   */
  updateThumbnailSettings: async (settings: Partial<ThumbnailSettings>): Promise<AppSettings> => {
    const response = await apiClient.put<{ success: boolean; data: AppSettings; message: string }>(
      '/api/settings/thumbnail',
      settings
    );
    return response.data.data;
  },
};

// Using centralized apiClient for images API

export interface BatchTagResult {
  total: number;
  success_count: number;
  fail_count: number;
  results: Array<{
    composite_hash: string;  // ✅ Changed from image_id: number to match backend response
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
    const response = await apiClient.post<{ success: boolean; data: BatchTagResult }>(
      '/api/images/batch-tag-unprocessed',
      { limit }
    );
    return response.data.data;
  },

  /**
   * Tag all images (force retag)
   */
  tagAll: async (limit?: number, force?: boolean): Promise<BatchTagResult> => {
    const response = await apiClient.post<{ success: boolean; data: BatchTagResult }>(
      '/api/images/batch-tag-all',
      { limit, force }
    );
    return response.data.data;
  },

  /**
   * Test tagging on a single image
   */
  testImage: async (imageId: string): Promise<any> => {
    const response = await apiClient.post<{ success: boolean; data: any }>(
      `/api/images/${imageId}/tag`
    );
    return response.data.data;
  },

  /**
   * Get untagged images count
   */
  getUntaggedCount: async (): Promise<number> => {
    const response = await apiClient.get<{ success: boolean; data: { count: number } }>(
      '/api/images/untagged-count'
    );
    return response.data.data.count;
  },

  /**
   * Reset all auto tags (set to NULL)
   */
  resetAutoTags: async (): Promise<{ changes: number; message: string }> => {
    const response = await apiClient.post<{ success: boolean; data: { changes: number; message: string } }>(
      '/api/images/reset-auto-tags'
    );
    return response.data.data;
  },
};

// Using centralized apiClient for thumbnails API

export interface ThumbnailRegenerationProgress {
  totalFiles: number;
  processedFiles: number;
  deletedThumbnails: number;
  generatedThumbnails: number;
  currentPhase: 'verification' | 'deletion' | 'generation' | 'completed' | 'idle';
  startTime: number;
  isRunning: boolean;
}

export interface ThumbnailStats {
  totalFiles: number;
  withThumbnails: number;
  withoutThumbnails: number;
}

export const thumbnailApi = {
  /**
   * Start thumbnail regeneration
   */
  regenerate: async (): Promise<void> => {
    await apiClient.post('/api/thumbnails/regenerate');
  },

  /**
   * Get regeneration progress
   */
  getProgress: async (): Promise<ThumbnailRegenerationProgress> => {
    const response = await apiClient.get<{ success: boolean; data: ThumbnailRegenerationProgress }>('/api/thumbnails/progress');
    return response.data.data;
  },

  /**
   * Get thumbnail statistics
   */
  getStats: async (): Promise<ThumbnailStats> => {
    const response = await apiClient.get<{ success: boolean; data: ThumbnailStats }>('/api/thumbnails/stats');
    return response.data.data;
  },
};
