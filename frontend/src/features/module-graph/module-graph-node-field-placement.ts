import type { ModulePortDefinition, ModuleUiFieldDefinition } from '@/lib/api-module-graph'
import { getModuleOperationKey } from './module-graph-module-helpers'
import type { ModuleGraphNode } from './module-graph-types'

/** Inputs a node card edits with its own controls (preset pickers) instead of a plain row. */
const NODE_CONTROL_KEYS: Readonly<Record<string, readonly string[]>> = {
  'system.load_llm_preset': ['preset_type', 'preset_name'],
}

/**
 * Whether a value is edited right on the node card (selects, live-list pickers, numbers, switches, one-line text and
 * the node's own pickers). The side panel leaves those out so one value never has two editors; long text, JSON,
 * images, lists and composite editors stay in the panel.
 */
export function isEditedOnNodeCard(node: ModuleGraphNode, port: Pick<ModulePortDefinition, 'key' | 'data_type'>, uiField?: ModuleUiFieldDefinition | null) {
  const operationKey = getModuleOperationKey(node.data.module)
  if (operationKey && NODE_CONTROL_KEYS[operationKey]?.includes(port.key)) return true
  if (uiField?.options_source) return true
  if (node.data.module.engine_type === 'nai' && port.key === 'model') return true
  if (uiField?.data_type === 'select' && Array.isArray(uiField.options) && uiField.options.length > 0) return true
  if (port.data_type === 'number' || port.data_type === 'boolean') return true
  if (uiField?.data_type === 'number' || uiField?.data_type === 'boolean') return true
  return port.data_type === 'text' && uiField?.ui_hint === 'inline'
}
