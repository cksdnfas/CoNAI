import { requestApiData } from './api-request'
import type { RuntimeJobRecord } from '@/types/runtime-job'

/** Admin: import the old standalone SFX manager's data (`/api/audio/legacy-import`). */

export interface LegacyAudioWorkflow {
  legacy_id: string
  name: string
  version: number
  deleted: boolean
  node_count: number
  mapping: Record<string, unknown>
  registered_workflow_id: number | null
}

export interface LegacyAudioImportResult {
  dry_run: boolean
  source: { kind: 'path' | 'upload'; label: string }
  projects: { total: number; created: number; existing: number }
  groups: { total: number; created: number; existing: number; failed: number }
  candidates: { total: number; imported: number; already_imported: number; soft_deleted: number; missing_file: number; deleted_without_file: number; failed: number }
  files: { new: number; reused: number; bytes: number }
  comments: { total: number; imported: number; already_imported: number }
  workflows: LegacyAudioWorkflow[]
  export_options: 'imported' | 'kept' | 'none'
  warnings: string[]
}

export type LegacyAudioImportSource = { path: string } | { upload_id: string }

const headers = { 'Content-Type': 'application/json' }

export const LEGACY_AUDIO_WORKFLOWS_QUERY_KEY = ['audio', 'legacy-import', 'workflows'] as const

export const uploadLegacyAudioArchive = (file: File) => {
  const form = new FormData()
  form.append('archive', file, file.name)
  return requestApiData<{ upload_id: string; size: number }>('/api/audio/legacy-import/uploads', { method: 'POST', body: form })
}

export const startLegacyAudioImport = (source: LegacyAudioImportSource, dryRun: boolean) =>
  requestApiData<RuntimeJobRecord<LegacyAudioImportResult>>('/api/audio/legacy-import', { method: 'POST', headers, body: JSON.stringify({ ...source, dryRun }) })

export const listLegacyAudioWorkflows = () => requestApiData<LegacyAudioWorkflow[]>('/api/audio/legacy-import/workflows')

export const registerLegacyAudioWorkflow = (legacyWorkflowId: string) =>
  requestApiData<{ id: number; name: string }>('/api/audio/legacy-import/workflows/register', { method: 'POST', headers, body: JSON.stringify({ legacy_workflow_id: legacyWorkflowId }) })
