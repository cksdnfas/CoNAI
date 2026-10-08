import type { ChatWorkflowSnapshot } from './chatWorkflow'
import type { ChatPageAction, ChatPageData } from './chatPageAction'

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
  kind: 'page' | 'nai' | 'codex' | 'comfyui' | 'comfy_author' | 'library' | 'prompt_search' | 'presets' | 'wildcards' | 'metadata' | 'workflow' | 'workflow_runner' | 'groups' | 'files' | 'upload' | 'settings' | 'wallpaper' | 'image_detail' | 'audio' | 'sprite'
  resourceId: string | null
  fields: ChatPageField[]
  workflow?: ChatWorkflowSnapshot
  revision?: string
  actions?: ChatPageAction[]
  data?: Record<string, ChatPageData>
}

export type ChatPageTarget = Pick<ChatPageSnapshot, 'instanceId' | 'connectionId' | 'path' | 'title' | 'kind' | 'resourceId'>

export type ChatPageChange = {
  fieldId: string
  label: string
  before: ChatPageValue
  value: ChatPageValue
}

export type ChatPageProposal = {
  kind: 'page_fields'
  page: ChatPageTarget
  changes: ChatPageChange[]
  expiresAt: number
  saved?: boolean
}
