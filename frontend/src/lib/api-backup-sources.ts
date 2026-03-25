import { fetchJson } from '@/lib/api-client'
import type { ApiResponse } from '@/types/image'
import type { BackupSource, BackupSourceInput, BackupSourceUpdateInput } from '@/types/folder'

export async function getBackupSources(activeOnly = false) {
  const searchParams = new URLSearchParams()
  if (activeOnly) {
    searchParams.set('active_only', 'true')
  }

  const response = await fetchJson<ApiResponse<BackupSource[]>>(`/api/backup-sources?${searchParams.toString()}`)
  if (!response.success) {
    throw new Error(response.error || '백업 소스를 불러오지 못했어.')
  }
  return response.data
}

export async function addBackupSource(input: BackupSourceInput) {
  const response = await fetchJson<ApiResponse<{ id: number; source: BackupSource }>>('/api/backup-sources', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.success) {
    throw new Error(response.error || '백업 소스를 추가하지 못했어.')
  }

  return response.data
}

export async function updateBackupSource(sourceId: number, updates: BackupSourceUpdateInput) {
  const response = await fetchJson<ApiResponse<{ source: BackupSource }>>(`/api/backup-sources/${sourceId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  })

  if (!response.success) {
    throw new Error(response.error || '백업 소스를 저장하지 못했어.')
  }

  return response.data
}

export async function deleteBackupSource(sourceId: number) {
  const response = await fetchJson<ApiResponse<{ message: string }>>(`/api/backup-sources/${sourceId}`, {
    method: 'DELETE',
  })

  if (!response.success) {
    throw new Error(response.error || '백업 소스를 삭제하지 못했어.')
  }

  return response.data
}

export async function validateBackupSourcePath(sourcePath: string) {
  const response = await fetchJson<ApiResponse<{ valid: boolean; message: string }>>('/api/backup-sources/validate-path', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ source_path: sourcePath }),
  })

  if (!response.success) {
    throw new Error(response.error || '백업 source 경로를 검증하지 못했어.')
  }

  return response.data
}

export async function startBackupSourceWatcher(sourceId: number) {
  const response = await fetchJson<ApiResponse<BackupSource>>(`/api/backup-sources/${sourceId}/watcher/start`, {
    method: 'POST',
  })

  if (!response.success) {
    throw new Error(response.error || '백업 source watcher를 시작하지 못했어.')
  }

  return response.data
}

export async function stopBackupSourceWatcher(sourceId: number) {
  const response = await fetchJson<ApiResponse<BackupSource>>(`/api/backup-sources/${sourceId}/watcher/stop`, {
    method: 'POST',
  })

  if (!response.success) {
    throw new Error(response.error || '백업 source watcher를 중지하지 못했어.')
  }

  return response.data
}

export async function restartBackupSourceWatcher(sourceId: number) {
  const response = await fetchJson<ApiResponse<BackupSource>>(`/api/backup-sources/${sourceId}/watcher/restart`, {
    method: 'POST',
  })

  if (!response.success) {
    throw new Error(response.error || '백업 source watcher를 재시작하지 못했어.')
  }

  return response.data
}
