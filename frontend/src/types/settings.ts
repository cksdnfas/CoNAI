export type SimilaritySortBy = 'similarity' | 'upload_date' | 'file_size'
export type SimilaritySortOrder = 'ASC' | 'DESC'
export type TaggerModel = 'vit' | 'swinv2' | 'convnext'
export type TaggerDevice = 'auto' | 'cpu' | 'cuda'
export type KaloscopeDevice = 'auto' | 'cpu' | 'cuda'
export type StealthScanMode = 'full' | 'fast' | 'skip'

export interface DeleteProtectionSettings {
  enabled: boolean
  recycleBinPath: string
}

export interface GeneralSettings {
  language: 'ko' | 'en' | 'ja' | 'zh-CN' | 'zh-TW'
  deleteProtection: DeleteProtectionSettings
  enableGallery?: boolean
  autoCleanupCanvasOnShutdown?: boolean
  showRatingBadges?: boolean
}

export interface TaggerSettings {
  enabled: boolean
  autoTagOnUpload: boolean
  model: TaggerModel
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
  device: KaloscopeDevice
  topK: number
}

export interface SimilaritySettings {
  autoGenerateHashOnUpload: boolean
  detailSimilarThreshold: number
  detailSimilarLimit: number
  detailSimilarIncludeColorSimilarity: boolean
  detailSimilarSortBy: SimilaritySortBy
  detailSimilarSortOrder: SimilaritySortOrder
}

export type ThemeMode = 'dark' | 'light'
export type AppearancePreset = 'conai' | 'ocean' | 'forest' | 'custom'
export type SurfacePreset = 'studio' | 'midnight' | 'paper'
export type RadiusPreset = 'sharp' | 'balanced' | 'soft'
export type GlassPreset = 'subtle' | 'balanced' | 'immersive'
export type ShadowPreset = 'soft' | 'balanced' | 'dramatic'

export interface AppearanceSettings {
  themeMode: ThemeMode
  accentPreset: AppearancePreset
  customPrimaryColor: string
  customSecondaryColor: string
  surfacePreset: SurfacePreset
  radiusPreset: RadiusPreset
  glassPreset: GlassPreset
  shadowPreset: ShadowPreset
}

export interface MetadataExtractionSettings {
  enableSecondaryExtraction: boolean
  stealthScanMode: StealthScanMode
  stealthMaxFileSizeMB: number
  stealthMaxResolutionMP: number
  skipStealthForComfyUI: boolean
  skipStealthForWebUI: boolean
}

export interface ThumbnailSettings {
  size: 'original' | '2048' | '1080' | '720' | '512'
  quality: number
}

export interface AppSettings {
  general: GeneralSettings
  tagger: TaggerSettings
  kaloscope: KaloscopeSettings
  similarity: SimilaritySettings
  appearance: AppearanceSettings
  metadataExtraction: MetadataExtractionSettings
  thumbnail: ThumbnailSettings
}

export interface TaggerModelInfo {
  name: TaggerModel
  label: string
  description: string
  downloaded: boolean
}

export interface TaggerDependencyCheckResult {
  available: boolean
  message: string
}

export interface TaggerServerStatus {
  isRunning: boolean
  modelLoaded: boolean
  currentModel: TaggerModel | null
  currentDevice: string | null
  lastUsedAt: string | null
}

export interface KaloscopeServerStatus {
  enabled: boolean
  autoTagOnUpload: boolean
  currentDevice: KaloscopeDevice
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
