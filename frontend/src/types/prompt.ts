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
  group_info?: PromptGroupRecord | null
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

export interface PromptGroupResolveItem {
  query: string
  matched_prompt: string | null
  group_info?: PromptGroupRecord | { id: 0; group_name: 'Unclassified' } | null
}

export interface PromptStatistics {
  total_prompts: number
  total_negative_prompts: number
  total_auto_prompts: number
  most_used_prompts: PromptCollectionItem[]
  recent_prompts: PromptCollectionItem[]
}

export interface PromptGroupImportData {
  id?: number
  group_name: string
  display_order: number
  is_visible: boolean
  parent_id: number | null
}

export interface PromptBackupItem {
  prompt: string
  usage_count: number
  group_id: number | null
  synonyms?: string[] | null
}

export interface PromptGroupExportData {
  version?: '2.0'
  groups: PromptGroupImportData[]
  prompts?: PromptBackupItem[]
  metadata: {
    export_date: string
    total_groups: number
    total_prompts?: number
    type: 'positive' | 'negative' | 'auto'
  }
}

export interface PromptGroupImportResult {
  success: boolean
  reassigned_groups: { old_id: number; new_id: number; group_name: string }[]
  updated_prompts: number
  message: string
}
