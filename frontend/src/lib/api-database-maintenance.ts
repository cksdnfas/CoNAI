import { requestApiData } from './api-request'
import { buildApiUrl } from './api-url'
import type { RuntimeJobRecord } from '@/types/runtime-job'

/** Admin database maintenance: sizes, online backups, orphan cleanup and compaction (`/api/system`). */

export interface DatabaseFileStats {
  fileName: string
  fileBytes: number
  walBytes: number
  pageSize: number
  pageCount: number
  databaseBytes: number
  freelistPages: number
  reclaimableBytes: number
}

export interface DatabaseBackupEntry {
  name: string
  createdAt: string
  totalBytes: number
  files: Array<{ fileName: string; bytes: number }>
}

export interface DatabaseBackupResult {
  name: string
  files: Array<{ fileName: string; bytes: number; totalPages: number }>
  removed: string[]
  durationMs: number
}

export interface MediaOrphanCleanupResult {
  dryRun: boolean
  missingFiles: { matched: number; deleted: number }
  orphanMetadata: { scanned: number; candidates: number; keptReferenced: number; deleted: number; thumbnailsDeleted: number }
  orphanThumbnails: { scanned: number; orphaned: number; deleted: number; bytes: number; emptyDirsRemoved: number }
  tempLeftovers: { graphExecutionDirs: number; incomingEntries: number; videoFrames: number; bytes: number }
  durationMs: number
}

export interface DatabaseCompactionResult {
  bytesBefore: number
  bytesAfter: number
  freePagesBefore: number
  durationMs: number
}

const headers = { 'Content-Type': 'application/json' }

export const DATABASE_STATS_QUERY_KEY = ['system', 'database-stats'] as const
export const DATABASE_BACKUPS_QUERY_KEY = ['system', 'database-backups'] as const

export const getDatabaseStats = () => requestApiData<{ databases: DatabaseFileStats[] }>('/api/system/database-stats')
export const listDatabaseBackups = () => requestApiData<{ keep: number; backups: DatabaseBackupEntry[] }>('/api/system/database-backups')
export const startDatabaseBackup = () =>
  requestApiData<RuntimeJobRecord<DatabaseBackupResult>>('/api/system/database-backups', { method: 'POST', headers, body: '{}' })
export const deleteDatabaseBackup = (name: string) =>
  requestApiData<{ deleted: string }>(`/api/system/database-backups/${encodeURIComponent(name)}`, { method: 'DELETE' })
export const databaseBackupDownloadUrl = (name: string) => buildApiUrl(`/api/system/database-backups/${encodeURIComponent(name)}/download`)
export const startOrphanCleanup = (dryRun: boolean) =>
  requestApiData<RuntimeJobRecord<MediaOrphanCleanupResult>>('/api/system/maintenance/orphan-cleanup', { method: 'POST', headers, body: JSON.stringify({ dryRun }) })
export const startDatabaseCompaction = () =>
  requestApiData<RuntimeJobRecord<DatabaseCompactionResult>>('/api/system/maintenance/compact-database', { method: 'POST', headers, body: '{}' })
