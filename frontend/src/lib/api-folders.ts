import { createApiFallbackError } from '@/i18n/api-error-fallbacks'
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
import type { RuntimeJobRecord } from '@/types/runtime-job'

type FolderFallbackKey = Parameters<typeof createApiFallbackError>[1]

async function requestFolderData<T>(path: string, fallbackKey: FolderFallbackKey, init?: RequestInit) {
  const response = await fetchJson<ApiResponse<T>>(path, init)
  if (!response.success) {
    throw createApiFallbackError(response.error, fallbackKey)
  }

  return response.data
}

export async function getWatchedFolders(activeOnly = false) {
  const searchParams = new URLSearchParams()
  if (activeOnly) {
    searchParams.set('active_only', 'true')
  }

  return requestFolderData<WatchedFolder[]>(`/api/folders?${searchParams.toString()}`, 'folders.list.load')
}

export async function addWatchedFolder(folder: WatchedFolderInput) {
  return requestFolderData<{ id: number; folder: WatchedFolder }>('/api/folders', 'folders.create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(folder),
  })
}

export async function updateWatchedFolder(folderId: number, updates: WatchedFolderUpdateInput) {
  return requestFolderData<{ folder: WatchedFolder }>(`/api/folders/${folderId}`, 'folders.update', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  })
}

export async function deleteWatchedFolder(folderId: number, deleteFiles = false) {
  const searchParams = new URLSearchParams()
  if (deleteFiles) {
    searchParams.set('delete_files', 'true')
  }

  return requestFolderData<{ message: string }>(`/api/folders/${folderId}?${searchParams.toString()}`, 'folders.delete', { method: 'DELETE' })
}

export async function validateWatchedFolderPath(folderPath: string) {
  return requestFolderData<{ valid: boolean; message: string }>('/api/folders/validate-path', 'folders.path.validate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ folder_path: folderPath }),
  })
}

export async function scanWatchedFolder(folderId: number, full = false) {
  return requestFolderData<Record<string, unknown>>(`/api/folders/${folderId}/scan?full=${full}`, 'folders.scan.run', {
    method: 'POST',
  })
}

/**
 * Start the scan-all job.
 *
 * 202 + 잡 레코드를 돌려준다. 요약(`ScanAllSummary`)은 잡이 끝난 뒤 `result` 로 온다 —
 * 예전처럼 응답을 기다리면 폴더 몇 개만 되어도 60초 소켓 타임아웃에 걸렸다.
 */
export async function scanAllWatchedFolders() {
  return requestFolderData<RuntimeJobRecord<ScanAllSummary>>('/api/folders/scan-all', 'folders.scanAll.run', {
    method: 'POST',
  })
}

export async function getRecentFolderScanLogs(limit = 30) {
  return requestFolderData<FolderScanLog[]>(`/api/folders/scan-logs/recent?limit=${limit}`, 'folders.scanLogs.load')
}

export async function getWatchersHealth() {
  return requestFolderData<WatchersHealthSummary>('/api/folders/watchers/health', 'folders.watchersHealth.load')
}

export async function startFolderWatcher(folderId: number) {
  return requestFolderData<FolderWatcherStatus>(`/api/folders/${folderId}/watcher/start`, 'folders.watcher.start', {
    method: 'POST',
  })
}

export async function stopFolderWatcher(folderId: number) {
  return requestFolderData<FolderWatcherStatus>(`/api/folders/${folderId}/watcher/stop`, 'folders.watcher.stop', {
    method: 'POST',
  })
}

export async function restartFolderWatcher(folderId: number) {
  return requestFolderData<FolderWatcherStatus>(`/api/folders/${folderId}/watcher/restart`, 'folders.watcher.restart', {
    method: 'POST',
  })
}
