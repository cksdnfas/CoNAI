export type SearchScope = 'positive' | 'negative' | 'auto' | 'rating'
export type SearchOperator = 'OR' | 'AND' | 'NOT'

export interface SearchChip {
  id: string
  scope: SearchScope
  operator: SearchOperator
  label: string
  value: string
  minScore?: number
  maxScore?: number | null
  color?: string | null
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
  created_at: string
  updated_at: string
}
