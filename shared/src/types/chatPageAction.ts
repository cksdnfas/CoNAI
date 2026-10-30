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
export type ChatPageAction = {
  id: string; label: string; description: string; effect: 'draft' | 'save'; schema: ChatPageSchema
  /** Explicit opt-in only after all consumed state is represented by fields, selected, inputRevision or targets. */
  revisionScope?: 'action'
  /** Omitted: all non-view fields, including read-only inputs. Empty: consumes no form inputs. */
  inputFields?: string[]
  /** Bind an argument's target to these keys of its row in page.data, not the rest of the collection. */
  targets?: Array<{ argument: string; collection: string; id: string; keys: string[] }>
  /** Extension-only; checked against the server manifest. */
  tier?: 'view' | 'draft'
}
export type ChatPageActionProposal = {
  kind: 'page_action'; page: ChatPageTarget; revision: string; action: ChatPageAction
  arguments: Record<string, ChatPageData>; before: ChatPageData; expiresAt: number; saved?: boolean
  nativeRevision?: string
  /** Only explicitly opted-in actions compare before; all other cards require the exact page revision. */
  revisionScope?: 'action'
}
