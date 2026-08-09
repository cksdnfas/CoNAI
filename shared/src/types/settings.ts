/** API wire contracts shared by the backend and frontend settings clients. */

export type SupportedLanguage = 'ko' | 'en';

export interface DeleteProtectionSettings {
  enabled: boolean;
  recycleBinPath: string;
}

export const HEADER_NAVIGATION_ITEM_KEYS = [
  'access',
  'home',
  'groups',
  'prompts',
  'generation',
  'upload',
  'wallpaper',
  'settings',
  'search',
  'queue',
  'account',
] as const;

export type HeaderNavigationItemKey = typeof HEADER_NAVIGATION_ITEM_KEYS[number];
export type HeaderNavigationSettings = Record<HeaderNavigationItemKey, boolean>;
export type ImageSimilarityCheckMode = 'manual' | 'always';

export interface GeneralSettings {
  language: SupportedLanguage;
  deleteProtection: DeleteProtectionSettings;
  headerNavigation: HeaderNavigationSettings;
  enableGallery?: boolean;
  autoCleanupCanvasOnShutdown?: boolean;
  showRatingBadges?: boolean;
  imageSimilarityCheckMode?: ImageSimilarityCheckMode;
  applyRatingSafetyToGenerationHistory: boolean;
  generationHistoryMaxItems: number;
}

export type StealthScanMode = 'full' | 'fast' | 'skip';

export interface MetadataExtractionSettings {
  enableSecondaryExtraction: boolean;
  stealthScanMode: StealthScanMode;
  stealthMaxFileSizeMB: number;
  stealthMaxResolutionMP: number;
  skipStealthForComfyUI: boolean;
  skipStealthForWebUI: boolean;
}

export type TaggerModel = 'vit' | 'swinv2' | 'convnext';
export type TaggerDevice = 'auto' | 'cpu' | 'cuda';
export type KaloscopeDevice = 'auto' | 'cpu' | 'cuda';
export type PromptSimilarityAlgorithm = 'simhash' | 'minhash';

export interface TaggerSettings {
  enabled: boolean;
  autoTagOnUpload: boolean;
  model: TaggerModel;
  device: TaggerDevice;
  generalThreshold: number;
  characterThreshold: number;
  pythonPath: string;
  keepModelLoaded: boolean;
  autoUnloadMinutes: number;
}

export interface KaloscopeSettings {
  enabled: boolean;
  autoTagOnUpload: boolean;
  device: KaloscopeDevice;
  topK: number;
  keepModelLoaded: boolean;
  autoUnloadMinutes: number;
  artistLinkUrlTemplate: string;
}

export interface PromptSimilarityWeights {
  positive: number;
  negative: number;
  auto: number;
}

export interface PromptSimilarityFieldThresholds {
  positive: number;
  negative: number;
  auto: number;
}

export interface PromptSimilaritySettings {
  enabled: boolean;
  algorithm: PromptSimilarityAlgorithm;
  autoBuildOnMetadataUpdate: boolean;
  resultLimit: number;
  combinedThreshold: number;
  weights: PromptSimilarityWeights;
  fieldThresholds: PromptSimilarityFieldThresholds;
}

export interface SimilarityComponentWeights {
  perceptualHash: number;
  dHash: number;
  aHash: number;
  color: number;
}

export interface SimilarityComponentThresholds {
  perceptualHash: number;
  dHash: number;
  aHash: number;
  color: number;
}

export type SimilaritySortBy = 'similarity' | 'upload_date' | 'file_size';
export type SimilaritySortOrder = 'ASC' | 'DESC';

export interface SimilaritySettings {
  autoGenerateHashOnUpload: boolean;
  detailSimilarThreshold: number;
  detailSimilarLimit: number;
  detailSimilarIncludeColorSimilarity: boolean;
  detailSimilarWeights: SimilarityComponentWeights;
  detailSimilarThresholds: SimilarityComponentThresholds;
  detailSimilarUseMetadataFilter: boolean;
  detailSimilarSortBy: SimilaritySortBy;
  detailSimilarSortOrder: SimilaritySortOrder;
  promptSimilarity: PromptSimilaritySettings;
}

export type ThemeMode = 'system' | 'dark' | 'light';
export type AppearancePreset = 'conai' | 'ocean' | 'forest' | 'custom';
export type SurfacePreset = 'studio' | 'midnight' | 'paper' | 'custom';
export type RadiusPreset = 'sharp' | 'balanced' | 'soft';
export type GlassPreset = 'subtle' | 'balanced' | 'immersive';
export type ShadowPreset = 'soft' | 'balanced' | 'dramatic';
export type DensityPreset = 'ultra-compact' | 'compact' | 'comfortable' | 'spacious';
export type FontPreset = 'manrope' | 'system' | 'custom';
export type BodyFontWeightPreset = 'regular' | 'medium';
export type EmphasisFontWeightPreset = 'standard' | 'bold';
export type RelatedImageCardAspectRatio = 'original' | 'square' | 'portrait' | 'landscape';
export type GroupExplorerCardStyle = 'compact-row' | 'media-tile';
export type AppearancePresetSlotId = 'slot-1' | 'slot-2' | 'slot-3';
export const WALLPAPER_WIDGET_TYPES = [
  'clock',
  'queue-status',
  'recent-results',
  'activity-pulse',
  'group-image-view',
  'image-showcase',
  'floating-collage',
  'text-note',
] as const;

export type WallpaperWidgetType = (typeof WALLPAPER_WIDGET_TYPES)[number];

export interface WallpaperWidgetSize {
  w: number;
  h: number;
}

export interface WallpaperWidgetFrame extends WallpaperWidgetSize {
  x: number;
  y: number;
}

export interface WallpaperWidgetInstance extends WallpaperWidgetFrame {
  id: string;
  /** Kept open so older clients can round-trip widget types introduced by newer builds. */
  type: string;
  zIndex: number;
  locked: boolean;
  hidden: boolean;
  settings: Record<string, unknown>;
}

export interface WallpaperLayoutPreset {
  id: string;
  name: string;
  canvasPresetId: string;
  widgets: WallpaperWidgetInstance[];
  createdAt: string;
  updatedAt: string;
}

export interface AppearanceThemeSettings {
  themeMode: ThemeMode;
  accentPreset: AppearancePreset;
  customPrimaryColor: string;
  customSecondaryColor: string;
  surfacePreset: SurfacePreset;
  customSurfaceBackgroundColor: string;
  customSurfaceLowestColor?: string;
  customSurfaceLowColor?: string;
  customSurfaceContainerColor: string;
  customSurfaceHighColor: string;
  radiusPreset: RadiusPreset;
  glassPreset: GlassPreset;
  shadowPreset: ShadowPreset;
  density: DensityPreset;
  fontPreset: FontPreset;
  customFontFamily: string;
  customMonoFontFamily: string;
  customFontUrl: string;
  customMonoFontUrl: string;
  customFontFileName: string;
  customMonoFontFileName: string;
  fontScalePercent: number;
  textScalePercent: number;
  bodyFontWeightPreset: BodyFontWeightPreset;
  emphasisFontWeightPreset: EmphasisFontWeightPreset;
  desktopSearchMinWidth: number;
  desktopNavMinWidth: number;
  desktopPageColumnsMinWidth: number;
  detailRelatedImageMobileColumns: number;
  detailRelatedImageColumns: number;
  detailRelatedImageAspectRatio: RelatedImageCardAspectRatio;
  groupExplorerCardStyle: GroupExplorerCardStyle;
  selectionOutlineWidth: number;
  positiveBadgeColor: string;
  negativeBadgeColor: string;
  autoBadgeColor: string;
  ratingBadgeColor: string;
}

export interface AppearancePresetSlot {
  id: AppearancePresetSlotId;
  label: string;
  appearance: AppearanceThemeSettings | null;
  updatedAt: string | null;
}

export interface AppearanceSettings extends AppearanceThemeSettings {
  presetSlots: AppearancePresetSlot[];
  wallpaperLayoutPresets: WallpaperLayoutPreset[];
  wallpaperActivePresetId: string | null;
}

export type ThumbnailSize = 'original' | '2048' | '1080' | '720' | '512';
export type ImageSaveFormat = 'original' | 'png' | 'jpeg' | 'webp';
export type VideoOptimizationPreset = 'high-quality' | 'balanced' | 'economy';

export interface ThumbnailSettings {
  size: ThumbnailSize;
  quality: number;
}

export interface ImageSaveSettings {
  defaultFormat: ImageSaveFormat;
  quality: number;
  resizeEnabled: boolean;
  maxWidth: number;
  maxHeight: number;
  alwaysShowDialog: boolean;
  applyToGenerationAttachments: boolean;
  applyToEditorSave: boolean;
  applyToCanvasSave: boolean;
  applyToUpload: boolean;
  applyToWorkflowOutputs: boolean;
}

export type GenerationThrottleScheduleMode = 'even' | 'random';

export interface GenerationThrottleServiceSettings {
  maxConcurrentJobs: number;
  scheduleWindowMinutes: number;
  scheduleJobCount: number;
  scheduleMode: GenerationThrottleScheduleMode;
  minStartIntervalSeconds: number;
}

export type GenerationReservationUserQueuePolicy = 'continue_limited' | 'hold_until_empty';

export interface GenerationReservationSettings {
  maxConcurrentJobs: number;
  userQueuePolicy: GenerationReservationUserQueuePolicy;
}

export interface GenerationThrottleSettings {
  novelai: GenerationThrottleServiceSettings;
  codex: GenerationThrottleServiceSettings;
  reservations: GenerationReservationSettings;
}

export interface VideoOptimizationSettings {
  enabled: boolean;
  preset: VideoOptimizationPreset;
  crf: number;
  audioBitrateKbps: number;
  applyToUpload: boolean;
  applyToGeneratedOutputs: boolean;
  applyToBackupImports: boolean;
}

export interface LlmPresetRecord {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface LlmSettings {
  systemPromptPresets: LlmPresetRecord[];
  promptPresets: LlmPresetRecord[];
  structuredOutputJsonPresets: LlmPresetRecord[];
}

export interface AppSettings {
  general: GeneralSettings;
  tagger: TaggerSettings;
  kaloscope: KaloscopeSettings;
  similarity: SimilaritySettings;
  appearance: AppearanceSettings;
  metadataExtraction: MetadataExtractionSettings;
  thumbnail: ThumbnailSettings;
  imageSave: ImageSaveSettings;
  generationThrottle: GenerationThrottleSettings;
  videoOptimization: VideoOptimizationSettings;
  llm: LlmSettings;
}

export interface TaggerModelInfo {
  name: TaggerModel;
  label: string;
  description: string;
  downloaded: boolean;
}

export interface TaggerDependencyCheckResult {
  available: boolean;
  message: string;
}

export interface TaggerServerStatus {
  isRunning: boolean;
  modelLoaded: boolean;
  currentModel: TaggerModel | null;
  currentDevice: string | null;
  lastUsedAt: string | null;
}

export interface KaloscopeServerStatus {
  enabled: boolean;
  autoTagOnUpload: boolean;
  isRunning: boolean;
  modelLoaded: boolean;
  currentModel: string | null;
  currentDevice: string | null;
  lastUsedAt: string | null;
  topK: number;
  keepModelLoaded: boolean;
  autoUnloadMinutes: number;
  scriptExists: boolean;
  modelCached: boolean;
  modelRepo: string;
  modelFile: string;
  dependenciesAvailable: boolean;
  missingPackages: string[];
  statusMessage: string;
  installCommand?: string;
}
