import type { PromptGroupRecord, PromptRecord } from '@/services/prompt-api'

export type PromptExplorerType = 'positive' | 'negative' | 'auto'

export interface PromptGroupWithChildren extends PromptGroupRecord {
  id: number
  children: PromptGroupWithChildren[]
}

export interface GroupedPromptResult {
  id: number | 'ungrouped'
  name: string
  prompts: PromptRecord[]
}
