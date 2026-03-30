import { fetchJson, triggerBlobDownload } from '@/lib/api-client'
import type { ApiResponse } from '@/types/image'
import type {
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

export async function getPromptGroups(type: PromptTypeFilter = 'positive') {
  const route = type === 'negative' ? '/api/negative-prompt-groups' : `/api/prompt-groups?type=${type}`
  const response = await fetchJson<{ success: boolean; data?: PromptGroupRecord[]; error?: string }>(route)
  if (!response.success || !response.data) {
    throw new Error(response.error || '프롬프트 그룹을 불러오지 못했어.')
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

  const response = await fetchJson<{
    success: boolean
    data?: PromptCollectionItem[]
    error?: string
    group_info?: PromptGroupRecord | null
    pagination?: { page: number; limit: number; total: number; totalPages: number }
  }>(`/api/prompt-collection/search?${searchParams.toString()}`)

  if (!response.success || !response.data || !response.pagination) {
    throw new Error(response.error || '프롬프트 목록을 불러오지 못했어.')
  }

  const payload: PromptSearchPayload = {
    items: response.data.map((item) => normalizePromptItem(item as PromptCollectionItem & { synonyms?: string[] | null; type?: string | null })),
    groupInfo: response.group_info ?? null,
    pagination: response.pagination,
  }

  return payload
}

export async function getPromptStatistics() {
  const response = await fetchJson<ApiResponse<PromptStatistics>>('/api/prompt-collection/statistics')
  if (!response.success) {
    throw new Error(response.error || '프롬프트 통계를 불러오지 못했어.')
  }
  return response.data
}

export async function resolvePromptGroups(prompts: string[], type: PromptTypeFilter = 'positive') {
  const response = await fetchJson<ApiResponse<PromptGroupResolveItem[]>>('/api/prompt-collection/resolve-groups', {
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
    throw new Error(response.error || '프롬프트 그룹 정렬 정보를 불러오지 못했어.')
  }

  return response.data
}

export async function getTopPrompts(params?: { type?: PromptTypeFilter; limit?: number }) {
  const searchParams = new URLSearchParams()
  searchParams.set('type', params?.type ?? 'positive')
  searchParams.set('limit', String(params?.limit ?? 8))

  const response = await fetchJson<ApiResponse<PromptCollectionItem[]>>(`/api/prompt-collection/top?${searchParams.toString()}`)
  if (!response.success) {
    throw new Error(response.error || '상위 프롬프트를 불러오지 못했어.')
  }
  return response.data.map((item) => normalizePromptItem(item as PromptCollectionItem & { synonyms?: string[] | null; type?: string | null }))
}

export async function assignPromptToGroup(promptId: number, groupId: number | null, type: PromptTypeFilter = 'positive') {
  const response = await fetchJson<ApiResponse<{ message: string; assigned: boolean }>>('/api/prompt-collection/assign-group', {
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
    throw new Error(response.error || '프롬프트 그룹 지정에 실패했어.')
  }

  return response.data
}

export async function batchAssignPromptsToGroup(prompts: string[], groupId: number | null, type: PromptTypeFilter = 'positive') {
  const response = await fetchJson<ApiResponse<{ message: string; created: number; updated: number; failed: string[] }>>('/api/prompt-collection/batch-assign', {
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
    throw new Error(response.error || '프롬프트 일괄 그룹 지정에 실패했어.')
  }

  return response.data
}

export async function createPromptGroup(input: { group_name: string; display_order?: number; is_visible?: boolean; parent_id?: number | null }, type: PromptTypeFilter = 'positive') {
  const route = type === 'negative' ? '/api/negative-prompt-groups' : '/api/prompt-groups'
  const response = await fetchJson<{ success: boolean; data?: { id: number; message: string }; error?: string }>(route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...input, type }),
  })

  if (!response.success || !response.data) {
    throw new Error(response.error || '프롬프트 그룹 생성에 실패했어.')
  }

  return response.data
}

export async function updatePromptGroup(groupId: number, input: { group_name?: string; display_order?: number; is_visible?: boolean }, type: PromptTypeFilter = 'positive') {
  const route = type === 'negative' ? `/api/negative-prompt-groups/${groupId}` : `/api/prompt-groups/${groupId}`
  const response = await fetchJson<{ success: boolean; data?: { updated: boolean; message: string }; error?: string }>(route, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...input, type }),
  })

  if (!response.success || !response.data) {
    throw new Error(response.error || '프롬프트 그룹 수정에 실패했어.')
  }

  return response.data
}

export async function deletePromptGroup(groupId: number, type: PromptTypeFilter = 'positive') {
  const route = type === 'negative' ? `/api/negative-prompt-groups/${groupId}` : `/api/prompt-groups/${groupId}?type=${type}`
  const response = await fetchJson<{ success: boolean; data?: { deleted: boolean; message: string }; error?: string }>(route, {
    method: 'DELETE',
  })

  if (!response.success || !response.data) {
    throw new Error(response.error || '프롬프트 그룹 삭제에 실패했어.')
  }

  return response.data
}

export async function reorderPromptGroups(groupOrders: Array<{ id: number; display_order: number }>, type: PromptTypeFilter = 'positive') {
  const route = type === 'negative' ? '/api/negative-prompt-groups/reorder' : '/api/prompt-groups/reorder'
  const response = await fetchJson<{ success: boolean; data?: { updated_count: number; message: string }; error?: string }>(route, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ group_orders: groupOrders, type }),
  })

  if (!response.success || !response.data) {
    throw new Error(response.error || '프롬프트 그룹 순서 변경에 실패했어.')
  }

  return response.data
}

export async function getPromptGroupStatistics(type: PromptTypeFilter = 'positive') {
  const response = await fetchJson<ApiResponse<PromptGroupRecord[]>>(`/api/prompt-collection/group-statistics?type=${type}`)
  if (!response.success) {
    throw new Error(response.error || '프롬프트 그룹 통계를 불러오지 못했어.')
  }
  return response.data
}

export async function exportPromptGroups(type: PromptTypeFilter = 'positive') {
  const route = type === 'negative' ? '/api/negative-prompt-groups/export' : `/api/prompt-groups/export?type=${type}`
  const response = await fetchJson<PromptGroupExportData>(route)
  const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' })
  const filename = `conai-prompt-groups-${type}.json`
  triggerBlobDownload(blob, filename)
  return response
}

export async function importPromptGroups(payload: PromptGroupExportData, type: PromptTypeFilter = 'positive') {
  const route = type === 'negative' ? '/api/negative-prompt-groups/import' : `/api/prompt-groups/import?type=${type}`
  const response = await fetchJson<{ success: boolean; data?: PromptGroupImportResult; error?: string }>(route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.success || !response.data) {
    throw new Error(response.error || '프롬프트 그룹 가져오기에 실패했어.')
  }

  return response.data
}

export async function deletePrompt(promptId: number, type: PromptTypeFilter = 'positive') {
  const response = await fetchJson<{ success: boolean; data?: { deleted: boolean; message: string }; error?: string }>(`/api/prompt-collection/${promptId}?type=${type}`, {
    method: 'DELETE',
  })

  if (!response.success || !response.data) {
    throw new Error(response.error || '프롬프트 삭제에 실패했어.')
  }

  return response.data
}

export async function collectPrompts(input: { prompt?: string; negativePrompt?: string }) {
  const response = await fetchJson<{ success: boolean; data?: { message: string }; error?: string }>('/api/prompt-collection/collect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.success || !response.data) {
    throw new Error(response.error || '프롬프트 수집 실행에 실패했어.')
  }

  return response.data
}
