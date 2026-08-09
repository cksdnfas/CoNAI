import { fetchJson } from '@/lib/api-client'
import { createApiFallbackError } from '@/i18n/api-error-fallbacks'
import type { ApiResponse } from '@/types/image'
import type {
  AppSettings,
  GenerationThrottleSettings,
  ImageSaveSettings,
  MetadataExtractionSettings,
  SimilaritySettings,
  ThumbnailSettings,
  VideoOptimizationSettings,
} from '@conai/shared'
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

export interface RuntimeGenerationHistorySettings {
  applyRatingSafetyToGenerationHistory: boolean
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

export async function getRuntimeSimilaritySettings(init?: RequestInit) {
  const response = await fetchJson<ApiResponse<SimilaritySettings>>('/api/runtime-media-settings/similarity', init)
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.runtimeSimilarity.load')
  }
  return response.data
}

/** Load the runtime-safe subset of generation history settings. */
export async function getRuntimeGenerationHistorySettings() {
  const response = await fetchJson<ApiResponse<RuntimeGenerationHistorySettings>>('/api/runtime-media-settings/generation-history')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.runtimeGenerationHistory.load')
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
