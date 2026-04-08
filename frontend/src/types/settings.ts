export type SimilaritySortBy = 'similarity' | 'upload_date' | 'file_size'
export type SimilaritySortOrder = 'ASC' | 'DESC'
export type TaggerModel = 'vit' | 'swinv2' | 'convnext'
export type TaggerDevice = 'auto' | 'cpu' | 'cuda'
export type KaloscopeDevice = 'auto' | 'cpu' | 'cuda'
export type PromptSimilarityAlgorithm = 'simhash' | 'minhash'
export type StealthScanMode = 'full' | 'fast' | 'skip'

export const DEFAULT_ARTIST_LINK_URL_TEMPLATE = 'danbooru.donmai.us/posts?tags={key}'

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
  artistLinkUrlTemplate: string
}

export interface PromptSimilarityWeights {
  positive: number
  negative: number
  auto: number
}

export interface PromptSimilarityFieldThresholds {
  positive: number
  negative: number
  auto: number
}

export interface PromptSimilaritySettings {
  enabled: boolean
  algorithm: PromptSimilarityAlgorithm
  autoBuildOnMetadataUpdate: boolean
  resultLimit: number
  combinedThreshold: number
  weights: PromptSimilarityWeights
  fieldThresholds: PromptSimilarityFieldThresholds
}

export interface SimilaritySettings {
  autoGenerateHashOnUpload: boolean
  detailSimilarThreshold: number
  detailSimilarLimit: number
  detailSimilarIncludeColorSimilarity: boolean
  detailSimilarSortBy: SimilaritySortBy
  detailSimilarSortOrder: SimilaritySortOrder
  promptSimilarity: PromptSimilaritySettings
}

export type ThemeMode = 'system' | 'dark' | 'light'
export type AppearancePreset = 'conai' | 'ocean' | 'forest' | 'custom'
export type SurfacePreset = 'studio' | 'midnight' | 'paper' | 'custom'
export type RadiusPreset = 'sharp' | 'balanced' | 'soft'
export type GlassPreset = 'subtle' | 'balanced' | 'immersive'
export type ShadowPreset = 'soft' | 'balanced' | 'dramatic'
export type DensityPreset = 'compact' | 'comfortable' | 'spacious'
export type FontPreset = 'manrope' | 'system' | 'custom'
export type BodyFontWeightPreset = 'regular' | 'medium'
export type EmphasisFontWeightPreset = 'standard' | 'bold'
export type RelatedImageCardAspectRatio = 'original' | 'square' | 'portrait' | 'landscape'
export type GroupExplorerCardStyle = 'compact-row' | 'media-tile'
export type AppearancePresetSlotId = 'slot-1' | 'slot-2' | 'slot-3'

export interface AppearanceThemeSettings {
  themeMode: ThemeMode
  accentPreset: AppearancePreset
  customPrimaryColor: string
  customSecondaryColor: string
  surfacePreset: SurfacePreset
  customSurfaceBackgroundColor: string
  customSurfaceLowestColor?: string
  customSurfaceLowColor?: string
  customSurfaceContainerColor: string
  customSurfaceHighColor: string
  radiusPreset: RadiusPreset
  glassPreset: GlassPreset
  shadowPreset: ShadowPreset
  density: DensityPreset
  fontPreset: FontPreset
  customFontFamily: string
  customMonoFontFamily: string
  customFontUrl: string
  customMonoFontUrl: string
  customFontFileName: string
  customMonoFontFileName: string
  fontScalePercent: number
  textScalePercent: number
  bodyFontWeightPreset: BodyFontWeightPreset
  emphasisFontWeightPreset: EmphasisFontWeightPreset
  searchBoxWidth: number
  searchDrawerWidth: number
  desktopSearchMinWidth: number
  desktopNavMinWidth: number
  desktopPageColumnsMinWidth: number
  detailRelatedImageMobileColumns: number
  detailRelatedImageColumns: number
  detailRelatedImageAspectRatio: RelatedImageCardAspectRatio
  groupExplorerCardStyle: GroupExplorerCardStyle
  selectionOutlineWidth: number
  positiveBadgeColor: string
  negativeBadgeColor: string
  autoBadgeColor: string
  ratingBadgeColor: string
}

export interface AppearancePresetSlot {
  id: AppearancePresetSlotId
  label: string
  appearance: AppearanceThemeSettings | null
  updatedAt: string | null
}

export interface AppearanceSettings extends AppearanceThemeSettings {
  presetSlots: AppearancePresetSlot[]
}

export interface MetadataExtractionSettings {
  enableSecondaryExtraction: boolean
  stealthScanMode: StealthScanMode
  stealthMaxFileSizeMB: number
  stealthMaxResolutionMP: number
  skipStealthForComfyUI: boolean
  skipStealthForWebUI: boolean
}

export type ImageSaveFormat = 'original' | 'png' | 'jpeg' | 'webp'

export interface ThumbnailSettings {
  size: 'original' | '2048' | '1080' | '720' | '512'
  quality: number
}

export interface ImageSaveSettings {
  defaultFormat: ImageSaveFormat
  quality: number
  resizeEnabled: boolean
  maxWidth: number
  maxHeight: number
  alwaysShowDialog: boolean
  applyToGenerationAttachments: boolean
  applyToEditorSave: boolean
  applyToCanvasSave: boolean
  applyToUpload: boolean
  applyToWorkflowOutputs: boolean
}

export interface AppSettings {
  general: GeneralSettings
  tagger: TaggerSettings
  kaloscope: KaloscopeSettings
  similarity: SimilaritySettings
  appearance: AppearanceSettings
  metadataExtraction: MetadataExtractionSettings
  thumbnail: ThumbnailSettings
  imageSave: ImageSaveSettings
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
