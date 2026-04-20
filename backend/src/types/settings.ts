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

export const DEFAULT_ARTIST_LINK_URL_TEMPLATE = 'danbooru.donmai.us/posts?tags={key}';

export interface TaggerSettings {
  enabled: boolean;                // Tagger 활성화 (활성화 시 자동으로 미처리 이미지 태깅)
  autoTagOnUpload: boolean;        // 업로드 시 자동 태깅 여부
  model: TaggerModel;
  device: TaggerDevice;            // 디바이스 선택 (auto/cpu/cuda)
  generalThreshold: number;
  characterThreshold: number;
  pythonPath: string;
  keepModelLoaded: boolean;        // 메모리 유지 여부
  autoUnloadMinutes: number;       // 자동 언로드 시간 (분)
}

export interface KaloscopeSettings {
  enabled: boolean;                // Kaloscope 활성화
  autoTagOnUpload: boolean;        // 업로드/스케줄러 자동 처리 여부
  device: KaloscopeDevice;         // 디바이스 선택 (auto/cpu/cuda)
  topK: number;                    // 추출할 아티스트 태그 수
  keepModelLoaded: boolean;        // 메모리 유지 여부
  autoUnloadMinutes: number;       // 자동 언로드 시간 (분)
  artistLinkUrlTemplate: string;   // Artist prompt 배지 외부 링크 템플릿 ({key} placeholder)
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

export interface SimilaritySettings {
  autoGenerateHashOnUpload: boolean;      // 업로드 시 자동 해시 생성 여부
  detailSimilarThreshold: number;         // 레거시 pHash 범위 호환값
  detailSimilarLimit: number;             // 상세 페이지 유사 이미지 최대 개수
  detailSimilarIncludeColorSimilarity: boolean; // 색상 유사도 포함 여부
  detailSimilarWeights: SimilarityComponentWeights;
  detailSimilarThresholds: SimilarityComponentThresholds;
  detailSimilarUseMetadataFilter: boolean;
  detailSimilarSortBy: 'similarity' | 'upload_date' | 'file_size';
  detailSimilarSortOrder: 'ASC' | 'DESC';
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
export type WallpaperWidgetType = 'clock' | 'queue-status' | 'recent-results' | 'activity-pulse' | 'group-image-view' | 'image-showcase' | 'floating-collage' | 'text-note';

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
  type: WallpaperWidgetType;
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

export interface ThumbnailSettings {
  size: ThumbnailSize;   // 썸네일 크기 (original = 원본 크기 유지)
  quality: number;       // 썸네일 품질 (60-100)
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

export interface AppSettings {
  general: GeneralSettings;
  tagger: TaggerSettings;
  kaloscope: KaloscopeSettings;
  similarity: SimilaritySettings;
  appearance: AppearanceSettings;
  metadataExtraction: MetadataExtractionSettings;
  thumbnail: ThumbnailSettings;
  imageSave: ImageSaveSettings;
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

export interface ModelDownloadProgress {
  model: TaggerModel;
  status: 'idle' | 'downloading' | 'completed' | 'error';
  progress?: number;
  error?: string;
}

export interface TaggerServerStatus {
  isRunning: boolean;              // Daemon 실행 상태
  modelLoaded: boolean;            // 모델 로드 상태
  currentModel: TaggerModel | null; // 현재 로드된 모델
  currentDevice: string | null;    // 현재 사용 중인 디바이스 (예: "cuda:0", "cpu")
  lastUsedAt: string | null;       // 마지막 사용 시간 (ISO string)
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
