import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import {
  REFMOD_ENTRY_FILE_REF_KIND,
  type RefModAdoptResult,
  type RefModEntryBulkResult,
  type RefModEntryDetail,
  type RefModEntryFileRef,
  type RefModEntryPage,
  type RefModImportResult,
  type RefModPresence,
  type RefModUnregisteredRecord,
  type RefModWorkflowCandidate,
} from '@conai/shared'
import { triggerBlobDownload } from '@/lib/api-client'
import type { GenerationQueueJobRecord } from '@/lib/api-image-generation-types'
import { ApiRequestError, requestApiData } from '@/lib/api-request'
import { buildApiUrl } from '@/lib/api-url'
import { readDownloadBlob } from '@/lib/download-utils'
import { withPublicWorkflowScope } from '@/lib/public-workflow-scope'

export type {
  RefModAdoptResult,
  RefModEntryDetail,
  RefModEntryFileRef,
  RefModEntryForm,
  RefModEntryMember,
  RefModEntryPage,
  RefModEntryRun,
  RefModEntrySummary,
  RefModImportResult,
  RefModPresence,
  RefModUnregisteredRecord,
  RefModWorkflowCandidate,
  RefModWorkflowIssue,
  RefModWorkflowIssueCode,
  RefModWorkflowRoles,
} from '@conai/shared'

const BASE = '/api/refmod-entries'
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export type RefModEntrySort = 'name' | 'updated' | 'created' | 'built'
export const REFMOD_ENTRY_SORTS: readonly RefModEntrySort[] = ['updated', 'name', 'created', 'built']

/** A list scope: every query term must match (name, description, keywords, member descriptions); one concept; one order. */
export type RefModEntryScope = {
  query: string
  concept: string
  favorite: boolean
  sort: RefModEntrySort
  limit: number
}
export const REFMOD_ENTRIES_PAGE_SIZE = 50

export const REFMOD_ENTRIES_QUERY_KEY = 'refmod-entries'
/** The scrolled list: every loaded batch of one scope. */
export const refModEntryPagesQueryKey = (scope: RefModEntryScope) => [REFMOD_ENTRIES_QUERY_KEY, 'list', scope.query, scope.concept, scope.favorite ? 1 : 0, scope.sort, scope.limit] as const
export const refModEntryQueryKey = (entryId: number) => [REFMOD_ENTRIES_QUERY_KEY, 'entry', entryId] as const
export const refModPresenceQueryKey = [REFMOD_ENTRIES_QUERY_KEY, 'presence'] as const
export const refModUnregisteredQueryKey = [REFMOD_ENTRIES_QUERY_KEY, 'unregistered'] as const
export const refModWorkflowsQueryKey = [REFMOD_ENTRIES_QUERY_KEY, 'workflows'] as const
/** Every entry name (paged through in large batches), to tell server-only library names from entries not loaded yet. */
export const refModEntryNamesQueryKey = [REFMOD_ENTRIES_QUERY_KEY, 'names'] as const

/**
 * The listed entries. The only RefMod entry read a generation-only account or a published-workflow page may make (the
 * Director's picker), so it carries the page's public scope.
 */
export function listRefModEntries(scope: RefModEntryScope & { offset: number }, signal?: AbortSignal) {
  const params = new URLSearchParams()
  if (scope.query) params.set('query', scope.query)
  if (scope.concept) params.set('concept', scope.concept)
  if (scope.favorite) params.set('favorite', '1')
  params.set('sort', scope.sort)
  params.set('limit', String(scope.limit))
  params.set('offset', String(scope.offset))
  return requestApiData<RefModEntryPage>(withPublicWorkflowScope(BASE, params), { signal })
}
/** The names of every entry, read in batches of 200 (bounded at 4,000). */
export async function listRefModEntryNames(signal?: AbortSignal) {
  const names: string[] = []
  for (let offset = 0; offset < 4000;) {
    const page = await listRefModEntries({ query: '', concept: '', favorite: false, sort: 'name', limit: 200, offset }, signal)
    names.push(...page.items.map((item) => item.name))
    if (!page.hasMore || !page.items.length) break
    offset += page.items.length
  }
  return names
}
export function getRefModEntry(entryId: number, signal?: AbortSignal) {
  return requestApiData<RefModEntryDetail>(`${BASE}/${entryId}`, { signal, cache: 'no-store' })
}
/** Saved run records whose name no entry has (latest per name). */
export function listUnregisteredRefMods(signal?: AbortSignal) {
  return requestApiData<RefModUnregisteredRecord[]>(`${BASE}/unregistered`, { signal })
}
/** The default server's RefMod library, read live (may take a while when the server is slow). */
export function getRefModPresence(signal?: AbortSignal) {
  return requestApiData<RefModPresence>(`${BASE}/presence`, { signal }, { timeoutMs: 60_000 })
}
/** Active workflows with a RefMod export node, each with its roles and issues. */
export function listRefModWorkflows(signal?: AbortSignal) {
  return requestApiData<RefModWorkflowCandidate[]>(`${BASE}/workflows`, { signal })
}

export type RefModEntryCreateInput = { name: string; workflowId?: number | null; duplicateOf?: number }
/** Refused with 409 `name_conflict` when the name is taken. `duplicateOf` copies another entry (its sources are copied). */
export function createRefModEntry(input: RefModEntryCreateInput) {
  return requestApiData<RefModEntryDetail>(BASE, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }, { timeoutMs: 120_000 })
}

export type RefModEntryPatch = {
  revision: number
  name?: string
  conceptType?: string
  description?: string
  keywords?: string[]
  favorite?: boolean
  workflowId?: number | null
  /** The linked workflow's whole form keyed by field id; the server splits it by roles and stores the sources. */
  values?: Record<string, unknown>
}
/** 409 `revision_conflict` when `revision` is stale, `name_conflict` when the name is taken. Sources are copied on save. */
export function patchRefModEntry(entryId: number, patch: RefModEntryPatch) {
  return requestApiData<RefModEntryDetail>(`${BASE}/${entryId}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }, { timeoutMs: 300_000 })
}
/** The entry, its sources and its run records; the ComfyUI bundle is untouched. */
export function deleteRefModEntry(entryId: number, revision?: number) {
  return requestApiData<{ deleted: boolean }>(`${BASE}/${entryId}${revision === undefined ? '' : `?revision=${revision}`}`, { method: 'DELETE' })
}
export type RefModEntryBulkInput = { ids: number[]; action: 'favorite' | 'delete'; favorite?: boolean }
export function bulkRefModEntries(input: RefModEntryBulkInput) {
  return requestApiData<RefModEntryBulkResult>(`${BASE}/bulk`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}
/** Entries from unregistered records (sources copied) and server-only names (exactly as the server lists them). */
export function adoptRefMods(input: { recordIds?: number[]; names?: string[] }) {
  return requestApiData<RefModAdoptResult>(`${BASE}/adopt`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }, { timeoutMs: 300_000 })
}
/** Queue a build on the default server; 409 with `code` (blocked, no_default_server, server_not_linked, pending…) when it cannot. */
export function buildRefModEntry(entryId: number) {
  return requestApiData<{ jobId: number; serverId: number }>(`${BASE}/${entryId}/build`, { method: 'POST' }, { timeoutMs: 300_000 })
}
/** One queue job's current state (it leaves the active list once it ends). */
export function getRefModBuildJob(jobId: number) {
  return requestApiData<GenerationQueueJobRecord>(`/api/generation-queue/${jobId}`, { cache: 'no-store' })
}

/** Export a bundle (`{}`: every entry) and save it as `<name>.refmods.zip`; returns the entry count. */
export async function downloadRefModExport(input: { ids?: number[] }, name: string) {
  const response = await fetch(buildApiUrl(`${BASE}/export`), { method: 'POST', credentials: 'include', headers: JSON_HEADERS, body: JSON.stringify(input) })
  const blob = await readDownloadBlob(response)
  const safeName = name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'refmods'
  triggerBlobDownload(blob, `${safeName}.refmods.zip`)
  return Number(response.headers.get('X-RefMod-Count') ?? 0)
}
export type RefModImportConflict = 'skip' | 'overwrite'
export function importRefModBundle(file: File, conflict: RefModImportConflict) {
  const form = new FormData()
  form.append('file', file, file.name)
  return requestApiData<RefModImportResult>(`${BASE}/import?conflict=${conflict}`, { method: 'POST', body: form }, { timeoutMs: 600_000 })
}

/** One of an entry's own source copies (images.view). */
export function refModEntryFileUrl(entryId: number, fileId: string) {
  return buildApiUrl(`${BASE}/${entryId}/files/${encodeURIComponent(fileId)}`)
}
/** A WebP thumbnail of an entry's image or video source (images.view). */
export function refModEntryThumbnailUrl(entryId: number, fileId: string) {
  return buildApiUrl(`${BASE}/${entryId}/files/${encodeURIComponent(fileId)}/thumbnail`)
}
/** The asset reference an entry's Director value uses for its own source copies (never part of a run). */
export function isRefModEntryFileRef(value: unknown): value is RefModEntryFileRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const ref = value as Record<string, unknown>
  return ref.__ref === REFMOD_ENTRY_FILE_REF_KIND && typeof ref.id === 'string' && Number.isSafeInteger(Number(ref.entryId)) && typeof ref.fileName === 'string'
}

export function isRefModRevisionConflict(error: unknown) {
  return error instanceof ApiRequestError && error.status === 409 && error.code === 'revision_conflict'
}
export function isRefModNameConflict(error: unknown) {
  return error instanceof ApiRequestError && error.status === 409 && error.code === 'name_conflict'
}

/**
 * After a change: refetch the active lists (and the unregistered rows), and the changed entries. A list refetches when
 * it holds one of them, or whenever the set may have changed (`listsChanged`: create, delete, import, adopt).
 */
export function invalidateRefModEntries(queryClient: QueryClient, change: { entryIds: number[]; listsChanged?: boolean }) {
  const ids = new Set(change.entryIds)
  return queryClient.invalidateQueries({
    queryKey: [REFMOD_ENTRIES_QUERY_KEY],
    refetchType: 'active',
    predicate: ({ queryKey, state }) => {
      if (queryKey[1] === 'entry') return ids.has(Number(queryKey[2]))
      if (queryKey[1] === 'unregistered' || queryKey[1] === 'names') return Boolean(change.listsChanged)
      if (queryKey[1] !== 'list') return false
      if (change.listsChanged) return true
      const data = state.data as InfiniteData<RefModEntryPage> | undefined
      return Boolean(data?.pages.some((page) => page.items.some((item) => ids.has(item.id))))
    },
  })
}
