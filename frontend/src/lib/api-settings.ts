import { buildApiUrl, fetchJson } from '@/lib/api-client'
import type { ApiResponse } from '@/types/image'
import type {
  AppearanceSettings,
  AppSettings,
  ImageSaveSettings,
  KaloscopeServerStatus,
  KaloscopeSettings,
  MetadataExtractionSettings,
  SimilaritySettings,
  TaggerDependencyCheckResult,
  TaggerModelInfo,
  TaggerServerStatus,
  TaggerSettings,
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

export async function getAppSettings() {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings')
  if (!response.success) {
    throw new Error(response.error || '설정을 불러오지 못했어.')
  }
  return response.data
}

export async function getWallpaperRuntimeSettings() {
  const response = await fetchJson<ApiResponse<WallpaperRuntimeSettings>>('/api/wallpaper-runtime/settings')
  if (!response.success) {
    throw new Error(response.error || '월페이퍼 라이브 설정을 불러오지 못했어.')
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
    throw new Error(response.error || '메타데이터 추출 설정을 저장하지 못했어.')
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
    throw new Error(response.error || '화면 설정을 저장하지 못했어.')
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
    throw new Error(response.error || '이미지 저장 설정을 저장하지 못했어.')
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
    throw new Error(payload.error || '커스텀 폰트 업로드에 실패했어.')
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
    throw new Error(response.error || '태거 설정을 저장하지 못했어.')
  }

  return response.data
}

export async function getTaggerModels() {
  const response = await fetchJson<ApiResponse<TaggerModelInfo[]>>('/api/settings/tagger/models')
  if (!response.success) {
    throw new Error(response.error || '태거 모델 목록을 불러오지 못했어.')
  }
  return response.data
}

export async function getTaggerStatus() {
  const response = await fetchJson<ApiResponse<TaggerServerStatus>>('/api/settings/tagger/status')
  if (!response.success) {
    throw new Error(response.error || '태거 상태를 불러오지 못했어.')
  }
  return response.data
}

export async function checkTaggerDependencies() {
  const response = await fetchJson<ApiResponse<TaggerDependencyCheckResult>>('/api/settings/tagger/check-dependencies', {
    method: 'POST',
  })
  if (!response.success) {
    throw new Error(response.error || '태거 의존성을 확인하지 못했어.')
  }
  return response.data
}

export async function loadTaggerModel(payload?: { model?: TaggerSettings['model']; device?: TaggerSettings['device'] }) {
  const response = await fetchJson<ApiResponse<Record<string, unknown>>>('/api/settings/tagger/load-model', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload ?? {}),
  })
  if (!response.success) {
    throw new Error(response.error || '태거 모델을 로드하지 못했어.')
  }
  return response.data
}

export async function unloadTaggerModel() {
  const response = await fetchJson<ApiResponse<Record<string, unknown>>>('/api/settings/tagger/unload-model', {
    method: 'POST',
  })
  if (!response.success) {
    throw new Error(response.error || '태거 모델을 언로드하지 못했어.')
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
    throw new Error(response.error || 'Kaloscope 설정을 저장하지 못했어.')
  }

  return response.data
}

export async function getRatingWeights() {
  const response = await fetchJson<ApiResponse<RatingWeightsRecord>>('/api/settings/rating/weights')
  if (!response.success || !response.data) {
    throw new Error(response.error || '평가 가중치를 불러오지 못했어.')
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
    throw new Error(response.error || '평가 가중치를 저장하지 못했어.')
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
    throw new Error(response.error || '평가 등급 설정을 저장하지 못했어.')
  }

  return response.data
}

export async function getKaloscopeStatus() {
  const response = await fetchJson<ApiResponse<KaloscopeServerStatus>>('/api/settings/kaloscope/status')
  if (!response.success) {
    throw new Error(response.error || 'Kaloscope 상태를 불러오지 못했어.')
  }
  return response.data
}

export async function loadKaloscopeModel() {
  const response = await fetchJson<ApiResponse<Record<string, unknown>>>('/api/settings/kaloscope/load-model', {
    method: 'POST',
  })
  if (!response.success) {
    throw new Error(response.error || 'Kaloscope 모델을 캐시하지 못했어.')
  }
  return response.data
}

export async function unloadKaloscopeModel() {
  const response = await fetchJson<ApiResponse<Record<string, unknown>>>('/api/settings/kaloscope/unload-model', {
    method: 'POST',
  })
  if (!response.success) {
    throw new Error(response.error || 'Kaloscope 모델 캐시를 제거하지 못했어.')
  }
  return response.data
}

export async function resolveAutoTestMedia(imageId: string) {
  const response = await fetchJson<ApiResponse<AutoTestMediaRecord>>(`/api/settings/auto-test/media/${encodeURIComponent(imageId)}`)
  if (!response.success) {
    throw new Error(response.error || '테스트 대상을 찾지 못했어.')
  }
  return response.data
}

export async function getRandomAutoTestMedia() {
  const response = await fetchJson<ApiResponse<AutoTestMediaRecord>>('/api/settings/auto-test/random')
  if (!response.success) {
    throw new Error(response.error || '랜덤 테스트 대상을 고르지 못했어.')
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
    throw new Error(response.error || '태거 테스트에 실패했어.')
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
    throw new Error(response.error || 'Kaloscope 테스트에 실패했어.')
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
    throw new Error(response.error || '유사도 설정을 저장하지 못했어.')
  }

  return response.data
}
