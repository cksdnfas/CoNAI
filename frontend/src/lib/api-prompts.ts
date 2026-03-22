import { fetchJson } from '@/lib/api-client'
import type { ApiResponse } from '@/types/image'
import type {
  PromptCollectionItem,
  PromptGroupRecord,
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
    items: response.data,
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
