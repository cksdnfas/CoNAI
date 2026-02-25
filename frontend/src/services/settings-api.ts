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

  async updateMetadataSettings(settings: Partial<MetadataExtractionSettings>): Promise<AppSettings> {
    const response = await apiClient.put<{ success: boolean; data: AppSettings; message: string }>('/api/settings/metadata', settings)
    return response.data.data
  },

  async updateThumbnailSettings(settings: Partial<ThumbnailSettings>): Promise<AppSettings> {
    const response = await apiClient.put<{ success: boolean; data: AppSettings; message: string }>('/api/settings/thumbnail', settings)
    return response.data.data
  },
}
