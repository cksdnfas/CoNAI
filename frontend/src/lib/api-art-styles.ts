import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type {
  ArtStyle,
  ArtStyleBadgeCount,
  ArtStyleBulkInput,
  ArtStyleBulkResult,
  ArtStyleCreateInput,
  ArtStyleExportInput,
  ArtStyleImportResult,
  ArtStylePage,
  ArtStylePatch,
  ArtStyleSort,
} from '@conai/shared'
import { triggerBlobDownload } from '@/lib/api-client'
import { ApiRequestError, requestApiData } from '@/lib/api-request'
import { buildApiUrl } from '@/lib/api-url'
import { readDownloadBlob } from '@/lib/download-utils'

export type { ArtStyle, ArtStyleBadgeCount, ArtStyleCreateInput, ArtStyleImage, ArtStyleImageInput, ArtStyleImportResult, ArtStylePage, ArtStylePatch, ArtStyleSort, ArtStyleSummary } from '@conai/shared'

const BASE = '/api/art-styles'
const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** A list scope: every query term and every badge must match; favorites narrow it; one order. */
export type ArtStyleScope = {
  query: string
  badges: string[]
  favorite: boolean
  sort: ArtStyleSort
  limit: number
}
export const ART_STYLES_PAGE_SIZE = 60

export const ART_STYLES_QUERY_KEY = 'art-styles'
const badgesKey = (badges: string[]) => (badges.length ? JSON.stringify(badges) : '')
/** The scrolled list: every loaded batch of one scope. */
export const artStylePagesQueryKey = (scope: ArtStyleScope) => [ART_STYLES_QUERY_KEY, 'list', scope.query, badgesKey(scope.badges), scope.favorite ? 1 : 0, scope.sort, scope.limit] as const
/** Badge counts of a scope (its badge filter does not apply). */
export const artStyleBadgesQueryKey = (scope: Pick<ArtStyleScope, 'query' | 'favorite'>) => [ART_STYLES_QUERY_KEY, 'badges', scope.query, scope.favorite ? 1 : 0] as const
export const artStyleQueryKey = (styleId: number) => [ART_STYLES_QUERY_KEY, 'style', styleId] as const

function scopeParams(scope: Pick<ArtStyleScope, 'query' | 'favorite'> & { badges?: string[] }) {
  const params = new URLSearchParams()
  if (scope.query) params.set('query', scope.query)
  if (scope.favorite) params.set('favorite', '1')
  if (scope.badges?.length) params.set('badges', JSON.stringify(scope.badges))
  return params
}
export function listArtStyles(scope: ArtStyleScope & { offset: number }, signal?: AbortSignal) {
  const params = scopeParams(scope)
  if (scope.sort !== 'name') params.set('sort', scope.sort)
  params.set('limit', String(scope.limit))
  params.set('offset', String(scope.offset))
  return requestApiData<ArtStylePage>(`${BASE}?${params.toString()}`, { signal })
}
export function listArtStyleBadges(scope: Pick<ArtStyleScope, 'query' | 'favorite'>, signal?: AbortSignal) {
  return requestApiData<ArtStyleBadgeCount[]>(`${BASE}/badges?${scopeParams(scope).toString()}`, { signal })
}
export function getArtStyle(styleId: number, signal?: AbortSignal) {
  return requestApiData<ArtStyle>(`${BASE}/${styleId}`, { signal, cache: 'no-store' })
}
/** Refused with 409 `name_conflict` when the title is taken. */
export function createArtStyle(input: ArtStyleCreateInput) {
  return requestApiData<ArtStyle>(BASE, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}
/** Only the given fields change; 409 `revision_conflict` when `revision` is stale, `name_conflict` when the title is taken. */
export function updateArtStyle(styleId: number, patch: ArtStylePatch) {
  return requestApiData<ArtStyle>(`${BASE}/${styleId}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}
/** With `revision`, refused with 409 when the style changed since it was read. Its image copies are deleted with it. */
export function deleteArtStyle(styleId: number, revision?: number) {
  return requestApiData<{ deleted: number }>(`${BASE}/${styleId}${revision === undefined ? '' : `?revision=${revision}`}`, { method: 'DELETE' })
}
export function bulkArtStyles(input: ArtStyleBulkInput) {
  return requestApiData<ArtStyleBulkResult>(`${BASE}/bulk`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}
/** One of a style's own image copies (the read right). */
export function artStyleImageUrl(styleId: number, fileId: string) {
  return buildApiUrl(`${BASE}/${styleId}/files/${encodeURIComponent(fileId)}`)
}
/** A WebP thumbnail of a style's image (the read right). */
export function artStyleThumbnailUrl(styleId: number, fileId: string) {
  return buildApiUrl(`${BASE}/${styleId}/files/${encodeURIComponent(fileId)}/thumbnail`)
}
/** Export a bundle (`{}`: every style) and save it as `<name>.art-styles.zip`; returns the style count. */
export async function downloadArtStyleExport(input: ArtStyleExportInput, name: string) {
  const response = await fetch(buildApiUrl(`${BASE}/export`), { method: 'POST', credentials: 'include', headers: JSON_HEADERS, body: JSON.stringify(input) })
  const blob = await readDownloadBlob(response)
  const safeName = name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'art-styles'
  triggerBlobDownload(blob, `${safeName}.art-styles.zip`)
  return Number(response.headers.get('X-Art-Style-Count') ?? 0)
}
export function importArtStyles(file: File) {
  const form = new FormData()
  form.append('file', file, file.name)
  return requestApiData<ArtStyleImportResult>(`${BASE}/import`, { method: 'POST', body: form }, { timeoutMs: 600000 })
}

/** The style changed since it was read (stale `revision`). */
export function isArtStyleRevisionConflict(error: unknown) {
  return error instanceof ApiRequestError && error.status === 409 && error.code === 'revision_conflict'
}
/** The title (or its image group's name) is taken. */
export function isArtStyleNameConflict(error: unknown) {
  return error instanceof ApiRequestError && error.status === 409 && error.code === 'name_conflict'
}

/**
 * After a change: refetch the active lists and badge counts, and the changed styles. A list refetches when it holds one
 * of them, or whenever the set may have changed (`listsChanged`: create, delete, import).
 */
export function invalidateArtStyles(queryClient: QueryClient, change: { styleIds: number[]; listsChanged?: boolean }) {
  const ids = new Set(change.styleIds)
  return queryClient.invalidateQueries({
    queryKey: [ART_STYLES_QUERY_KEY],
    refetchType: 'active',
    predicate: ({ queryKey, state }) => {
      if (queryKey[1] === 'badges') return true
      if (queryKey[1] === 'style') return ids.has(Number(queryKey[2]))
      if (queryKey[1] !== 'list') return false
      if (change.listsChanged) return true
      const data = state.data as InfiniteData<ArtStylePage> | undefined
      return Boolean(data?.pages.some((page) => page.items.some((item) => ids.has(item.id))))
    },
  })
}
