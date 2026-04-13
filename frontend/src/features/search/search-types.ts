export type SearchScope = 'positive' | 'negative' | 'auto' | 'rating' | 'model' | 'lora' | 'tool'
export type SearchOperator = 'OR' | 'AND' | 'NOT'
export type SearchAiToolGroup = 'nai' | 'comfyui' | 'other'

export interface SearchChip {
  id: string
  scope: SearchScope
  operator: SearchOperator
  label: string
  value: string
  minScore?: number
  maxScore?: number | null
  color?: string | null
  scopeLabel?: string
  conditionCategory?: string
  conditionType?: string
}

export interface SearchHistoryEntry {
  id: string
  label: string
  chips: SearchChip[]
  createdAt: string
  updatedAt: string
}

export interface RatingTierRecord {
  id: number
  tier_name: string
  min_score: number
  max_score: number | null
  tier_order: number
  color?: string | null
  feed_visibility?: 'show' | 'blur' | 'hide'
  created_at: string
  updated_at: string
}

export interface SearchMetadataSuggestion {
  value: string
  count: number
}

export interface SearchAiToolOption {
  value: SearchAiToolGroup
  label: string
  aliases: string[]
}
