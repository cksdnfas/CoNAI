import { buildApiUrl, fetchJson } from '@/lib/api-client'
import { createApiFallbackError } from '@/i18n/api-error-fallbacks'
import type { ApiResponse } from '@/types/image'
import type {
  AppearanceSettings,
  AppSettings,
  GenerationThrottleSettings,
  GeneralSettings,
  ImageSaveSettings,
  KaloscopeServerStatus,
  KaloscopeSettings,
  LlmSettings,
  MetadataExtractionSettings,
  SimilaritySettings,
  TaggerDependencyCheckResult,
  TaggerModelInfo,
  TaggerServerStatus,
  TaggerSettings,
  ThumbnailSettings,
  VideoOptimizationSettings,
} from '@/types/settings'
import type { RatingTierRecord } from '@/features/search/search-types'

export interface RatingTierUpdateInput {
  tier_name: string
  min_score: number
  max_score: number | null
  tier_order: number
  color?: string | null
  feed_visibility?: 'show' | 'blur' | 'hide'
}

export interface RatingWeightsRecord {
  id: number
  general_weight: number
  sensitive_weight: number
  questionable_weight: number
  explicit_weight: number
  created_at: string
  updated_at: string
}

export interface AutoTestMediaRecord {
  compositeHash: string
  fileName: string | null
  originalFilePath: string | null
  mimeType: string | null
  fileType: string | null
  fileSize: number | null
  width: number | null
  height: number | null
  existsOnDisk: boolean
  thumbnailUrl: string | null
  imageUrl: string | null
}

export interface AutoTestTaggerResult {
  caption?: string
  taglist?: string
  model?: string
  rating?: Record<string, number>
  general?: Record<string, number>
  character?: Record<string, number>
  thresholds?: {
    general: number
    character: number
  }
}

export interface AutoTestKaloscopeResult {
  model?: string
  topk?: number
  artists?: Record<string, number>
  taglist?: string
  tagged_at?: string
}

export interface AppearanceFontUploadResult {
  target: 'sans' | 'mono'
  fileName: string
  originalName: string
  url: string
  mimeType: string
  size: number
}

export interface WallpaperRuntimeSettings {
  wallpaperLayoutPresets: AppearanceSettings['wallpaperLayoutPresets']
  wallpaperActivePresetId: string | null
}

export interface LlmPresetOptionRecord {
  id: string
  name: string
  content: string
  updatedAt: string
}

export interface LlmPresetOptionCollections {
  systemPromptPresets: LlmPresetOptionRecord[]
  promptPresets: LlmPresetOptionRecord[]
  structuredOutputJsonPresets: LlmPresetOptionRecord[]
}

export interface FileVerificationRunResult {
  totalChecked: number
  missingFound: number
  deletedRecords: number
  duration: number
  errors: Array<{
    fileId: number
    filePath: string
    error: string
  }>
}

export interface MetadataReextractAllResult {
  queuedCount: number
  skippedMissingCount: number
  totalCandidates: number
}

export type DataRematchPhase =
  | 'idle'
  | 'selecting-targets'
  | 'regenerating-thumbnails'
  | 'queueing-metadata'
  | 'rebuilding-hashes'
  | 'remapping-references'
  | 'completed'
  | 'failed'

export type DataRematchJobStatus = 'idle' | 'running' | 'completed' | 'failed'

export interface DataRematchOptions {
  thumbnail: boolean
  metadata: boolean
  hash: boolean
}

export interface DataRematchStartRequest extends Partial<DataRematchOptions> {
  confirmHashRegeneration?: boolean
}

export interface SystemMaintenanceLockSnapshot {
  active: boolean
  mode: 'exclusive' | null
  owner: string | null
  reason: string | null
  message: string | null
  startedAt: string | null
}

export interface DataRematchJobSnapshot {
  jobId: string | null
  status: DataRematchJobStatus
  phase: DataRematchPhase
  options: DataRematchOptions
  total: number
  processed: number
  failed: number
  skipped: number
  queued: number
  currentFile: string | null
  message: string
  warnings: string[]
  errors: Array<{ target: string; error: string }>
  startedAt: string | null
  completedAt: string | null
  maintenanceLock: SystemMaintenanceLockSnapshot
}

export async function getAppSettings() {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.app.load')
  }
  return response.data
}

export async function getPublicAppearanceSettings() {
  const response = await fetchJson<ApiResponse<AppearanceSettings>>('/api/settings/appearance-public')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.appearancePublic.load')
  }
  return response.data
}

export async function getRuntimeSimilaritySettings(init?: RequestInit) {
  const response = await fetchJson<ApiResponse<SimilaritySettings>>('/api/runtime-media-settings/similarity', init)
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.runtimeSimilarity.load')
  }
  return response.data
}

export async function getWallpaperRuntimeSettings() {
  const response = await fetchJson<ApiResponse<WallpaperRuntimeSettings>>('/api/wallpaper-runtime/settings')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.wallpaperRuntime.load')
  }
  return response.data
}

export async function runFileVerification() {
  const response = await fetchJson<{ success: boolean; result?: FileVerificationRunResult; error?: string }>('/api/file-verification/verify', {
    method: 'POST',
  })

  if (!response.success || !response.result) {
    throw createApiFallbackError(response.error, 'settings.fileVerification.run')
  }

  return response.result
}

export async function updateGeneralSettings(settings: Partial<GeneralSettings>) {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings/general', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.general.update')
  }

  return response.data
}

export async function updateMetadataSettings(settings: Partial<MetadataExtractionSettings>) {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings/metadata', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.metadata.update')
  }

  return response.data
}

export async function reextractAllImageMetadata() {
  const response = await fetchJson<ApiResponse<MetadataReextractAllResult>>('/api/settings/metadata/reextract-all', {
    method: 'POST',
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.metadata.reextractAll')
  }

  return response.data
}

export async function getDataRematchStatus() {
  const response = await fetchJson<ApiResponse<DataRematchJobSnapshot>>('/api/settings/data-rematch/status')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.dataRematch.status')
  }
  return response.data
}

export async function startDataRematchJob(request: DataRematchStartRequest) {
  const response = await fetchJson<ApiResponse<DataRematchJobSnapshot>>('/api/settings/data-rematch/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.dataRematch.start')
  }

  return response.data
}

export async function updateAppearanceSettings(settings: Partial<AppearanceSettings>) {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings/appearance', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.appearance.update')
  }

  return response.data
}

export async function updateImageSaveSettings(settings: Partial<ImageSaveSettings>) {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings/image-save', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.imageSave.update')
  }

  return response.data
}

export async function updateThumbnailSettings(settings: Partial<ThumbnailSettings>) {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings/thumbnail', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.thumbnail.update')
  }

  return response.data
}

export async function updateGenerationThrottleSettings(settings: Partial<GenerationThrottleSettings>) {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings/generation-throttle', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.generationThrottle.update')
  }

  return response.data
}

export async function updateVideoOptimizationSettings(settings: Partial<VideoOptimizationSettings>) {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings/video-optimization', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.videoOptimization.update')
  }

  return response.data
}

export async function updateLlmSettings(settings: Partial<LlmSettings>) {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings/llm', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.llm.update')
  }

  return response.data
}

export async function getLlmPresetOptions() {
  const response = await fetchJson<ApiResponse<LlmPresetOptionCollections>>('/api/settings/llm-presets/options')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.llmPresets.load')
  }
  return response.data
}

export async function uploadAppearanceFont(file: File, target: 'sans' | 'mono') {
  const formData = new FormData()
  formData.append('font', file)
  formData.append('target', target)

  const response = await fetch(buildApiUrl('/api/settings/appearance/font-upload'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
    body: formData,
  })

  const payload = (await response.json()) as ApiResponse<AppearanceFontUploadResult>
  if (!response.ok || !payload.success) {
    throw createApiFallbackError(payload.error, 'settings.appearanceFont.upload')
  }

  return payload.data
}

export async function updateTaggerSettings(settings: Partial<TaggerSettings>) {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings/tagger', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.tagger.update')
  }

  return response.data
}

export async function getTaggerModels() {
  const response = await fetchJson<ApiResponse<TaggerModelInfo[]>>('/api/settings/tagger/models')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.taggerModels.load')
  }
  return response.data
}

export async function getTaggerStatus() {
  const response = await fetchJson<ApiResponse<TaggerServerStatus>>('/api/settings/tagger/status')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.taggerStatus.load')
  }
  return response.data
}

export async function checkTaggerDependencies() {
  const response = await fetchJson<ApiResponse<TaggerDependencyCheckResult>>('/api/settings/tagger/check-dependencies', {
    method: 'POST',
  })
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.taggerDependencies.check')
  }
  return response.data
}

export async function updateKaloscopeSettings(settings: Partial<KaloscopeSettings>) {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings/kaloscope', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.kaloscope.update')
  }

  return response.data
}

export async function getRatingWeights() {
  const response = await fetchJson<ApiResponse<RatingWeightsRecord>>('/api/settings/rating/weights')
  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'settings.ratingWeights.load')
  }
  return response.data
}

export async function updateRatingWeights(weights: Partial<Pick<RatingWeightsRecord, 'general_weight' | 'sensitive_weight' | 'questionable_weight' | 'explicit_weight'>>) {
  const response = await fetchJson<ApiResponse<RatingWeightsRecord>>('/api/settings/rating/weights', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(weights),
  })

  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'settings.ratingWeights.update')
  }

  return response.data
}

export async function updateRatingTiers(tiers: RatingTierUpdateInput[]) {
  const response = await fetchJson<ApiResponse<RatingTierRecord[]>>('/api/settings/rating/tiers', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(tiers),
  })

  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'settings.ratingTiers.update')
  }

  return response.data
}

export async function getKaloscopeStatus() {
  const response = await fetchJson<ApiResponse<KaloscopeServerStatus>>('/api/settings/kaloscope/status')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.kaloscopeStatus.load')
  }
  return response.data
}

export async function resolveAutoTestMedia(imageId: string) {
  const response = await fetchJson<ApiResponse<AutoTestMediaRecord>>(`/api/settings/auto-test/media/${encodeURIComponent(imageId)}`)
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.autoTestMedia.resolve')
  }
  return response.data
}

export async function getRandomAutoTestMedia() {
  const response = await fetchJson<ApiResponse<AutoTestMediaRecord>>('/api/settings/auto-test/random')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.autoTestMedia.random')
  }
  return response.data
}

export async function runTaggerAutoTest(imageId: string) {
  const response = await fetchJson<ApiResponse<AutoTestTaggerResult>>('/api/settings/tagger/test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ imageId }),
  })
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.taggerAutoTest.run')
  }
  return response.data
}

export async function runKaloscopeAutoTest(imageId: string) {
  const response = await fetchJson<ApiResponse<AutoTestKaloscopeResult>>('/api/settings/kaloscope/test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ imageId }),
  })
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.kaloscopeAutoTest.run')
  }
  return response.data
}

type SimilaritySettingsUpdateInput = Partial<Omit<SimilaritySettings, 'promptSimilarity'>> & {
  promptSimilarity?: Partial<SimilaritySettings['promptSimilarity']>
}

export async function updateSimilaritySettings(settings: SimilaritySettingsUpdateInput) {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings/similarity', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.similarity.update')
  }

  return response.data
}
