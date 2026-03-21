import type {
  FolderScanLog,
  FolderWatcherStatus,
  ScanAllSummary,
  WatchedFolder,
  WatchedFolderInput,
  WatchedFolderUpdateInput,
  WatchersHealthSummary,
} from '@/types/folder'
import type { GroupBreadcrumbItem, GroupImagesPayload, GroupRecord, GroupWithHierarchy } from '@/types/group'
import type {
  PromptCollectionItem,
  PromptGroupRecord,
  PromptSearchPayload,
  PromptSortBy,
  PromptSortOrder,
  PromptStatistics,
  PromptTypeFilter,
} from '@/types/prompt'
import type {
  AppSettings,
  KaloscopeServerStatus,
  KaloscopeSettings,
  MetadataExtractionSettings,
  SimilaritySettings,
  SimilaritySortBy,
  SimilaritySortOrder,
  TaggerDependencyCheckResult,
  TaggerModelInfo,
  TaggerServerStatus,
  TaggerSettings,
} from '@/types/settings'
import type { SimilarityQueryResult } from '@/types/similarity'
import type { ApiResponse, ImageListPayload, ImageRecord } from '@/types/image'

const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

/** Build an API-relative URL for static media-style endpoints. */
function buildApiUrl(path: string) {
  return `${API_BASE}${path}`
}

/** Trigger a browser download from the current frontend context. */
function triggerBrowserDownload(url: string, filename?: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  if (filename) {
    anchor.download = filename
  }
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** Trigger a Blob download using a temporary object URL. */
function triggerBlobDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob)
  try {
    triggerBrowserDownload(objectUrl, filename)
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
  }
}

export async function getImages(params?: { page?: number; limit?: number }) {
  const searchParams = new URLSearchParams()
  searchParams.set('page', String(params?.page ?? 1))
  searchParams.set('limit', String(params?.limit ?? 12))
  searchParams.set('sortBy', 'first_seen_date')
  searchParams.set('sortOrder', 'DESC')

  const response = await fetchJson<ApiResponse<ImageListPayload>>(`/api/images?${searchParams.toString()}`)
  if (!response.success) {
    throw new Error(response.error || '이미지 목록을 불러오지 못했어.')
  }
  return response.data
}

export async function getImage(compositeHash: string) {
  const response = await fetchJson<ApiResponse<ImageRecord>>(`/api/images/${compositeHash}`)
  if (!response.success) {
    throw new Error(response.error || '이미지를 불러오지 못했어.')
  }
  return response.data
}

export async function getGroupsHierarchyAll() {
  const response = await fetchJson<ApiResponse<GroupWithHierarchy[]>>('/api/groups/hierarchy/all')
  if (!response.success) {
    throw new Error(response.error || '그룹 계층을 불러오지 못했어.')
  }
  return response.data
}

export async function getGroup(groupId: number) {
  const response = await fetchJson<ApiResponse<GroupRecord>>(`/api/groups/${groupId}`)
  if (!response.success) {
    throw new Error(response.error || '그룹 정보를 불러오지 못했어.')
  }
  return response.data
}

export async function getGroupBreadcrumb(groupId: number) {
  const response = await fetchJson<ApiResponse<GroupBreadcrumbItem[]>>(`/api/groups/${groupId}/breadcrumb`)
  if (!response.success) {
    throw new Error(response.error || '그룹 경로를 불러오지 못했어.')
  }
  return response.data
}

export async function getGroupImages(groupId: number, params?: { page?: number; limit?: number }) {
  const searchParams = new URLSearchParams()
  searchParams.set('page', String(params?.page ?? 1))
  searchParams.set('limit', String(params?.limit ?? 40))

  const response = await fetchJson<ApiResponse<GroupImagesPayload>>(
    `/api/groups/${groupId}/images?${searchParams.toString()}`,
  )
  if (!response.success) {
    throw new Error(response.error || '그룹 이미지를 불러오지 못했어.')
  }
  return response.data
}

export function getGroupThumbnailUrl(groupId: number) {
  return buildApiUrl(`/api/groups/${groupId}/thumbnail`)
}

export async function getPromptGroups(type: Exclude<PromptTypeFilter, 'both'> = 'positive') {
  const route = type === 'negative' ? '/api/negative-prompt-groups' : '/api/prompt-groups'
  const response = await fetchJson<{ success: boolean; data?: PromptGroupRecord[]; error?: string }>(route)
  if (!response.success || !response.data) {
    throw new Error(response.error || '프롬프트 그룹을 불러오지 못했어.')
  }
  return response.data
}

export async function searchPromptCollection(params?: {
  query?: string
  type?: PromptTypeFilter
  page?: number
  limit?: number
  sortBy?: PromptSortBy
  sortOrder?: PromptSortOrder
  groupId?: number | null
}) {
  const searchParams = new URLSearchParams()
  searchParams.set('q', params?.query ?? '')
  searchParams.set('type', params?.type ?? 'both')
  searchParams.set('page', String(params?.page ?? 1))
  searchParams.set('limit', String(params?.limit ?? 40))
  searchParams.set('sortBy', params?.sortBy ?? 'usage_count')
  searchParams.set('sortOrder', params?.sortOrder ?? 'DESC')
  if (params?.groupId !== undefined) {
    searchParams.set('group_id', params.groupId === null ? 'null' : String(params.groupId))
  }

  const response = await fetchJson<{
    success: boolean
    data?: PromptCollectionItem[]
    error?: string
    group_info?: PromptGroupRecord | null
    pagination?: { page: number; limit: number; total: number; totalPages: number }
  }>(`/api/prompt-collection/search?${searchParams.toString()}`)

  if (!response.success || !response.data || !response.pagination) {
    throw new Error(response.error || '프롬프트 목록을 불러오지 못했어.')
  }

  const payload: PromptSearchPayload = {
    items: response.data,
    groupInfo: response.group_info ?? null,
    pagination: response.pagination,
  }

  return payload
}

export async function getPromptStatistics() {
  const response = await fetchJson<ApiResponse<PromptStatistics>>('/api/prompt-collection/statistics')
  if (!response.success) {
    throw new Error(response.error || '프롬프트 통계를 불러오지 못했어.')
  }
  return response.data
}

export async function getTopPrompts(params?: { type?: PromptTypeFilter; limit?: number }) {
  const searchParams = new URLSearchParams()
  searchParams.set('type', params?.type ?? 'both')
  searchParams.set('limit', String(params?.limit ?? 8))

  const response = await fetchJson<ApiResponse<PromptCollectionItem[]>>(
    `/api/prompt-collection/top?${searchParams.toString()}`,
  )
  if (!response.success) {
    throw new Error(response.error || '상위 프롬프트를 불러오지 못했어.')
  }
  return response.data
}

export async function getWatchedFolders(activeOnly = false) {
  const searchParams = new URLSearchParams()
  if (activeOnly) {
    searchParams.set('active_only', 'true')
  }

  const response = await fetchJson<ApiResponse<WatchedFolder[]>>(`/api/folders?${searchParams.toString()}`)
  if (!response.success) {
    throw new Error(response.error || '감시 폴더를 불러오지 못했어.')
  }
  return response.data
}

export async function addWatchedFolder(folder: WatchedFolderInput) {
  const response = await fetchJson<ApiResponse<{ id: number; folder: WatchedFolder }>>('/api/folders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(folder),
  })

  if (!response.success) {
    throw new Error(response.error || '감시 폴더를 추가하지 못했어.')
  }

  return response.data
}

export async function updateWatchedFolder(folderId: number, updates: WatchedFolderUpdateInput) {
  const response = await fetchJson<ApiResponse<{ folder: WatchedFolder }>>(`/api/folders/${folderId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  })

  if (!response.success) {
    throw new Error(response.error || '감시 폴더를 저장하지 못했어.')
  }

  return response.data
}

export async function deleteWatchedFolder(folderId: number, deleteFiles = false) {
  const searchParams = new URLSearchParams()
  if (deleteFiles) {
    searchParams.set('delete_files', 'true')
  }

  const response = await fetchJson<ApiResponse<{ message: string }>>(
    `/api/folders/${folderId}?${searchParams.toString()}`,
    { method: 'DELETE' },
  )

  if (!response.success) {
    throw new Error(response.error || '감시 폴더를 삭제하지 못했어.')
  }

  return response.data
}

export async function validateWatchedFolderPath(folderPath: string) {
  const response = await fetchJson<ApiResponse<{ valid: boolean; message: string }>>('/api/folders/validate-path', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ folder_path: folderPath }),
  })

  if (!response.success) {
    throw new Error(response.error || '폴더 경로를 검증하지 못했어.')
  }

  return response.data
}

export async function scanWatchedFolder(folderId: number, full = false) {
  const response = await fetchJson<ApiResponse<Record<string, unknown>>>(`/api/folders/${folderId}/scan?full=${full}`, {
    method: 'POST',
  })

  if (!response.success) {
    throw new Error(response.error || '폴더 스캔을 실행하지 못했어.')
  }

  return response.data
}

export async function scanAllWatchedFolders() {
  const response = await fetchJson<ApiResponse<ScanAllSummary>>('/api/folders/scan-all', {
    method: 'POST',
  })

  if (!response.success) {
    throw new Error(response.error || '전체 폴더 스캔을 실행하지 못했어.')
  }

  return response.data
}

export async function getRecentFolderScanLogs(limit = 30) {
  const response = await fetchJson<ApiResponse<FolderScanLog[]>>(`/api/folders/scan-logs/recent?limit=${limit}`)
  if (!response.success) {
    throw new Error(response.error || '최근 스캔 로그를 불러오지 못했어.')
  }
  return response.data
}

export async function getWatchersHealth() {
  const response = await fetchJson<ApiResponse<WatchersHealthSummary>>('/api/folders/watchers/health')
  if (!response.success) {
    throw new Error(response.error || '워처 상태를 불러오지 못했어.')
  }
  return response.data
}

export async function startFolderWatcher(folderId: number) {
  const response = await fetchJson<ApiResponse<FolderWatcherStatus>>(`/api/folders/${folderId}/watcher/start`, {
    method: 'POST',
  })
  if (!response.success) {
    throw new Error(response.error || '워처를 시작하지 못했어.')
  }
  return response.data
}

export async function stopFolderWatcher(folderId: number) {
  const response = await fetchJson<ApiResponse<FolderWatcherStatus>>(`/api/folders/${folderId}/watcher/stop`, {
    method: 'POST',
  })
  if (!response.success) {
    throw new Error(response.error || '워처를 중지하지 못했어.')
  }
  return response.data
}

export async function restartFolderWatcher(folderId: number) {
  const response = await fetchJson<ApiResponse<FolderWatcherStatus>>(`/api/folders/${folderId}/watcher/restart`, {
    method: 'POST',
  })
  if (!response.success) {
    throw new Error(response.error || '워처를 재시작하지 못했어.')
  }
  return response.data
}

export async function getAppSettings() {
  const response = await fetchJson<ApiResponse<AppSettings>>('/api/settings')
  if (!response.success) {
    throw new Error(response.error || '설정을 불러오지 못했어.')
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

export async function getKaloscopeStatus() {
  const response = await fetchJson<ApiResponse<KaloscopeServerStatus>>('/api/settings/kaloscope/status')
  if (!response.success) {
    throw new Error(response.error || 'Kaloscope 상태를 불러오지 못했어.')
  }
  return response.data
}

export async function updateSimilaritySettings(settings: Partial<SimilaritySettings>) {
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

export async function getImageDuplicates(compositeHash: string, threshold = 5) {
  const response = await fetchJson<ApiResponse<SimilarityQueryResult>>(
    `/api/images/${compositeHash}/duplicates?threshold=${threshold}`,
  )
  if (!response.success) {
    throw new Error(response.error || '중복 이미지를 불러오지 못했어.')
  }
  return response.data
}

export async function getSimilarImages(
  compositeHash: string,
  params?: {
    threshold?: number
    limit?: number
    includeColorSimilarity?: boolean
    sortBy?: SimilaritySortBy
    sortOrder?: SimilaritySortOrder
  },
) {
  const searchParams = new URLSearchParams()
  searchParams.set('threshold', String(params?.threshold ?? 15))
  searchParams.set('limit', String(params?.limit ?? 24))
  searchParams.set('includeColorSimilarity', String(params?.includeColorSimilarity ?? false))
  searchParams.set('sortBy', params?.sortBy ?? 'similarity')
  searchParams.set('sortOrder', params?.sortOrder ?? 'DESC')

  const response = await fetchJson<ApiResponse<SimilarityQueryResult>>(
    `/api/images/${compositeHash}/similar?${searchParams.toString()}`,
  )
  if (!response.success) {
    throw new Error(response.error || '유사 이미지를 불러오지 못했어.')
  }
  return response.data
}

/** Download one or many image originals, using ZIP for multi-select. */
export async function downloadImageSelection(compositeHashes: string[]) {
  if (compositeHashes.length === 0) {
    return
  }

  if (compositeHashes.length === 1) {
    triggerBrowserDownload(buildApiUrl(`/api/images/${compositeHashes[0]}/download/original`))
    return
  }

  const response = await fetch(buildApiUrl('/api/images/download/batch'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/zip',
    },
    body: JSON.stringify({ compositeHashes }),
  })

  if (!response.ok) {
    throw new Error(`Batch download failed: ${response.status}`)
  }

  const blob = await response.blob()
  triggerBlobDownload(blob, `conai-images-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.zip`)
}
