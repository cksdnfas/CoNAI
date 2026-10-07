import type { ChatWorkflowSnapshot } from './chatWorkflow'

/** Only explicitly registered CoNAI form state is shared with a chat. */
export type ChatPageValue = string | number | boolean | string[]

export type ChatPageField = {
  id: string
  label: string
  type: 'text' | 'number' | 'select' | 'boolean'
  value: ChatPageValue
  /** False for visible context that may be read but never changed by a proposal. */
  editable?: false
  min?: number
  max?: number
  integer?: boolean
  multipleOf?: number
  allowEmpty?: boolean
  options?: string[]
}

export type ChatPageSnapshot = {
  instanceId: string
  connectionId: string
  path: string
  title: string
  kind: 'page' | 'nai' | 'comfyui' | 'library' | 'prompt_search' | 'metadata' | 'workflow'
  resourceId: string | null
  fields: ChatPageField[]
  workflow?: ChatWorkflowSnapshot
}

export type ChatPageChange = {
  fieldId: string
  label: string
  before: ChatPageValue
  value: ChatPageValue
}

export type ChatPageProposal = {
  kind: 'page_fields'
  page: Omit<ChatPageSnapshot, 'fields' | 'workflow'>
  changes: ChatPageChange[]
  expiresAt: number
  saved?: boolean
}
