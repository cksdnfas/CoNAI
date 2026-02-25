import { apiClient } from '@/lib/api/client'

export interface Wildcard {
  id: number
  name: string
  description?: string
  parent_id: number | null
  include_children: number
  only_children: number
  type: 'wildcard' | 'chain'
  chain_option: 'replace' | 'append'
  created_date: string
  updated_date: string
}

export interface WildcardItem {
  id: number
  wildcard_id: number
  tool: 'comfyui' | 'nai'
  content: string
  weight: number
  order_index: number
  created_date: string
}

export interface WildcardWithItems extends Wildcard {
  items: WildcardItem[]
}

export const wildcardApi = {
  getAllWildcards: async (withItems = true): Promise<{ success: boolean; data: WildcardWithItems[] }> => {
    const response = await apiClient.get<{ success: boolean; data: WildcardWithItems[] }>('/api/wildcards', {
      params: { withItems },
    })
    return response.data
  },
}
