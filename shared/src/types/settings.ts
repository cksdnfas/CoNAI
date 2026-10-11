/** API wire contracts shared by the backend and frontend settings clients. */

export type SupportedLanguage = 'ko' | 'en';

export interface DeleteProtectionSettings {
  enabled: boolean;
  /** Days a file stays in the RecycleBin before the daily cleanup deletes it; 0 keeps files until emptied by hand. */
  recycleBinRetentionDays: number;
  /**
   * @deprecated Never read: the RecycleBin always lives at the runtime path (`RUNTIME_RECYCLE_BIN_DIR`). Old stored
   * settings may still carry it; the server accepts and drops it.
   */
  recycleBinPath?: string;
}

export const MAX_RECYCLE_BIN_RETENTION_DAYS = 3650;

/** Whole days within range; anything else (missing, negative, fractional, too large) turns the cleanup off. */
export function normalizeRecycleBinRetentionDays(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_RECYCLE_BIN_RETENTION_DAYS ? value : 0;
}

export const HEADER_NAVIGATION_ITEM_KEYS = [
  'access',
  'home',
  'groups',
  'prompts',
  'generation',
  'audio',
  'posts',
  'sprite',
  'chat',
  'upload',
  'files',
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
  promptForDownloadLocation: boolean;
  deleteProtection: DeleteProtectionSettings;
  headerNavigation: HeaderNavigationSettings;
  enableGallery?: boolean;
  autoCleanupCanvasOnShutdown?: boolean;
  showRatingBadges?: boolean;
  imageSimilarityCheckMode?: ImageSimilarityCheckMode;
  applyRatingSafetyToGenerationHistory: boolean;
  generationHistoryMaxItems: number;
  /** Admin-chosen badge colours per permission group key (`#rgb` / `#rrggbb`); missing keys use the built-in palette. */
  permissionGroupColors?: Record<string, string>;
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

/** WD v3 variants, or the PixAI tagger (GPU only). */
export type TaggerModel = 'vit' | 'swinv2' | 'convnext' | 'pixai-v1';
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
  /** true면 모델을 계속 메모리에 두고, false면 autoUnloadMinutes 동안 쓰지 않을 때 내린다. */
  keepModelLoaded: boolean;
  autoUnloadMinutes: number;
  /** keepModelLoaded 의미를 바로잡은 뒤 저장된 값인지 표시한다. 없으면 예전(반대 의미) 값이다. */
  unloadPolicyVersion?: number;
}

export interface KaloscopeSettings {
  enabled: boolean;
  autoTagOnUpload: boolean;
  device: KaloscopeDevice;
  topK: number;
  keepModelLoaded: boolean;
  autoUnloadMinutes: number;
  unloadPolicyVersion?: number;
  artistLinkUrlTemplate: string;
  /** Keep each image's 256-d style vector (Kaloscope 3) for "similar style" searches. Missing = on. */
  styleVectors?: boolean;
}

/** Text embeddings (EmbeddingGemma 2, CPU): meaning-based recall and search beside the keyword paths. */
export interface EmbeddingSettings {
  enabled: boolean;
  /** Chat: folded past episodes come back by meaning, not only by shared words. */
  chatRecall: boolean;
  /** Chat: keyword lorebook entries come in when the talk is about them, without a keyword. */
  lorebook: boolean;
  /** Chat history search also finds related wording. */
  chatHistory: boolean;
  /** File store search (minutes and linked files included) also finds related wording. */
  fileSearch: boolean;
  /**
   * Library images get an image vector (CPU, about 0.7 s each, in the background): find images by a description and
   * by what they show. Loads the vision part of the model too (about 2.2 GB instead of 1.3 GB). Off by default.
   */
  imageSearch: boolean;
  keepModelLoaded: boolean;
  autoUnloadMinutes: number;
}

export interface EmbeddingIndexCount {
  space: string;
  items: number;
}

export interface EmbeddingServerStatus {
  enabled: boolean;
  dependenciesAvailable: boolean;
  statusMessage: string;
  model: string;
  modelRepo: string;
  modelCached: boolean;
  modelLoaded: boolean;
  isRunning: boolean;
  lastUsedAt: string | null;
  /** Items embedded per space (chat recall, lore, messages, files, images). */
  indexed: EmbeddingIndexCount[];
  /** Whether the background indexer still has work. */
  indexing: boolean;
  download: { repo: string; file: string; state: 'start' | 'done'; bytes: number | null; at: string } | null;
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
  'calendar',
  'generation-progress',
  'generation-stats',
  'llm-usage',
  'library-stats',
  'character-card',
  'chat-recent',
  'audio-player',
  'post-ticker',
  'prompt-of-day',
  'audio-visualizer',
  'now-playing',
  'system-monitor',
  'quick-run',
] as const;

export type WallpaperWidgetType = (typeof WALLPAPER_WIDGET_TYPES)[number];

/**
 * Layout version 2 places widgets in canvas pixels (free placement). Version 1 (absent) stored grid
 * cells of the canvas preset; clients convert those once when they load the preset.
 */
export const WALLPAPER_LAYOUT_VERSION = 2;

export const WALLPAPER_BACKGROUND_KINDS = ['theme', 'color', 'gradient', 'image', 'video', 'group-slideshow'] as const;
export type WallpaperBackgroundKind = (typeof WALLPAPER_BACKGROUND_KINDS)[number];

/** Canvas background; media come from the library (image hash / group), never side files. */
export interface WallpaperBackground {
  kind: WallpaperBackgroundKind;
  [key: string]: unknown;
}

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
  /** Degrees, layout version 2. */
  rotation?: number;
  /** Shared frame look (variant, colors, radius, type); kept open like settings. */
  style?: Record<string, unknown>;
  settings: Record<string, unknown>;
}

export interface WallpaperLayoutPreset {
  id: string;
  name: string;
  canvasPresetId: string;
  /** WALLPAPER_LAYOUT_VERSION when widget frames are canvas pixels; absent = grid cells. */
  version?: number;
  /** Canvas size for canvasPresetId 'custom'. */
  canvasWidth?: number;
  canvasHeight?: number;
  /** 'auto' is light by day (07:00-19:00 local) and dark at night. */
  themeMode?: 'dark' | 'light' | 'auto';
  background?: WallpaperBackground;
  /** Preset-wide look, effects and behavior (accent, particles, parallax, clean desktop, FPS); kept open. */
  options?: Record<string, unknown>;
  widgets: WallpaperWidgetInstance[];
  createdAt: string;
  updatedAt: string;
}

/** One time window of the wallpaper schedule; `end` before `start` wraps past midnight. */
export interface WallpaperScheduleEntry {
  id: string;
  presetId: string;
  /** 0 = Sunday … 6 = Saturday; empty = every day. */
  days: number[];
  /** HH:MM, local time of the wallpaper's machine. */
  start: string;
  end: string;
}

/** Which wallpaper the live page shows when no key or link pins one. */
export interface WallpaperSchedule {
  enabled: boolean;
  entries: WallpaperScheduleEntry[];
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
  wallpaperSchedule?: WallpaperSchedule;
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
  /** Which set of starter presets was already added (they are added once, then belong to the user). */
  builtinSeedVersion?: number;
}

/** `configure` is chat-only (proposing chat profiles and display blocks); HTTP keys never carry it. */
export type McpHttpScope = 'read' | 'generate' | 'organize' | 'configure' | 'backup' | 'restore';

export interface McpHttpApiKey {
  id: string;
  name: string;
  apiKey: string;
  scopes: McpHttpScope[];
  createdAt: string;
  updatedAt: string;
}

export interface McpHttpSettings {
  enabled: boolean;
  keys: McpHttpApiKey[];
  updatedAt: string;
}

/** PyTorch wheel build the app-managed Python environment is installed with. */
export type AiTorchBackend = 'cpu' | 'cu126' | 'cu130' | 'cu132';
export type AiTorchBackendPreference = 'auto' | AiTorchBackend;
/** `auto`: the app-installed environment when there is one, otherwise `customPythonPath`. */
export type AiPythonSource = 'auto' | 'custom';

export interface AiRuntimeSettings {
  pythonSource: AiPythonSource;
  /** Python used when the source is `custom`, or when no app-installed environment exists yet. */
  customPythonPath: string;
  /** Build to install; `auto` picks one from the detected GPU and driver. */
  torchBackend: AiTorchBackendPreference;
  /** CPU threads per AI worker process; 0 = half the logical cores, at most 8. */
  cpuThreads: number;
}

export interface AiGpuInfo {
  index: number;
  name: string;
  /** e.g. "12.0" */
  computeCapability: string;
  driverVersion: string;
  memoryMiB: number | null;
}

/**
 * Why the build was picked: `no-gpu` (cpu), `legacy-gpu` (cc < 7.5 → cu126), `old-driver` (driver below the CUDA 13
 * minimum → cu126), `current` (cu130). `blocked` is set when no CUDA build can run here (e.g. an RTX 50 card with a
 * driver older than CUDA 13 needs).
 */
export interface AiRuntimeRecommendation {
  backend: AiTorchBackend;
  reason: 'no-gpu' | 'legacy-gpu' | 'old-driver' | 'current';
  blocked: 'driver-too-old' | null;
}

export interface AiRuntimeProbe {
  ok: boolean;
  python: string | null;
  torch: string | null;
  torchCuda: string | null;
  cudaAvailable: boolean;
  devices: Array<{ name: string; capability: string }>;
  archList: string[];
  /** Every visible GPU has kernels in this build (null when there is no GPU). */
  gpuSupported: boolean | null;
  /** A small matmul ran on the GPU (null when there is no GPU). */
  gpuComputeOk: boolean | null;
  packages: Record<string, string | null>;
  error: string | null;
}

export interface AiRuntimeEnvironment {
  id: string;
  backend: AiTorchBackend;
  createdAt: string;
  pythonPath: string;
  probe: AiRuntimeProbe | null;
}

export type AiRuntimeInstallStep = 'uv' | 'python' | 'venv' | 'packages' | 'verify' | 'activate';

export interface AiRuntimeInstallState {
  status: 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  backend: AiTorchBackend | null;
  step: AiRuntimeInstallStep | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Bytes the package cache grew by during this install (download progress without a known total). */
  downloadedBytes: number;
  log: string[];
  error: string | null;
}

export interface AiRuntimeStatus {
  settings: AiRuntimeSettings;
  gpus: AiGpuInfo[];
  detectError: string | null;
  recommendation: AiRuntimeRecommendation;
  /** Build an install with `torchBackend: auto` would use. */
  effectiveBackend: AiTorchBackend;
  active: AiRuntimeEnvironment | null;
  resolvedPython: { command: string; source: 'managed' | 'custom' };
  install: AiRuntimeInstallState;
  /** The app can install an environment on this platform (uv has a build for it). */
  installSupported: boolean;
}

export interface AppSettings {
  general: GeneralSettings;
  aiRuntime: AiRuntimeSettings;
  tagger: TaggerSettings;
  kaloscope: KaloscopeSettings;
  embedding: EmbeddingSettings;
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
  /** Runs only on a CUDA GPU. */
  requiresGpu?: boolean;
  /** False when this runtime cannot run it (no usable GPU). */
  available?: boolean;
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
  /** Library items whose artist result came from an older Kaloscope model. */
  outdatedResults?: number;
}
