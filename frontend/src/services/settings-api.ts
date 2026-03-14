import { apiClient } from '@/lib/api/client'

export type SupportedLanguage = 'ko' | 'en' | 'ja' | 'zh-CN' | 'zh-TW'

export interface DeleteProtectionSettings {
  enabled: boolean
  recycleBinPath: string
}

export interface GeneralSettings {
  language: SupportedLanguage
  deleteProtection: DeleteProtectionSettings
  enableGallery?: boolean
  autoCleanupCanvasOnShutdown?: boolean
  showRatingBadges?: boolean
}

export type TaggerDevice = 'auto' | 'cpu' | 'cuda'

export interface TaggerSettings {
  enabled: boolean
  autoTagOnUpload: boolean
  model: 'vit' | 'swinv2' | 'convnext'
  device: TaggerDevice
  generalThreshold: number
  characterThreshold: number
  pythonPath: string
  keepModelLoaded: boolean
  autoUnloadMinutes: number
}

export interface KaloscopeSettings {
  enabled: boolean
  autoTagOnUpload: boolean
  device: TaggerDevice
  topK: number
}

export interface TaggerModel {
  name: 'vit' | 'swinv2' | 'convnext'
  label: string
  description: string
  downloaded: boolean
}

export interface TaggerServerStatus {
  isRunning: boolean
  modelLoaded: boolean
  currentModel: 'vit' | 'swinv2' | 'convnext' | null
  currentDevice: string | null
  lastUsedAt: string | null
}

export interface KaloscopeServerStatus {
  enabled: boolean
  autoTagOnUpload: boolean
  currentDevice: TaggerDevice
  topK: number
  scriptExists: boolean
  modelCached: boolean
  modelRepo: string
  modelFile: string
  dependenciesAvailable: boolean
  missingPackages: string[]
  statusMessage: string
  installCommand?: string
}

export interface DependencyCheckResult {
  available: boolean
  message: string
  details?: {
    python: boolean
    torch: boolean
    timm: boolean
    huggingface_hub: boolean
    pillow: boolean
    pandas: boolean
    numpy: boolean
  }
}

export interface SimilaritySettings {
  autoGenerateHashOnUpload: boolean
}

export type StealthScanMode = 'fast' | 'full' | 'skip'

export interface MetadataExtractionSettings {
  enableSecondaryExtraction: boolean
  stealthScanMode: StealthScanMode
  stealthMaxFileSizeMB: number
  stealthMaxResolutionMP: number
  skipStealthForComfyUI: boolean
  skipStealthForWebUI: boolean
}

export type ThumbnailSize = 'original' | '2048' | '1080' | '720' | '512'

export interface ThumbnailSettings {
  size: ThumbnailSize
  quality: number
}

export interface AppSettings {
  general: GeneralSettings
  tagger: TaggerSettings
  kaloscope: KaloscopeSettings
  similarity: SimilaritySettings
  metadataExtraction: MetadataExtractionSettings
  thumbnail: ThumbnailSettings
}

export const settingsApi = {
  async getSettings(): Promise<AppSettings> {
    const response = await apiClient.get<{ success: boolean; data: AppSettings }>('/api/settings/')
    return response.data.data
  },

  async updateGeneralSettings(settings: Partial<GeneralSettings>): Promise<AppSettings> {
    const response = await apiClient.put<{ success: boolean; data: AppSettings; message: string }>('/api/settings/general', settings)
    return response.data.data
  },

  async updateTaggerSettings(settings: Partial<TaggerSettings>): Promise<AppSettings> {
    const response = await apiClient.put<{ success: boolean; data: AppSettings; message: string }>('/api/settings/tagger', settings)
    return response.data.data
  },

  async updateKaloscopeSettings(settings: Partial<KaloscopeSettings>): Promise<AppSettings> {
    const response = await apiClient.put<{ success: boolean; data: AppSettings; message: string }>('/api/settings/kaloscope', settings)
    return response.data.data
  },

  async testTagger(imageId: string): Promise<unknown> {
    const response = await apiClient.post<{ success: boolean; data: unknown }>('/api/settings/tagger/test', { imageId })
    return response.data.data
  },

  async testKaloscope(imageId: string): Promise<unknown> {
    const response = await apiClient.post<{ success: boolean; data: unknown }>('/api/settings/kaloscope/test', { imageId })
    return response.data.data
  },

  async getModelsList(): Promise<TaggerModel[]> {
    const response = await apiClient.get<{ success: boolean; data: TaggerModel[] }>('/api/settings/tagger/models')
    return response.data.data
  },

  async checkDependencies(): Promise<DependencyCheckResult> {
    const response = await apiClient.post<{ success: boolean; data: DependencyCheckResult }>('/api/settings/tagger/check-dependencies')
    return response.data.data
  },

  async downloadModel(model: 'vit' | 'swinv2' | 'convnext'): Promise<{ downloaded: boolean; message: string }> {
    const response = await apiClient.post<{ success: boolean; data: { downloaded: boolean }; message: string }>('/api/settings/tagger/download', { model })
    return {
      downloaded: response.data.data.downloaded,
      message: response.data.message,
    }
  },

  async getTaggerStatus(): Promise<TaggerServerStatus> {
    const response = await apiClient.get<{ success: boolean; data: TaggerServerStatus }>('/api/settings/tagger/status')
    return response.data.data
  },

  async getKaloscopeStatus(): Promise<KaloscopeServerStatus> {
    const response = await apiClient.get<{ success: boolean; data: KaloscopeServerStatus }>('/api/settings/kaloscope/status')
    return response.data.data
  },

  async loadModel(model?: 'vit' | 'swinv2' | 'convnext', device?: TaggerDevice): Promise<void> {
    await apiClient.post('/api/settings/tagger/load-model', { model, device })
  },

  async unloadModel(): Promise<void> {
    await apiClient.post('/api/settings/tagger/unload-model')
  },

  async updateMetadataSettings(settings: Partial<MetadataExtractionSettings>): Promise<AppSettings> {
    const response = await apiClient.put<{ success: boolean; data: AppSettings; message: string }>('/api/settings/metadata', settings)
    return response.data.data
  },

  async updateThumbnailSettings(settings: Partial<ThumbnailSettings>): Promise<AppSettings> {
    const response = await apiClient.put<{ success: boolean; data: AppSettings; message: string }>('/api/settings/thumbnail', settings)
    return response.data.data
  },

  thumbnailRegeneration: {
    async regenerate(): Promise<void> {
      await apiClient.post('/api/thumbnails/regenerate')
    },
  },
}
