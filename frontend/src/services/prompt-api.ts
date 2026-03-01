import { apiClient } from '@/lib/api/client'

export type PromptType = 'positive' | 'negative'
export type PromptCollectionType = PromptType | 'auto' | 'both'
export type SortOrder = 'ASC' | 'DESC'
export type PromptSortBy = 'usage_count' | 'created_at' | 'prompt'

export interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
  message?: string
}

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface PromptRecord extends Record<string, unknown> {
  id: number
  prompt: string
  type: PromptType
  usage_count?: number
  group_id?: number | null
  created_at?: string
  updated_at?: string
}

export interface PromptSearchGroupInfo extends Record<string, unknown> {
  id?: number | null
  group_name?: string
  type?: PromptType
}

export interface PromptSearchResponse extends ApiResponse<PromptRecord[]> {
  group_info?: PromptSearchGroupInfo
  pagination?: Pagination
}

export interface PromptStatistics extends Record<string, unknown> {
  total_positive?: number
  total_negative?: number
  total_prompts?: number
}

export interface PromptCollectionMutationResult extends Record<string, unknown> {
  message?: string
  deleted?: boolean
  assigned?: boolean
  removed?: boolean
  created?: number
  updated?: number
  failed?: string[]
}

export interface PromptGroupRecord extends Record<string, unknown> {
  id: number | null
  group_name: string
  display_order?: number
  is_visible?: boolean
  parent_id?: number | null
  prompt_count?: number
}

export interface PromptGroupOrder {
  id: number
  display_order: number
}

export interface PromptGroupData {
  group_name: string
  display_order?: number
  is_visible?: boolean
  parent_id?: number | null
}

export interface PromptGroupMutationResult extends Record<string, unknown> {
  id?: number
  moved?: boolean
  updated?: boolean
  deleted?: boolean
  updated_count?: number
  message?: string
}

export interface PromptGroupPromptsResult extends Record<string, unknown> {
  prompts?: PromptRecord[]
  total?: number
  pagination?: Pagination
}

export interface NegativePromptGroupData {
  group_name: string
  display_order?: number
  is_visible?: boolean
}

export const promptCollectionApi = {
  searchPrompts: async (
    query = '',
    type: PromptCollectionType = 'both',
    page = 1,
    limit = 20,
    sortBy: PromptSortBy = 'usage_count',
    sortOrder: SortOrder = 'DESC',
    groupId?: number | null,
  ): Promise<PromptSearchResponse> => {
    const params: {
      q: string
      type: PromptCollectionType
      page: number
      limit: number
      sortBy: PromptSortBy
      sortOrder: SortOrder
      group_id?: number | null
    } = {
      q: query,
      type,
      page,
      limit,
      sortBy,
      sortOrder,
    }

    if (groupId !== undefined) {
      params.group_id = groupId
    }

    const response = await apiClient.get<PromptSearchResponse>('/api/prompt-collection/search', {
      params,
    })
    return response.data
  },

  deletePrompt: async (promptId: number, type: PromptType = 'positive'): Promise<ApiResponse<PromptCollectionMutationResult>> => {
    const response = await apiClient.delete<ApiResponse<PromptCollectionMutationResult>>(`/api/prompt-collection/${promptId}`, {
      params: { type },
    })
    return response.data
  },

  assignPromptToGroup: async (
    promptId: number,
    groupId: number | null,
    type: PromptType = 'positive',
  ): Promise<ApiResponse<PromptCollectionMutationResult>> => {
    const response = await apiClient.put<ApiResponse<PromptCollectionMutationResult>>('/api/prompt-collection/assign-group', {
      prompt_id: promptId,
      group_id: groupId,
      type,
    })
    return response.data
  },

  batchAssignPromptsToGroup: async (
    prompts: string[],
    groupId: number | null,
    type: PromptType = 'positive',
  ): Promise<ApiResponse<PromptCollectionMutationResult>> => {
    const response = await apiClient.post<ApiResponse<PromptCollectionMutationResult>>('/api/prompt-collection/batch-assign', {
      prompts,
      group_id: groupId,
      type,
    })
    return response.data
  },

  getStatistics: async (): Promise<ApiResponse<PromptStatistics>> => {
    const response = await apiClient.get<ApiResponse<PromptStatistics>>('/api/prompt-collection/statistics')
    return response.data
  },

  getTopPrompts: async (limit = 20, type: PromptCollectionType = 'both'): Promise<ApiResponse<PromptRecord[]>> => {
    const response = await apiClient.get<ApiResponse<PromptRecord[]>>('/api/prompt-collection/top', {
      params: { limit, type },
    })
    return response.data
  },

  setSynonyms: async (
    mainPrompt: string,
    synonyms: string[],
    type: PromptType = 'positive',
  ): Promise<ApiResponse<PromptCollectionMutationResult>> => {
    const response = await apiClient.post<ApiResponse<PromptCollectionMutationResult>>('/api/prompt-collection/synonyms', {
      mainPrompt,
      synonyms,
      type,
    })
    return response.data
  },

  removeSynonym: async (
    promptId: number,
    synonym: string,
    type: PromptType = 'positive',
  ): Promise<ApiResponse<PromptCollectionMutationResult>> => {
    const response = await apiClient.delete<ApiResponse<PromptCollectionMutationResult>>(`/api/prompt-collection/synonyms/${promptId}`, {
      data: { synonym, type },
    })
    return response.data
  },
}

export const promptGroupApi = {
  getGroups: async (includeHidden = false, type: PromptType = 'positive'): Promise<ApiResponse<PromptGroupRecord[]>> => {
    const response = await apiClient.get<ApiResponse<PromptGroupRecord[]>>('/api/prompt-groups', {
      params: {
        include_hidden: includeHidden,
        type,
      },
    })
    return response.data
  },

  getGroup: async (id: number, type: PromptType = 'positive'): Promise<ApiResponse<PromptGroupRecord>> => {
    const response = await apiClient.get<ApiResponse<PromptGroupRecord>>(`/api/prompt-groups/${id}`, {
      params: { type },
    })
    return response.data
  },

  getGroupPrompts: async (
    id: number,
    type: PromptType = 'positive',
    page = 1,
    limit = 20,
  ): Promise<ApiResponse<PromptGroupPromptsResult>> => {
    const response = await apiClient.get<ApiResponse<PromptGroupPromptsResult>>(`/api/prompt-groups/${id}/prompts`, {
      params: {
        type,
        page,
        limit,
      },
    })
    return response.data
  },

  createGroup: async (groupData: PromptGroupData, type: PromptType = 'positive'): Promise<ApiResponse<PromptGroupMutationResult>> => {
    const response = await apiClient.post<ApiResponse<PromptGroupMutationResult>>('/api/prompt-groups', {
      ...groupData,
      type,
    })
    return response.data
  },

  updateGroup: async (
    id: number,
    groupData: Partial<PromptGroupData>,
    type: PromptType = 'positive',
  ): Promise<ApiResponse<PromptGroupMutationResult>> => {
    const response = await apiClient.put<ApiResponse<PromptGroupMutationResult>>(`/api/prompt-groups/${id}`, {
      ...groupData,
      type,
    })
    return response.data
  },

  deleteGroup: async (id: number, type: PromptType = 'positive'): Promise<ApiResponse<PromptGroupMutationResult>> => {
    const response = await apiClient.delete<ApiResponse<PromptGroupMutationResult>>(`/api/prompt-groups/${id}`, {
      params: { type },
    })
    return response.data
  },

  movePromptToGroup: async (
    promptId: number,
    targetGroupId: number | null,
    type: PromptType = 'positive',
  ): Promise<ApiResponse<PromptGroupMutationResult>> => {
    const response = await apiClient.put<ApiResponse<PromptGroupMutationResult>>('/api/prompt-groups/move-prompt', {
      prompt_id: promptId,
      target_group_id: targetGroupId,
      type,
    })
    return response.data
  },

  updateGroupOrders: async (
    groupOrders: PromptGroupOrder[],
    type: PromptType = 'positive',
  ): Promise<ApiResponse<PromptGroupMutationResult>> => {
    const response = await apiClient.put<ApiResponse<PromptGroupMutationResult>>('/api/prompt-groups/reorder', {
      group_orders: groupOrders,
      type,
    })
    return response.data
  },
}

export const negativePromptGroupApi = {
  getGroups: async (includeHidden = false): Promise<ApiResponse<PromptGroupRecord[]>> => {
    const response = await apiClient.get<ApiResponse<PromptGroupRecord[]>>('/api/negative-prompt-groups', {
      params: {
        include_hidden: includeHidden,
      },
    })
    return response.data
  },

  getGroup: async (id: number): Promise<ApiResponse<PromptGroupRecord>> => {
    const response = await apiClient.get<ApiResponse<PromptGroupRecord>>(`/api/negative-prompt-groups/${id}`)
    return response.data
  },

  getGroupPrompts: async (id: number, page = 1, limit = 20): Promise<ApiResponse<PromptGroupPromptsResult>> => {
    const response = await apiClient.get<ApiResponse<PromptGroupPromptsResult>>(`/api/negative-prompt-groups/${id}/prompts`, {
      params: {
        page,
        limit,
      },
    })
    return response.data
  },

  createGroup: async (groupData: NegativePromptGroupData): Promise<ApiResponse<PromptGroupMutationResult>> => {
    const response = await apiClient.post<ApiResponse<PromptGroupMutationResult>>('/api/negative-prompt-groups', groupData)
    return response.data
  },

  updateGroup: async (id: number, groupData: Partial<NegativePromptGroupData>): Promise<ApiResponse<PromptGroupMutationResult>> => {
    const response = await apiClient.put<ApiResponse<PromptGroupMutationResult>>(`/api/negative-prompt-groups/${id}`, groupData)
    return response.data
  },

  deleteGroup: async (id: number): Promise<ApiResponse<PromptGroupMutationResult>> => {
    const response = await apiClient.delete<ApiResponse<PromptGroupMutationResult>>(`/api/negative-prompt-groups/${id}`)
    return response.data
  },

  movePromptToGroup: async (promptId: number, targetGroupId: number | null): Promise<ApiResponse<PromptGroupMutationResult>> => {
    const response = await apiClient.put<ApiResponse<PromptGroupMutationResult>>('/api/negative-prompt-groups/move-prompt', {
      prompt_id: promptId,
      target_group_id: targetGroupId,
    })
    return response.data
  },

  updateGroupOrders: async (groupOrders: PromptGroupOrder[]): Promise<ApiResponse<PromptGroupMutationResult>> => {
    const response = await apiClient.put<ApiResponse<PromptGroupMutationResult>>('/api/negative-prompt-groups/reorder', {
      group_orders: groupOrders,
    })
    return response.data
  },
}
