import { createApiFallbackError } from '@/i18n/api-error-fallbacks'
import { fetchJson } from '@/lib/api-client'
import type { ApiResponse } from '@/types/image'
import type { BackupSource, BackupSourceInput, BackupSourceUpdateInput } from '@/types/folder'

async function requestBackupSourceData<T>(path: string, fallbackKey: Parameters<typeof createApiFallbackError>[1], init?: RequestInit) {
  const response = await fetchJson<ApiResponse<T>>(path, init)
  if (!response.success) {
    throw createApiFallbackError(response.error, fallbackKey)
  }
  return response.data
}

export async function getBackupSources(activeOnly = false) {
  const searchParams = new URLSearchParams()
  if (activeOnly) {
    searchParams.set('active_only', 'true')
  }

  return requestBackupSourceData<BackupSource[]>(`/api/backup-sources?${searchParams.toString()}`, 'backupSources.list.load')
}

export async function addBackupSource(input: BackupSourceInput) {
  return requestBackupSourceData<{ id: number; source: BackupSource }>('/api/backup-sources', 'backupSources.create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

export async function updateBackupSource(sourceId: number, updates: BackupSourceUpdateInput) {
  return requestBackupSourceData<{ source: BackupSource }>(`/api/backup-sources/${sourceId}`, 'backupSources.update', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  })
}

export async function deleteBackupSource(sourceId: number) {
  return requestBackupSourceData<{ message: string }>(`/api/backup-sources/${sourceId}`, 'backupSources.delete', {
    method: 'DELETE',
  })
}

export async function validateBackupSourcePath(sourcePath: string) {
  return requestBackupSourceData<{ valid: boolean; message: string }>('/api/backup-sources/validate-path', 'backupSources.path.validate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ source_path: sourcePath }),
  })
}

export async function startBackupSourceWatcher(sourceId: number) {
  return requestBackupSourceData<BackupSource>(`/api/backup-sources/${sourceId}/watcher/start`, 'backupSources.watcher.start', {
    method: 'POST',
  })
}

export async function stopBackupSourceWatcher(sourceId: number) {
  return requestBackupSourceData<BackupSource>(`/api/backup-sources/${sourceId}/watcher/stop`, 'backupSources.watcher.stop', {
    method: 'POST',
  })
}

export async function restartBackupSourceWatcher(sourceId: number) {
  return requestBackupSourceData<BackupSource>(`/api/backup-sources/${sourceId}/watcher/restart`, 'backupSources.watcher.restart', {
    method: 'POST',
  })
}
