/** Only explicitly registered CoNAI form state is shared with a chat. */
export type ChatPageValue = string | number | boolean | string[]

export type ChatPageField = {
  id: string
  label: string
  type: 'text' | 'number' | 'select' | 'boolean'
  value: ChatPageValue
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
  kind: 'page' | 'nai' | 'comfyui'
  resourceId: string | null
  fields: ChatPageField[]
}

export type ChatPageChange = {
  fieldId: string
  label: string
  before: ChatPageValue
  value: ChatPageValue
}

export type ChatPageProposal = {
  kind: 'page_fields'
  page: Omit<ChatPageSnapshot, 'fields'>
  changes: ChatPageChange[]
  expiresAt: number
  saved?: boolean
}
