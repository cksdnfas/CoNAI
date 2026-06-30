import type {
  ModuleDefinitionRecord,
  ModulePortDataType,
} from '@/lib/api-module-graph'
import type { ModuleGraphNode, ModuleGraphNodeData } from './module-graph-types'

const PORT_TYPE_COLORS: Record<ModulePortDataType, string> = {
  image: '#4fc3f7',
  mask: '#ffb74d',
  prompt: '#4db6ac',
  text: '#81c784',
  number: '#ffd54f',
  boolean: '#ef9a9a',
  json: '#90a4ae',
  any: '#b0bec5',
}

const GENERIC_MODULE_PORT_DESCRIPTIONS = new Set([
  '노드 안에 저장해둘 텍스트 값이야.',
  '노드 안에 저장해둘 JSON 값이야.',
  '노드 안에 저장해둘 이미지야.',
  '노드 안에 저장해둘 숫자 값이야.',
  '노드 안에 저장해둘 참/거짓 값이야.',
])

/** Resolve one stable system-operation key from module metadata when present. */
export function getModuleOperationKey(module: ModuleDefinitionRecord) {
  if (typeof module.internal_fixed_values?.operation_key === 'string') {
    return module.internal_fixed_values.operation_key
  }

  if (typeof module.template_defaults?.operation_key === 'string') {
    return module.template_defaults.operation_key
  }

  return null
}

/** Resolve whether one module is the built-in explicit final-result marker. */
export function isFinalResultModule(module: ModuleDefinitionRecord) {
  return module.engine_type === 'system' && getModuleOperationKey(module) === 'system.final_result'
}

/** Resolve a visible color for module nodes when the module does not define one. */
export function getModuleColor(module: ModuleDefinitionRecord) {
  if (module.color) {
    return module.color
  }

  if (module.engine_type === 'nai') {
    return '#7c4dff'
  }

  if (module.engine_type === 'codex') {
    return '#26a69a'
  }

  if (module.engine_type === 'comfyui') {
    return '#2196f3'
  }

  if (module.engine_type === 'custom_js') {
    return '#ff8a65'
  }

  return '#26a69a'
}

/** Resolve a stable accent color for one module port data type. */
export function getPortTypeColor(dataType: ModulePortDataType) {
  return PORT_TYPE_COLORS[dataType]
}

/** Hide boilerplate per-port help copy so node cards and runners stay concise. */
export function normalizeModulePortDescription(description?: string | null) {
  const trimmedDescription = typeof description === 'string' ? description.trim() : ''
  if (!trimmedDescription || GENERIC_MODULE_PORT_DESCRIPTIONS.has(trimmedDescription)) {
    return undefined
  }

  return trimmedDescription
}

/** Normalize legacy/built-in system node names into the user-facing names we want to keep. */
export function getModuleBaseDisplayName(module: ModuleDefinitionRecord) {
  const operationKey = getModuleOperationKey(module)
  if (operationKey === 'system.constant_text' || operationKey === 'system.constant_prompt') {
    return '텍스트'
  }
  if (operationKey === 'system.constant_json') {
    return 'JSON'
  }
  if (operationKey === 'system.constant_image') {
    return '이미지'
  }
  if (operationKey === 'system.constant_number') {
    return '숫자'
  }
  if (operationKey === 'system.constant_boolean') {
    return '불리언'
  }
  if (operationKey === 'system.merge_text') {
    return '텍스트 합치기'
  }
  if (operationKey === 'system.random_text_choice') {
    return '랜덤 항목 출력'
  }

  return module.name
}

/** Resolve the user-visible node name, preferring one custom label when present. */
export function getModuleNodeDisplayLabelFromData(data: ModuleGraphNodeData) {
  const trimmedLabel = typeof data.label === 'string' ? data.label.trim() : ''
  return trimmedLabel || getModuleBaseDisplayName(data.module)
}

/** Check whether a node is currently using one custom user-defined label. */
export function hasCustomModuleNodeLabel(data: ModuleGraphNodeData) {
  const trimmedLabel = typeof data.label === 'string' ? data.label.trim() : ''
  return trimmedLabel.length > 0 && trimmedLabel !== getModuleBaseDisplayName(data.module)
}

/** Resolve the visible node name from one graph node. */
export function getModuleNodeDisplayLabel(node: ModuleGraphNode) {
  return getModuleNodeDisplayLabelFromData(node.data)
}
