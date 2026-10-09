import { CHAT_NODE_OPTION_SOURCES } from './node-option-sources-chat'
import { LLM_NODE_OPTION_SOURCES } from './node-option-sources-llm'

/** One choice of a node select (`ModuleUiFieldDefinition.options_source`). */
export type NodeOption = {
  value: string
  label: string
  /** Shown but not pickable (e.g. a profile that is off); a saved value still displays. */
  disabled?: boolean
  /** The value used when the field is left empty (e.g. the ★ default model row). */
  is_default?: boolean
}

/** Who is asking: account-scoped lists (lorebooks, chat rooms) only show what this account owns. */
export type NodeOptionContext = {
  accountId: number | null
}

export type NodeOptionSource = (context: NodeOptionContext) => NodeOption[] | Promise<NodeOption[]>

export const NODE_OPTION_SOURCES: Record<string, NodeOptionSource> = {
  ...LLM_NODE_OPTION_SOURCES,
  ...CHAT_NODE_OPTION_SOURCES,
}
