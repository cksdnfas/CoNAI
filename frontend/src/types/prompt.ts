export type PromptTypeFilter = 'positive' | 'negative' | 'auto'
export type PromptSortBy = 'usage_count' | 'created_at' | 'prompt'
export type PromptSortOrder = 'ASC' | 'DESC'

export interface PromptGroupRecord {
  id: number
  group_name: string
  description?: string | null
  is_visible: boolean
  display_order: number
  parent_id: number | null
  created_at: string
  updated_at: string
  prompt_count?: number
}

export interface PromptCollectionItem {
  id: number
  prompt: string
  usage_count: number
  group_id: number | null
  synonyms: string[]
  type: 'positive' | 'negative' | 'auto'
  created_at?: string
  updated_at?: string
}

export interface PromptSearchPayload {
  items: PromptCollectionItem[]
  groupInfo?: PromptGroupRecord | null
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface PromptStatistics {
  total_prompts: number
  total_negative_prompts: number
  total_auto_prompts: number
  most_used_prompts: PromptCollectionItem[]
  recent_prompts: PromptCollectionItem[]
}
