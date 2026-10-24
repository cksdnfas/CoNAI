import type { PageSettingsVersions } from '@conai/shared'
import { fetchApiData, fetchJson, fetchRequiredApiData } from '@/lib/api-client'
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
import type { RuntimeJobRecord } from '@/types/runtime-job'

export interface RatingTierUpdateInput {
  /** An existing tier keeps its id (content rating ceilings point at it); a new draft's temporary id adds a tier. */
  id?: number
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

export async function getImageViewerSettings() {
  const result = await fetchJson<ApiResponse<{
    general: Pick<AppSettings['general'], 'imageSimilarityCheckMode'>
    imageSave: ImageSaveSettings
    kaloscope: Pick<AppSettings['kaloscope'], 'artistLinkUrlTemplate'>
    /** Image embeddings on: the library search takes a description and image details show content matches. */
    search?: { imageSearch: boolean }
  }>>('/api/runtime-media-settings/viewer')
  if (!result.success || !result.data) throw new Error('Failed to load image viewer settings')
  return result.data
}

export type RuntimeWorkflowSettings = {
  tagger: Pick<AppSettings['tagger'], 'enabled'>
  kaloscope: Pick<AppSettings['kaloscope'], 'enabled'>
}

export async function getRuntimeImageSaveSettings() {
  const result = await fetchJson<ApiResponse<{ imageSave: ImageSaveSettings }>>('/api/runtime-settings/image-save')
  if (!result.success || !result.data) throw new Error('Failed to load image save preferences')
  return result.data
}

export async function getRuntimeWorkflowSettings() {
  const result = await fetchJson<ApiResponse<RuntimeWorkflowSettings>>('/api/runtime-settings/workflows')
  if (!result.success || !result.data) throw new Error('Failed to load workflow capabilities')
  return result.data
}

export async function getRuntimeLanguageSettings() {
  const result = await fetchJson<ApiResponse<{ general: Pick<AppSettings['general'], 'language'> }>>('/api/runtime-settings/language')
  if (!result.success || !result.data) throw new Error('Failed to load UI language')
  return result.data
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
  return fetchApiData<SimilaritySettings>('/api/runtime-media-settings/similarity', 'settings.runtimeSimilarity.load', init)
}

/** Load the runtime-safe subset of generation history settings. */
export async function getRuntimeGenerationHistorySettings() {
  return fetchApiData<RuntimeGenerationHistorySettings>('/api/runtime-media-settings/generation-history', 'settings.runtimeGenerationHistory.load')
}

/** Start a full file verification. 202 + job; the `FileVerificationRunResult` arrives as the job's result. */
export async function runFileVerification() {
  return fetchRequiredApiData<RuntimeJobRecord<FileVerificationRunResult>>('/api/file-verification/verify', 'settings.fileVerification.run', {
    method: 'POST',
  })
}

export async function updateMetadataSettings(settings: Partial<MetadataExtractionSettings>, revision?: string) {
  return fetchApiData<AppSettings & PageSettingsVersions>('/api/settings/metadata', 'settings.metadata.update', {
    method: 'PUT',
    headers: {
      ...(revision ? { 'If-Match': revision } : {}), 'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

}

export async function reextractAllImageMetadata() {
  return fetchApiData<MetadataReextractAllResult>('/api/settings/metadata/reextract-all', 'settings.metadata.reextractAll', {
    method: 'POST',
  })
}

export async function getDataRematchStatus() {
  return fetchApiData<DataRematchJobSnapshot>('/api/settings/data-rematch/status', 'settings.dataRematch.status')
}

export async function startDataRematchJob(request: DataRematchStartRequest) {
  return fetchApiData<DataRematchJobSnapshot>('/api/settings/data-rematch/jobs', 'settings.dataRematch.start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

}

export async function updateImageSaveSettings(settings: Partial<ImageSaveSettings>, revision?: string) {
  return fetchApiData<AppSettings & PageSettingsVersions>('/api/settings/image-save', 'settings.imageSave.update', {
    method: 'PUT',
    headers: {
      ...(revision ? { 'If-Match': revision } : {}), 'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

}

export async function updateThumbnailSettings(settings: Partial<ThumbnailSettings>, revision?: string) {
  return fetchApiData<AppSettings & PageSettingsVersions>('/api/settings/thumbnail', 'settings.thumbnail.update', {
    method: 'PUT',
    headers: {
      ...(revision ? { 'If-Match': revision } : {}), 'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

}

export async function updateGenerationThrottleSettings(settings: Partial<GenerationThrottleSettings>, revision?: string) {
  return fetchApiData<AppSettings & PageSettingsVersions>('/api/settings/generation-throttle', 'settings.generationThrottle.update', {
    method: 'PUT',
    headers: {
      ...(revision ? { 'If-Match': revision } : {}), 'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

}

export async function updateVideoOptimizationSettings(settings: Partial<VideoOptimizationSettings>, revision?: string) {
  return fetchApiData<AppSettings & PageSettingsVersions>('/api/settings/video-optimization', 'settings.videoOptimization.update', {
    method: 'PUT',
    headers: {
      ...(revision ? { 'If-Match': revision } : {}), 'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

}

export async function getRatingWeights() {
  return fetchRequiredApiData<RatingWeightsRecord>('/api/settings/rating/weights', 'settings.ratingWeights.load')
}

export async function updateRatingWeights(weights: Partial<Pick<RatingWeightsRecord, 'general_weight' | 'sensitive_weight' | 'questionable_weight' | 'explicit_weight'>>) {
  return fetchRequiredApiData<RatingWeightsRecord>('/api/settings/rating/weights', 'settings.ratingWeights.update', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(weights),
  })

}

export async function updateRatingTiers(tiers: RatingTierUpdateInput[]) {
  return fetchRequiredApiData<RatingTierRecord[]>('/api/settings/rating/tiers', 'settings.ratingTiers.update', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(tiers),
  })

}

export async function resolveAutoTestMedia(imageId: string) {
  return fetchApiData<AutoTestMediaRecord>(`/api/settings/auto-test/media/${encodeURIComponent(imageId)}`, 'settings.autoTestMedia.resolve')
}

export async function getRandomAutoTestMedia() {
  return fetchApiData<AutoTestMediaRecord>('/api/settings/auto-test/random', 'settings.autoTestMedia.random')
}

type SimilaritySettingsUpdateInput = Partial<Omit<SimilaritySettings, 'promptSimilarity'>> & {
  promptSimilarity?: Partial<SimilaritySettings['promptSimilarity']>
}

export async function updateSimilaritySettings(settings: SimilaritySettingsUpdateInput) {
  return fetchApiData<AppSettings & PageSettingsVersions>('/api/settings/similarity', 'settings.similarity.update', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

}
