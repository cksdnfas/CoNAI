import { fetchJson } from '@/lib/api-client'
import type { ApiResponse } from '@/types/image'
import type {
  FolderScanLog,
  FolderWatcherStatus,
  ScanAllSummary,
  WatchedFolder,
  WatchedFolderInput,
  WatchedFolderUpdateInput,
  WatchersHealthSummary,
} from '@/types/folder'

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

  const response = await fetchJson<ApiResponse<{ message: string }>>(`/api/folders/${folderId}?${searchParams.toString()}`, { method: 'DELETE' })

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
