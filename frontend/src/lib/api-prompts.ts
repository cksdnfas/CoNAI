import { fetchJson, triggerBlobDownload } from '@/lib/api-client'
import type { ApiResponse } from '@/types/image'
import type {
  PromptCollectionItem,
  PromptGroupExportData,
  PromptGroupImportResult,
  PromptGroupRecord,
  PromptGroupResolveItem,
  PromptGraphPayload,
  PromptSearchPayload,
  PromptSortBy,
  PromptSortOrder,
  PromptStatistics,
  PromptTaxonomyInferredType,
  PromptTaxonomyPayload,
  PromptTaxonomyRelationKind,
  PromptTypeFilter,
} from '@/types/prompt'

const TAXONOMY_INFERRED_TYPE_VALUES = new Set<PromptTaxonomyInferredType>([
  'quality',
  'subject',
  'count_or_composition',
  'pose_or_action',
  'body_or_expression',
  'hair_or_face',
  'clothing_or_accessory',
  'prop_or_object',
  'background_or_setting',
  'lighting_or_mood',
  'style',
  'artist_or_source',
  'meta_or_technical',
  'unknown',
])

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

export async function getPromptGraph(params?: {
  type?: PromptTypeFilter
  minScore?: number
  minSharedCount?: number
  minUsageCount?: number
  limit?: number
}) {
  const searchParams = new URLSearchParams()
  searchParams.set('type', params?.type ?? 'positive')
  searchParams.set('minScore', String(params?.minScore ?? 55))
  searchParams.set('minSharedCount', String(params?.minSharedCount ?? 3))
  searchParams.set('minUsageCount', String(params?.minUsageCount ?? 2))
  searchParams.set('limit', String(params?.limit ?? 180))

  const response = await fetchJson<ApiResponse<PromptGraphPayload>>(`/api/prompt-collection/graph?${searchParams.toString()}`)
  if (!response.success) {
    throw new Error(response.error || '프롬프트 그래프를 불러오지 못했어.')
  }

  const normalizedType: PromptTypeFilter = response.data.filters.type === 'negative' || response.data.filters.type === 'auto'
    ? response.data.filters.type
    : 'positive'

  return {
    ...response.data,
    nodes: response.data.nodes.map((node) => ({
      ...node,
      id: Number(node.id),
      prompt: String(node.prompt),
      usage_count: Number(node.usage_count ?? 0),
      group_id: node.group_id ?? null,
      degree: Number(node.degree ?? 0),
    })),
    edges: response.data.edges.map((edge) => ({
      ...edge,
      source_prompt: String(edge.source_prompt),
      target_prompt: String(edge.target_prompt),
      shared_count: Number(edge.shared_count ?? 0),
      score: Number(edge.score ?? 0),
    })),
    filters: {
      ...response.data.filters,
      type: normalizedType,
      min_score: Number(response.data.filters.min_score ?? 0),
      min_shared_count: Number(response.data.filters.min_shared_count ?? 0),
      min_usage_count: Number(response.data.filters.min_usage_count ?? 0),
      limit: Number(response.data.filters.limit ?? 0),
    },
  }
}

export async function getPromptTaxonomyGraph(params?: {
  type?: PromptTypeFilter
  inferredType?: PromptTaxonomyInferredType | 'all'
  relationKind?: PromptTaxonomyRelationKind | 'all'
  minScore?: number
  limit?: number
}) {
  const searchParams = new URLSearchParams()
  searchParams.set('type', params?.type ?? 'positive')
  searchParams.set('inferredType', params?.inferredType ?? 'all')
  searchParams.set('relationKind', params?.relationKind ?? 'all')
  searchParams.set('minScore', String(params?.minScore ?? 0.58))
  searchParams.set('limit', String(params?.limit ?? 180))

  const response = await fetchJson<ApiResponse<PromptTaxonomyPayload>>(`/api/prompt-collection/taxonomy-graph?${searchParams.toString()}`)
  if (!response.success) {
    throw new Error(response.error || '프롬프트 taxonomy 그래프를 불러오지 못했어.')
  }

  const normalizedType: PromptTypeFilter = response.data.filters.type === 'negative' || response.data.filters.type === 'auto'
    ? response.data.filters.type
    : 'positive'
  const normalizedInferredType: PromptTaxonomyInferredType | 'all' = TAXONOMY_INFERRED_TYPE_VALUES.has(response.data.filters.inferred_type as PromptTaxonomyInferredType)
    ? response.data.filters.inferred_type as PromptTaxonomyInferredType
    : 'all'
  const normalizedRelationKind: PromptTaxonomyRelationKind | 'all' = response.data.filters.relation_kind === 'same_family' || response.data.filters.relation_kind === 'string_variant'
    ? response.data.filters.relation_kind
    : 'all'

  return {
    ...response.data,
    nodes: response.data.nodes.map((node) => ({
      ...node,
      id: Number(node.id),
      prompt: String(node.prompt),
      usage_count: Number(node.usage_count ?? 0),
      group_id: node.group_id ?? null,
      inferred_type: node.inferred_type,
      cluster_id: node.cluster_id ?? null,
      canonical_prompt: node.canonical_prompt ?? null,
    })),
    edges: response.data.edges.map((edge) => ({
      ...edge,
      source_prompt: String(edge.source_prompt),
      target_prompt: String(edge.target_prompt),
      relation_kind: edge.relation_kind,
      score: Number(edge.score ?? 0),
    })),
    filters: {
      ...response.data.filters,
      type: normalizedType,
      inferred_type: normalizedInferredType,
      relation_kind: normalizedRelationKind,
      min_score: Number(response.data.filters.min_score ?? 0),
      limit: Number(response.data.filters.limit ?? 0),
    },
  }
}

export async function rebuildPromptRelations() {
  const response = await fetchJson<ApiResponse<{ processed: number; updated: number; cleared: number; message: string }>>('/api/prompt-collection/rebuild-relations', {
    method: 'POST',
  })

  if (!response.success) {
    throw new Error(response.error || '프롬프트 관계 재구축에 실패했어.')
  }

  return response.data
}

export async function rebuildPromptTaxonomy() {
  const response = await fetchJson<ApiResponse<{ processed: number; nodes: number; clusters: number; relations: number; message: string }>>('/api/prompt-collection/rebuild-taxonomy', {
    method: 'POST',
  })

  if (!response.success) {
    throw new Error(response.error || '프롬프트 taxonomy 재구축에 실패했어.')
  }

  return response.data
}
