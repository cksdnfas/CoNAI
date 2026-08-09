import type { ModuleDefinitionRecord } from '@/lib/api-module-graph'
import type { ModuleGraphNode } from '../module-graph-shared'
import { getModuleOperationKey } from '../module-graph-shared'
import {
  getApiRequestDynamicInputPortKeys,
  getRandomTextChoiceDynamicInputPortKeys,
} from './module-graph-node-card-layouts'

export type ModuleGraphNodeLayoutKey =
  | 'default'
  | 'text-merge'
  | 'random-text-choice'
  | 'text-transform'
  | 'condition-select'
  | 'if-branch'
  | 'api-request'

export type ModuleGraphNodeCustomControlKey =
  | 'llm-model'
  | 'codex-model'
  | 'llm-preset'
  | 'nai-model'
  | 'comfy-target'

/** Operation aliases live here so the node-card body stays independent from module-specific branching. */
interface ModuleGraphNodeOperationRegistration {
  layoutKey: ModuleGraphNodeLayoutKey
  resolveDynamicInputPortKeys?: (data: ModuleGraphNode['data']) => string[]
}

const LEGACY_API_REQUEST_REGISTRATION: ModuleGraphNodeOperationRegistration = {
  layoutKey: 'api-request',
  resolveDynamicInputPortKeys: getApiRequestDynamicInputPortKeys,
}

export const MODULE_GRAPH_NODE_LAYOUT_REGISTRY: Readonly<Record<string, ModuleGraphNodeOperationRegistration>> = {
  'system.merge_text': { layoutKey: 'text-merge' },
  'system.random_text_choice': {
    layoutKey: 'random-text-choice',
    resolveDynamicInputPortKeys: getRandomTextChoiceDynamicInputPortKeys,
  },
  'system.regex_text_transform': { layoutKey: 'text-transform' },
  'system.logic_condition_select': { layoutKey: 'condition-select' },
  'system.logic_if_branch': { layoutKey: 'if-branch' },
  'system.api_request': LEGACY_API_REQUEST_REGISTRATION,
}

export const MODULE_GRAPH_NODE_CUSTOM_CONTROL_REGISTRY: Readonly<Record<string, readonly ModuleGraphNodeCustomControlKey[]>> = {
  'system.call_llm': ['llm-model'],
  'system.call_codex_message': ['codex-model'],
  'system.load_llm_preset': ['llm-preset'],
  'system.generate_image_nai': ['nai-model'],
}

function resolveModuleGraphNodeOperationRegistration(module: ModuleDefinitionRecord) {
  const operationKey = getModuleOperationKey(module)
  if (operationKey && MODULE_GRAPH_NODE_LAYOUT_REGISTRY[operationKey]) return MODULE_GRAPH_NODE_LAYOUT_REGISTRY[operationKey]

  // Preserve the legacy API Request definition that predates operation keys.
  if (module.engine_type === 'system' && module.name === 'API 요청') return LEGACY_API_REQUEST_REGISTRATION

  return null
}

export function resolveModuleGraphNodeLayout(module: ModuleDefinitionRecord): ModuleGraphNodeLayoutKey {
  return resolveModuleGraphNodeOperationRegistration(module)?.layoutKey ?? 'default'
}

export function resolveModuleGraphNodeDynamicInputPortKeys(module: ModuleDefinitionRecord, data: ModuleGraphNode['data']) {
  return resolveModuleGraphNodeOperationRegistration(module)?.resolveDynamicInputPortKeys?.(data) ?? []
}

export function resolveModuleGraphNodeCustomControls(module: ModuleDefinitionRecord): ReadonlySet<ModuleGraphNodeCustomControlKey> {
  const operationKey = getModuleOperationKey(module)
  const controls = new Set<ModuleGraphNodeCustomControlKey>(operationKey ? MODULE_GRAPH_NODE_CUSTOM_CONTROL_REGISTRY[operationKey] ?? [] : [])

  if (module.engine_type === 'nai') {
    controls.add('nai-model')
  }
  if (module.engine_type === 'comfyui') {
    controls.add('comfy-target')
  }

  return controls
}
