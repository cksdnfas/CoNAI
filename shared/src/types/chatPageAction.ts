import type { ChatPageTarget } from './chatPage'

export type ChatPageData = string | number | boolean | null | ChatPageData[] | { [key: string]: ChatPageData }
/** A bounded JSON schema, supplied by a registered app adapter, never executable code. */
export type ChatPageSchema = {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description?: string
  enum?: Array<string | number>
  minimum?: number
  maximum?: number
  integer?: boolean
  maxLength?: number
  minItems?: number
  maxItems?: number
  properties?: Record<string, ChatPageSchema>
  required?: string[]
  items?: ChatPageSchema
}
export type ChatPageAction = { id: string; label: string; description: string; effect: 'draft' | 'save'; schema: ChatPageSchema }
export type ChatPageActionProposal = {
  kind: 'page_action'; page: ChatPageTarget; revision: string; action: ChatPageAction
  arguments: Record<string, ChatPageData>; before: ChatPageData; expiresAt: number; saved?: boolean
  nativeRevision?: string
}
