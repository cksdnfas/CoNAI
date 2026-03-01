import { apiClient } from '@/lib/api/client'

export type WildcardTool = 'comfyui' | 'nai'

export type WildcardType = 'wildcard' | 'chain'

export type WildcardChainOption = 'replace' | 'append'

export interface Wildcard {
  id: number
  name: string
  description?: string
  parent_id: number | null
  include_children: number
  only_children: number
  type: WildcardType
  chain_option: WildcardChainOption
  is_auto_collected?: number
  source_path?: string | null
  lora_weight?: number | null
  created_date: string
  updated_date: string
}

export interface WildcardItem {
  id: number
  wildcard_id: number
  tool: WildcardTool
  content: string
  weight: number
  order_index: number
  created_date: string
}

export interface WildcardWithItems extends Wildcard {
  items: WildcardItem[]
}

export interface WildcardWithHierarchy extends WildcardWithItems {
  children?: WildcardWithHierarchy[]
  parent?: Wildcard
}

export interface WildcardToolItemInput {
  content: string
  weight: number
}

export interface WildcardToolItems {
  comfyui: WildcardToolItemInput[]
  nai: WildcardToolItemInput[]
}

export interface WildcardCreateInput {
  name: string
  description?: string
  items: WildcardToolItems
  customId?: number
  parent_id?: number | null
  include_children?: number
  only_children?: number
  type?: WildcardType
  chain_option?: WildcardChainOption
}

export interface WildcardUpdateInput {
  name?: string
  description?: string
  items?: WildcardToolItems
  parent_id?: number | null
  include_children?: number
  only_children?: number
  type?: WildcardType
  chain_option?: WildcardChainOption
}

export interface WildcardParseRequest {
  text: string
  tool: WildcardTool
  count?: number
}

export interface WildcardParseResult {
  original: string
  results: string[]
  usedWildcards: string[]
}

export interface WildcardStatistics {
  totalWildcards: number
  itemsByTool: {
    comfyui: number
    nai: number
  }
  totalItems: number
  averageItemsPerWildcard: number
}

export interface WildcardCircularCheckResult {
  hasCircularReference: boolean
  circularPath: string[]
}

export interface LoraFileData {
  folderName: string
  loraName: string
  promptLines: string[]
}

export interface WildcardLoraScanRequest {
  loraFiles: LoraFileData[]
  loraWeight: number
  duplicateHandling: 'number' | 'parent'
  matchingMode?: 'filename' | 'common'
  commonTextFilename?: string
  matchingPriority?: 'filename' | 'common'
}

export interface WildcardLoraScanLogItem {
  id: number
  name: string
  itemCount: number
  folderName: string
}

export interface WildcardLoraScanLog {
  timestamp: string
  loraWeight: number
  duplicateHandling: 'number' | 'parent'
  totalWildcards: number
  totalItems: number
  wildcards: WildcardLoraScanLogItem[]
}

export interface WildcardLoraScanResult {
  created: number
  log: WildcardLoraScanLog
}

export interface ApiSuccess<T> {
  success: boolean
  data: T
}

export interface ApiSuccessWithWarning<T> extends ApiSuccess<T> {
  warning?: string
}

export interface ApiSuccessMessage {
  success: boolean
  message: string
}

export const wildcardApi = {
  getAllWildcards: async (withItems = true): Promise<ApiSuccess<WildcardWithItems[]>> => {
    const response = await apiClient.get<ApiSuccess<WildcardWithItems[]>>('/api/wildcards', {
      params: { withItems },
    })
    return response.data
  },

  getWildcardsHierarchical: async (): Promise<ApiSuccess<WildcardWithHierarchy[]>> => {
    const response = await apiClient.get<ApiSuccess<WildcardWithHierarchy[]>>('/api/wildcards', {
      params: { hierarchical: true },
    })
    return response.data
  },

  getRootWildcards: async (): Promise<ApiSuccess<Wildcard[]>> => {
    const response = await apiClient.get<ApiSuccess<Wildcard[]>>('/api/wildcards', {
      params: { rootsOnly: true },
    })
    return response.data
  },

  getWildcardChildren: async (parentId: number): Promise<ApiSuccess<Wildcard[]>> => {
    const response = await apiClient.get<ApiSuccess<Wildcard[]>>(`/api/wildcards/${parentId}/children`)
    return response.data
  },

  getWildcardPath: async (id: number): Promise<ApiSuccess<Wildcard[]>> => {
    const response = await apiClient.get<ApiSuccess<Wildcard[]>>(`/api/wildcards/${id}/path`)
    return response.data
  },

  getWildcard: async (id: number): Promise<ApiSuccess<WildcardWithItems>> => {
    const response = await apiClient.get<ApiSuccess<WildcardWithItems>>(`/api/wildcards/${id}`)
    return response.data
  },

  createWildcard: async (data: WildcardCreateInput): Promise<ApiSuccessWithWarning<WildcardWithItems>> => {
    const response = await apiClient.post<ApiSuccessWithWarning<WildcardWithItems>>('/api/wildcards', data)
    return response.data
  },

  updateWildcard: async (id: number, data: WildcardUpdateInput): Promise<ApiSuccessWithWarning<WildcardWithItems>> => {
    const response = await apiClient.put<ApiSuccessWithWarning<WildcardWithItems>>(`/api/wildcards/${id}`, data)
    return response.data
  },

  deleteWildcard: async (id: number, cascade = false): Promise<ApiSuccessMessage> => {
    const response = await apiClient.delete<ApiSuccessMessage>(`/api/wildcards/${id}`, {
      params: { cascade },
    })
    return response.data
  },

  parseWildcards: async (parseRequest: WildcardParseRequest): Promise<ApiSuccess<WildcardParseResult>> => {
    const response = await apiClient.post<ApiSuccess<WildcardParseResult>>('/api/wildcards/parse', parseRequest)
    return response.data
  },

  getStatistics: async (): Promise<ApiSuccess<WildcardStatistics>> => {
    const response = await apiClient.get<ApiSuccess<WildcardStatistics>>('/api/wildcards/stats/summary')
    return response.data
  },

  checkCircularReference: async (id: number): Promise<ApiSuccess<WildcardCircularCheckResult>> => {
    const response = await apiClient.get<ApiSuccess<WildcardCircularCheckResult>>(`/api/wildcards/${id}/circular-check`)
    return response.data
  },

  scanLoraFolder: async (scanRequest: WildcardLoraScanRequest): Promise<ApiSuccess<WildcardLoraScanResult>> => {
    const response = await apiClient.post<ApiSuccess<WildcardLoraScanResult>>('/api/wildcards/scan-lora-folder', scanRequest)
    return response.data
  },

  getLastScanLog: async (): Promise<ApiSuccess<WildcardLoraScanLog | null>> => {
    const response = await apiClient.get<ApiSuccess<WildcardLoraScanLog | null>>('/api/wildcards/last-scan-log')
    return response.data
  },
}
