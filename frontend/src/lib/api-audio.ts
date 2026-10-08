import { requestApiData, type ApiEnvelope } from './api-request'
import { buildApiUrl } from './api-url'
import type { RuntimeJobRecord } from '@/types/runtime-job'

/** Query-key prefix of everything on the 오디오 page; queue events invalidate it (see the runtime event bridge). */
export const AUDIO_QUERY_KEY = 'audio'

export type AudioReview = 'pending' | 'selected' | 'rejected'
export type AudioCandidateOrigin = 'generated' | 'uploaded' | 'edited' | 'imported'
export type AudioGroupFilter = 'unselected' | 'has_comments' | 'pending_comments' | 'completed_comments'
export type AudioCommentStatus = 'pending' | 'completed'

export interface AudioProject {
  id: string
  name: string
  description: string
  created_by_account_id: number | null
  created_at: string
  updated_at: string
  group_count: number
  candidate_count: number
  inbox_group_id: string | null
}

export interface AudioGroup {
  id: string
  project_id: string
  name: string
  label: string | null
  description: string
  is_inbox: boolean
  created_at: string
  updated_at: string
  candidate_count: number
  selected_count: number
  pending_review_count: number
  comment_count: number
  pending_comment_count: number
  completed_comment_count: number
}

export interface AudioEditParams {
  start: number
  end: number
  gain_db: number
  pitch_semitones: number
  speed: number
  fade_in: number
  fade_out: number
}

export interface AudioCandidate {
  id: string
  group_id: string
  project_id: string
  file_hash: string
  parent_id: string | null
  origin: AudioCandidateOrigin
  name: string
  review: AudioReview
  notes: string
  edit: Partial<AudioEditParams> | null
  provenance: Record<string, unknown> | null
  order_id: string | null
  job_id: string | null
  created_by_account_id: number | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  file: { ext: string; mime_type: string; size: number; duration: number | null; sample_rate: number | null; channels: number | null; codec: string | null }
}

export interface AudioComment {
  id: string
  group_id: string
  text: string
  status: AudioCommentStatus
  revision: number
  completion_note: string
  completed_at: string | null
  author_account_id: number | null
  created_at: string
  updated_at: string
}

export type AudioOrderJobStatus = 'pending' | 'queued' | 'dispatching' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface AudioOrderJob {
  idx: number
  seed: number
  attempt: number
  job_id: number | null
  status: AudioOrderJobStatus
  failure_message: string | null
  candidate_ids: string[]
}

export interface AudioOrder {
  id: string
  request_key: string
  group_id: string
  workflow_id: number
  text: string
  seconds: number
  count: number
  base_seed: number
  server_id: number | null
  server_tag: string | null
  created_at: string
  status: 'active' | 'completed' | 'partial' | 'failed' | 'cancelled'
  counts: Partial<Record<AudioOrderJobStatus, number>>
  jobs: AudioOrderJob[]
  job_ids: number[]
  audio_candidate_ids: string[]
}

export interface AudioServerCompat {
  server_id: number
  server_name: string
  status: 'ok' | 'incompatible' | 'unreachable'
  issues: string[]
  seconds_max: number | null
  seed_max: number | null
}

export interface AudioWorkflowCompat {
  checked_at: string
  ok: boolean
  servers: AudioServerCompat[]
  seconds_max: number | null
  seed_max: number | null
  issues: string[]
}

export interface AudioWorkflowBinding {
  workflow_id: number
  prompt_field_id: string
  seconds_field_id: string
  seed_field_id: string
  is_default: boolean
  compat: AudioWorkflowCompat | null
  compat_checked_at: string | null
  updated_at: string
}

export type AudioWorkflowRole = 'prompt' | 'seconds' | 'seed'

export interface AudioWorkflowSummary {
  id: number
  name: string
  description: string | null
  is_active: boolean
  updated_date: string
  fields: Array<{ id: string; label: string; type: string; json_path: string; node_class_type: string | null }>
  binding: AudioWorkflowBinding | null
  suggested: Partial<Record<AudioWorkflowRole, string>>
}

export interface AudioExportOptions {
  format: 'wav' | 'ogg'
  quality: number
  normalize: boolean
  target_lufs: number
  peak_db: number
  loudness_range: number
  sample_rate: number
  channels: number
}

export interface AudioExportResult {
  export_id: string
  file_name: string
  mime_type: string
  count: number
  size_bytes: number
  download_path: string
  files: number
}

const json = { 'Content-Type': 'application/json' }
const enc = encodeURIComponent
const body = (value: unknown, method = 'POST'): RequestInit => ({ method, headers: json, body: JSON.stringify(value) })

/* projects / groups */
export const listAudioProjects = () => requestApiData<AudioProject[]>('/api/audio/projects')
export const createAudioProject = (input: { name: string; description?: string }) => requestApiData<AudioProject>('/api/audio/projects', body(input))
export const updateAudioProject = (id: string, input: { name?: string; description?: string }) => requestApiData<AudioProject>(`/api/audio/projects/${enc(id)}`, body(input, 'PATCH'))
export const deleteAudioProject = (id: string) => requestApiData<unknown>(`/api/audio/projects/${enc(id)}`, { method: 'DELETE' })
export const listAudioGroups = (projectId: string, options: { search?: string; filter?: AudioGroupFilter | null } = {}) => {
  const params = new URLSearchParams()
  if (options.search?.trim()) params.set('search', options.search.trim())
  if (options.filter) params.set('filter', options.filter)
  const query = params.toString()
  return requestApiData<AudioGroup[]>(`/api/audio/projects/${enc(projectId)}/groups${query ? `?${query}` : ''}`)
}
export const getAudioGroup = (id: string) => requestApiData<AudioGroup>(`/api/audio/groups/${enc(id)}`)
export const createAudioGroup = (projectId: string, input: { name: string; label: string; description?: string }) => requestApiData<AudioGroup>(`/api/audio/projects/${enc(projectId)}/groups`, body(input))
export const updateAudioGroup = (id: string, input: { name?: string; label?: string; description?: string }) => requestApiData<AudioGroup>(`/api/audio/groups/${enc(id)}`, body(input, 'PATCH'))
export const deleteAudioGroup = (id: string) => requestApiData<unknown>(`/api/audio/groups/${enc(id)}`, { method: 'DELETE' })

/* candidates */
export interface AudioCandidatePage { items: AudioCandidate[]; total: number; limit: number; offset: number }
export const listAudioCandidates = (groupId: string, options: { review?: AudioReview | null; limit?: number; offset?: number } = {}) => {
  const params = new URLSearchParams({ limit: String(options.limit ?? 200), offset: String(options.offset ?? 0) })
  if (options.review) params.set('review', options.review)
  return requestApiData<AudioCandidatePage>(`/api/audio/groups/${enc(groupId)}/candidates?${params}`)
}
export const getAudioCandidate = (id: string) => requestApiData<AudioCandidate>(`/api/audio/candidates/${enc(id)}`)
export const audioCandidateFileUrl = (id: string, download = false) => buildApiUrl(`/api/audio/candidates/${enc(id)}/file${download ? '?download=1' : ''}`)
export const setAudioReview = (id: string, input: { review?: AudioReview; notes?: string }) => requestApiData<AudioCandidate>(`/api/audio/candidates/${enc(id)}/review`, body(input, 'PATCH'))
export const moveAudioCandidates = (ids: string[], groupId: string) => requestApiData<unknown>('/api/audio/candidates/move', body({ ids, groupId }))
export const restoreAudioCandidates = (ids: string[]) => requestApiData<unknown>('/api/audio/candidates/restore', body({ ids }))
export const audioDeletionPlan = (groupId: string, scope: 'all' | 'unselected', candidateId?: string) =>
  requestApiData<{ candidate_ids: string[]; count: number; selected_count: number }>(`/api/audio/groups/${enc(groupId)}/candidates/deletion?scope=${scope}${candidateId ? `&candidate_id=${enc(candidateId)}` : ''}`)
export const deleteAudioGroupCandidates = (groupId: string, candidateIds: string[], includeSelected: boolean) =>
  requestApiData<{ deleted: number }>(`/api/audio/groups/${enc(groupId)}/candidates/delete`, body({ candidate_ids: candidateIds, include_selected: includeSelected }))

/** Upload into a group (or a project's inbox). Partial failures come back in `failed`. */
export async function uploadAudioFiles(target: { groupId: string } | { projectId: string }, files: File[]) {
  const form = new FormData()
  for (const file of files) form.append('files', file)
  const query = 'groupId' in target ? `groupId=${enc(target.groupId)}` : `projectId=${enc(target.projectId)}`
  const response = await fetch(buildApiUrl(`/api/audio/upload?${query}`), { method: 'POST', body: form, credentials: 'include', headers: { Accept: 'application/json' } })
  const payload = await response.json().catch(() => null) as ApiEnvelope<{ created: AudioCandidate[]; failed: Array<{ name: string; error: string }> }> | null
  if (payload?.data && Array.isArray(payload.data.created)) return payload.data
  throw new Error(payload?.error || `Upload failed: ${response.status}`)
}
export const importAudioFromFileStore = (fileId: string, target: { groupId: string } | { projectId: string }) => requestApiData<AudioCandidate>('/api/audio/import-file', body({ fileId, ...target }))

/* comments */
export const listAudioComments = (groupId: string, status?: AudioCommentStatus | null, offset = 0, limit = 20) =>
  requestApiData<AudioComment[]>(`/api/audio/groups/${enc(groupId)}/comments?limit=${limit}&offset=${offset}${status ? `&status=${status}` : ''}`)
export const createAudioComment = (groupId: string, text: string) => requestApiData<AudioComment>(`/api/audio/groups/${enc(groupId)}/comments`, body({ text }))
export const updateAudioComment = (groupId: string, commentId: string, text: string) => requestApiData<AudioComment>(`/api/audio/groups/${enc(groupId)}/comments/${enc(commentId)}`, body({ text }, 'PATCH'))
export const deleteAudioComment = (groupId: string, commentId: string) => requestApiData<unknown>(`/api/audio/groups/${enc(groupId)}/comments/${enc(commentId)}`, { method: 'DELETE' })
export const setAudioCommentStatus = (groupId: string, comment: AudioComment, status: AudioCommentStatus) =>
  requestApiData<AudioComment>(`/api/audio/groups/${enc(groupId)}/comments/${enc(comment.id)}/status`, body({ status, expected_revision: comment.revision }, 'PATCH'))

/* generation */
export const listAudioWorkflows = () => requestApiData<AudioWorkflowSummary[]>('/api/audio/workflows')
export const saveAudioWorkflowBinding = (workflowId: number, input: { prompt_field_id: string; seconds_field_id: string; seed_field_id: string; is_default: boolean }) =>
  requestApiData<AudioWorkflowBinding>(`/api/audio/workflows/${workflowId}/binding`, body(input, 'PUT'), { timeoutMs: 60_000 })
export const checkAudioWorkflow = (workflowId: number) => requestApiData<AudioWorkflowCompat>(`/api/audio/workflows/${workflowId}/check`, { method: 'POST' }, { timeoutMs: 60_000 })
export const addDefaultAudioWorkflow = () => requestApiData<unknown>('/api/audio/workflows/default', { method: 'POST' }, { timeoutMs: 60_000 })
export interface AudioOrderInput { group_id: string; text: string; seconds: number; count: number; seed?: number | null; workflow_id?: number; request_key: string; server_id?: number | null; server_tag?: string | null }
export const createAudioOrder = (input: AudioOrderInput) => requestApiData<AudioOrder>('/api/audio/orders', body(input), { timeoutMs: 60_000 })
export const listAudioOrders = (groupId: string) => requestApiData<{ items: AudioOrder[]; total: number }>(`/api/audio/orders?group_id=${enc(groupId)}&limit=20`)
export const cancelAudioOrder = (orderId: string) => requestApiData<AudioOrder>(`/api/audio/orders/${enc(orderId)}/cancel`, { method: 'POST' })
export const retryAudioOrderJob = (orderId: string, idx: number) => requestApiData<AudioOrder>(`/api/audio/orders/${enc(orderId)}/jobs/${idx}/retry`, { method: 'POST' })

/* editing */
export async function previewAudioEdit(candidateId: string, params: AudioEditParams, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(buildApiUrl(`/api/audio/candidates/${enc(candidateId)}/preview`), { method: 'POST', headers: json, body: JSON.stringify(params), credentials: 'include', signal })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error || `Preview failed: ${response.status}`)
  }
  return await response.blob()
}
export const saveAudioEdit = (candidateId: string, params: AudioEditParams, requestKey: string) =>
  requestApiData<AudioCandidate>(`/api/audio/candidates/${enc(candidateId)}/edit`, body({ ...params, request_key: requestKey }), { timeoutMs: 120_000 })

/* export */
export const getAudioExportSettings = () => requestApiData<AudioExportOptions>('/api/audio/settings/export')
export const saveAudioExportSettings = (options: AudioExportOptions) => requestApiData<AudioExportOptions>('/api/audio/settings/export', body(options, 'PUT'))
export const audioCandidateExportUrl = (candidateId: string) => buildApiUrl(`/api/audio/candidates/${enc(candidateId)}/export`)
export const audioExportDownloadUrl = (exportId: string) => buildApiUrl(`/api/audio/exports/${enc(exportId)}/download`)

export type AudioExportStart = { kind: 'file'; blob: Blob; fileName: string } | { kind: 'job'; job: RuntimeJobRecord; count: number }

/** Group or project export: small sets come back as the file (or a ZIP), large ones as an 'audio-export' job. */
export async function startAudioExport(scope: { groupId: string } | { projectId: string }): Promise<AudioExportStart> {
  const path = 'groupId' in scope ? `/api/audio/groups/${enc(scope.groupId)}/export` : `/api/audio/projects/${enc(scope.projectId)}/export`
  const response = await fetch(buildApiUrl(path), { credentials: 'include' })
  const type = response.headers.get('content-type') ?? ''
  if (!response.ok) {
    const payload = type.includes('json') ? await response.json().catch(() => null) as { error?: string } | null : null
    throw new Error(payload?.error || `Export failed: ${response.status}`)
  }
  if (response.status === 202 && type.includes('json')) {
    const payload = await response.json() as ApiEnvelope<{ job: RuntimeJobRecord; count: number }>
    return { kind: 'job', job: payload.data.job, count: payload.data.count }
  }
  const disposition = response.headers.get('content-disposition') ?? ''
  const fileName = decodeURIComponent(/filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] ?? 'audio-export')
  return { kind: 'file', blob: await response.blob(), fileName }
}

/** Fetch a URL that answers with an attachment and hand it to the browser as a download. */
export async function downloadAttachment(url: string, fallbackName: string) {
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error || `Download failed: ${response.status}`)
  }
  const disposition = response.headers.get('content-disposition') ?? ''
  const fileName = decodeURIComponent(/filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] ?? fallbackName)
  saveBlob(await response.blob(), fileName)
}

export function saveBlob(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
}
