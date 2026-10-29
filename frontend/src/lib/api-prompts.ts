import { createApiFallbackError } from '@/i18n/api-error-fallbacks'
import { triggerBlobDownload } from '@/lib/api-client'
import { requestApiData, requestJson } from '@/lib/api-request'
import type { ApiResponse } from '@/types/image'
import type { DanbooruBrowserCharacterRecord, DanbooruBrowserTagRecord } from '@/types/danbooru-browser'
import type {
  DanbooruPromptGroupingMode,
  DanbooruPromptGroupingResult,
  PromptCollectionItem,
  PromptGroupExportData,
  PromptGroupImportResult,
  PromptGroupRecord,
  PromptGroupResolveItem,
  PromptSearchPayload,
  PromptSortBy,
  PromptSortOrder,
  PromptStatistics,
  PromptTypeFilter,
} from '@/types/prompt'

function normalizePromptItem(item: PromptCollectionItem & { synonyms?: string[] | null; type?: string | null }): PromptCollectionItem {
  return {
    ...item,
    synonyms: Array.isArray(item.synonyms) ? item.synonyms.map((value) => String(value)) : [],
    type: item.type === 'negative' || item.type === 'auto' ? item.type : 'positive',
    group_info: item.group_info ?? null,
  }
}

export type PromptSuggestResponse = {
  prompts: Array<{ id: number; prompt: string; usageCount: number; groupName: string | null }>
  tags: DanbooruBrowserTagRecord[]
  characters: DanbooruBrowserCharacterRecord[]
  /** Terms the user often wrote next to the context terms in recent images. */
  related: Array<{ term: string; count: number }>
}

/** Prompt editor autocomplete in one request: my prompts, Danbooru tags/characters, and terms used with the context. */
export function getPromptSuggestions(params: { query: string; type: PromptTypeFilter; limit: number; relatedTagLimit: number; context: string[] }, signal?: AbortSignal) {
  const searchParams = new URLSearchParams({ q: params.query, type: params.type, limit: String(params.limit), relatedTagLimit: String(params.relatedTagLimit) })
  if (params.context.length > 0) {
    searchParams.set('context', params.context.join(','))
  }
  return requestApiData<PromptSuggestResponse>(`/api/prompt-collection/suggest?${searchParams.toString()}`, { signal })
}

/** Per-account prompt editor settings; null until the account saved them once. */
export function getPromptEditorSettings() {
  return requestApiData<Record<string, unknown> | null>('/api/prompt-collection/editor-settings')
}

export function savePromptEditorSettings(settings: object) {
  return requestApiData<Record<string, unknown>>('/api/prompt-collection/editor-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) })
}

export type PromptAuthorInput ={ type: PromptTypeFilter; prompt: string; synonyms: string[]; group_id: number | null }
export function getPromptCollectionItem(id: number, type: PromptTypeFilter) {
  return requestApiData<PromptCollectionItem & { assistant_revision: string }>(`/api/prompt-collection/item/${id}?type=${type}`)
}
export function createPromptCollectionItem(input: PromptAuthorInput) {
  return requestApiData<{ id: number }>('/api/prompt-collection/item', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}
export function updatePromptCollectionItem(id: number, input: PromptAuthorInput, revision?: string) {
  return requestApiData<{ id: number }>(`/api/prompt-collection/item/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(revision ? { 'If-Match': revision } : {}) }, body: JSON.stringify(input) })
}

export async function getPromptGroups(type: PromptTypeFilter = 'positive') {
  const route = `/api/prompt-groups/summaries?type=${type}`
  const response = await requestJson<{ success: boolean; data?: PromptGroupRecord[]; error?: string }>(route)
  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'prompts.groups.load')
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
  searchParams.set('type', params?.type ?? 'positive')
  searchParams.set('page', String(params?.page ?? 1))
  searchParams.set('limit', String(params?.limit ?? 40))
  searchParams.set('sortBy', params?.sortBy ?? 'usage_count')
  searchParams.set('sortOrder', params?.sortOrder ?? 'DESC')
  if (params?.groupId !== undefined) {
    searchParams.set('group_id', params.groupId === null ? 'null' : String(params.groupId))
  }

  const response = await requestJson<{
    success: boolean
    data?: PromptCollectionItem[]
    error?: string
    group_info?: PromptGroupRecord | null
    pagination?: { page: number; limit: number; total: number; totalPages: number }
  }>(`/api/prompt-collection/search?${searchParams.toString()}`)

  if (!response.success || !response.data || !response.pagination) {
    throw createApiFallbackError(response.error, 'prompts.collection.search')
  }

  const payload: PromptSearchPayload = {
    items: response.data.map((item) => normalizePromptItem(item as PromptCollectionItem & { synonyms?: string[] | null; type?: string | null })),
    groupInfo: response.group_info ?? null,
    pagination: response.pagination,
  }

  return payload
}

export async function getPromptStatistics() {
  const response = await requestJson<ApiResponse<PromptStatistics>>('/api/prompt-collection/statistics')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'prompts.statistics.load')
  }
  return response.data
}

export async function getDanbooruPromptGroupingPreview(options?: { mode?: DanbooruPromptGroupingMode; language?: 'ko' | 'en'; includeAssignedPrompts?: boolean }) {
  const searchParams = new URLSearchParams()
  searchParams.set('mode', options?.mode ?? 'unclassified-only')
  if (options?.language) {
    searchParams.set('language', options.language)
  }
  if (options?.includeAssignedPrompts) {
    searchParams.set('includeAssignedPrompts', 'true')
  }
  const response = await requestJson<ApiResponse<DanbooruPromptGroupingResult>>(`/api/prompt-collection/danbooru-grouping/preview?${searchParams.toString()}`)
  if (!response.success) {
    throw createApiFallbackError(response.error, 'prompts.danbooruGrouping.preview')
  }
  return response.data
}

export async function applyDanbooruPromptGrouping(options?: { mode?: DanbooruPromptGroupingMode; language?: 'ko' | 'en'; includeAssignedPrompts?: boolean }) {
  const response = await requestJson<ApiResponse<DanbooruPromptGroupingResult>>('/api/prompt-collection/danbooru-grouping/apply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mode: options?.mode ?? 'unclassified-only',
      language: options?.language,
      includeAssignedPrompts: options?.includeAssignedPrompts ?? false,
    }),
  })
  if (!response.success) {
    throw createApiFallbackError(response.error, 'prompts.danbooruGrouping.apply')
  }
  return response.data
}

export async function resolvePromptGroups(prompts: string[], type: PromptTypeFilter = 'positive') {
  const response = await requestJson<ApiResponse<PromptGroupResolveItem[]>>('/api/prompt-collection/resolve-groups', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompts,
      type,
    }),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'prompts.groups.resolve')
  }

  return response.data
}

export async function getTopPrompts(params?: { type?: PromptTypeFilter; limit?: number }) {
  const searchParams = new URLSearchParams()
  searchParams.set('type', params?.type ?? 'positive')
  searchParams.set('limit', String(params?.limit ?? 8))

  const response = await requestJson<ApiResponse<PromptCollectionItem[]>>(`/api/prompt-collection/top?${searchParams.toString()}`)
  if (!response.success) {
    throw createApiFallbackError(response.error, 'prompts.top.load')
  }
  return response.data.map((item) => normalizePromptItem(item as PromptCollectionItem & { synonyms?: string[] | null; type?: string | null }))
}

export async function assignPromptToGroup(promptId: number, groupId: number | null, type: PromptTypeFilter = 'positive') {
  const response = await requestJson<ApiResponse<{ message: string; assigned: boolean }>>('/api/prompt-collection/assign-group', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt_id: promptId,
      group_id: groupId,
      type,
    }),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'prompts.group.assign')
  }

  return response.data
}

export async function batchAssignPromptsToGroup(prompts: string[], groupId: number | null, type: PromptTypeFilter = 'positive') {
  const response = await requestJson<ApiResponse<{ message: string; created: number; updated: number; failed: string[] }>>('/api/prompt-collection/batch-assign', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompts,
      group_id: groupId,
      type,
    }),
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'prompts.group.batchAssign')
  }

  return response.data
}

export async function createPromptGroup(input: { group_name: string; display_order?: number; is_visible?: boolean; parent_id?: number | null }, type: PromptTypeFilter = 'positive') {
  const route = type === 'negative' ? '/api/negative-prompt-groups' : '/api/prompt-groups'
  const response = await requestJson<{ success: boolean; data?: { id: number; message: string }; error?: string }>(route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...input, type }),
  })

  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'prompts.groups.create')
  }

  return response.data
}

export async function updatePromptGroup(groupId: number, input: { group_name?: string; display_order?: number; is_visible?: boolean }, type: PromptTypeFilter = 'positive') {
  const route = type === 'negative' ? `/api/negative-prompt-groups/${groupId}` : `/api/prompt-groups/${groupId}`
  const response = await requestJson<{ success: boolean; data?: { updated: boolean; message: string }; error?: string }>(route, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...input, type }),
  })

  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'prompts.groups.update')
  }

  return response.data
}

export async function deletePromptGroup(groupId: number, type: PromptTypeFilter = 'positive') {
  const route = type === 'negative' ? `/api/negative-prompt-groups/${groupId}` : `/api/prompt-groups/${groupId}?type=${type}`
  const response = await requestJson<{ success: boolean; data?: { deleted: boolean; message: string }; error?: string }>(route, {
    method: 'DELETE',
  })

  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'prompts.groups.delete')
  }

  return response.data
}

export async function reorderPromptGroups(groupOrders: Array<{ id: number; display_order: number }>, type: PromptTypeFilter = 'positive') {
  const route = type === 'negative' ? '/api/negative-prompt-groups/reorder' : '/api/prompt-groups/reorder'
  const response = await requestJson<{ success: boolean; data?: { updated_count: number; message: string }; error?: string }>(route, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ group_orders: groupOrders, type }),
  })

  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'prompts.groups.reorder')
  }

  return response.data
}

export async function exportPromptGroups(type: PromptTypeFilter = 'positive') {
  const route = type === 'negative' ? '/api/negative-prompt-groups/export' : `/api/prompt-groups/export?type=${type}`
  const response = await requestJson<PromptGroupExportData>(route)
  const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' })
  const filename = `conai-prompt-groups-${type}.json`
  triggerBlobDownload(blob, filename)
  return response
}

export async function importPromptGroups(payload: PromptGroupExportData, type: PromptTypeFilter = 'positive') {
  const route = type === 'negative' ? '/api/negative-prompt-groups/import' : `/api/prompt-groups/import?type=${type}`
  const response = await requestJson<{ success: boolean; data?: PromptGroupImportResult; error?: string }>(route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'prompts.groups.import')
  }

  return response.data
}

export function deletePrompts(promptIds: number[], type: PromptTypeFilter = 'positive') {
  return requestApiData<{ deletedIds: number[]; message: string }>('/api/prompt-collection/bulk', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ promptIds, type }),
  })
}

export async function deletePrompt(promptId: number, type: PromptTypeFilter = 'positive') {
  const response = await requestJson<{ success: boolean; data?: { deleted: boolean; message: string }; error?: string }>(`/api/prompt-collection/${promptId}?type=${type}`, {
    method: 'DELETE',
  })

  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'prompts.item.delete')
  }

  return response.data
}

export async function collectPrompts(input: { prompt?: string; negativePrompt?: string }) {
  const response = await requestJson<{ success: boolean; data?: { message: string }; error?: string }>('/api/prompt-collection/collect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'prompts.collect.run')
  }

  return response.data
}
