import type { TranslationInput, TranslationParams } from '@/i18n'
import type { ModuleDefinitionRecord } from '@/lib/api-module-graph'

type TranslateFunction = (input: TranslationInput, values?: TranslationParams) => string

type ModuleGroupLabel = {
  key: string
  label: string
}

export const SYSTEM_GROUP_ORDER = ['input', 'generation', 'logic', 'utility', 'get', 'llm', 'output', 'other']
export const SAVED_MODULE_GROUP_ORDER = ['generation', 'other']
export const CUSTOM_NODE_GROUP_ORDER = ['custom-js', 'other']
export const CUSTOM_GROUP_ORDER = SAVED_MODULE_GROUP_ORDER

const MODULE_GROUP_FALLBACK_ORDER = Number.MAX_SAFE_INTEGER

function buildModuleGroupOrderIndex(groupOrder: readonly string[]) {
  return new Map(groupOrder.map((key, index) => [key, index]))
}

export const SYSTEM_GROUP_ORDER_INDEX = buildModuleGroupOrderIndex(SYSTEM_GROUP_ORDER)
export const SAVED_MODULE_GROUP_ORDER_INDEX = buildModuleGroupOrderIndex(SAVED_MODULE_GROUP_ORDER)
export const CUSTOM_NODE_GROUP_ORDER_INDEX = buildModuleGroupOrderIndex(CUSTOM_NODE_GROUP_ORDER)

/** Resolve sortable group priority without scanning order arrays inside render-sort comparators. */
export function getModuleGroupSortIndex(groupOrderIndex: ReadonlyMap<string, number>, groupKey: string) {
  return groupOrderIndex.get(groupKey) ?? MODULE_GROUP_FALLBACK_ORDER
}

const GET_MODULE_OPERATION_KEYS = new Set([
  'system.find_similar_images',
  'system.load_prompt_from_reference',
  'system.load_image_from_reference',
  'system.random_image_from_library',
  'system.random_video_from_library',
])

function toTitleCase(rawValue: string) {
  return rawValue
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/** Resolve one stable system-operation key from module metadata when present. */
export function getModuleLibraryOperationKey(module: ModuleDefinitionRecord) {
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
  return module.engine_type === 'system' && getModuleLibraryOperationKey(module) === 'system.final_result'
}

function getModuleLibraryBaseName(module: ModuleDefinitionRecord) {
  const operationKey = getModuleLibraryOperationKey(module)
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

  return module.name
}

function getNormalizedModuleName(module: ModuleDefinitionRecord) {
  return getModuleLibraryBaseName(module).trim().toLowerCase()
}

/** Resolve whether one module should be omitted from module-library create surfaces. */
export function shouldHideFromModuleLibrary(module: ModuleDefinitionRecord) {
  const operationKey = getModuleLibraryOperationKey(module)
  if (operationKey === 'system.constant_text') {
    return false
  }

  if (operationKey === 'system.constant_prompt') {
    return true
  }

  if (
    (module.engine_type === 'nai' && module.authoring_source === 'nai_form_snapshot')
    || (module.engine_type === 'codex' && module.authoring_source === 'codex_form_snapshot')
  ) {
    return true
  }

  const normalizedCategory = (module.category ?? '').trim().toLowerCase()
  const inputPort = module.exposed_inputs[0]
  const outputPort = module.output_ports[0]
  const looksLikeLegacyPromptConstant = module.engine_type === 'system'
    && normalizedCategory === 'input'
    && module.exposed_inputs.length === 1
    && module.output_ports.length === 1
    && inputPort?.key === 'prompt'
    && inputPort?.data_type === 'text'
    && outputPort?.key === 'prompt'
    && outputPort?.data_type === 'text'

  return module.name.trim() === '상수 프롬프트' || looksLikeLegacyPromptConstant
}

/** Build a user-facing group for system modules based on practical workflow role. */
export function getSystemModuleGroup(module: ModuleDefinitionRecord): ModuleGroupLabel {
  const category = (module.category ?? '').trim().toLowerCase()
  const name = getNormalizedModuleName(module)
  const operationKey = getModuleLibraryOperationKey(module)

  if (isFinalResultModule(module) || category === 'output') {
    return { key: 'output', label: 'END' }
  }

  if (category === 'generation' || operationKey === 'system.generate_image_nai' || operationKey === 'system.generate_image_codex') {
    return { key: 'generation', label: 'Generation' }
  }

  if (category === 'logic') {
    return { key: 'logic', label: 'Logic' }
  }

  if (
    category === 'input'
    || category === 'prompt-source'
    || operationKey?.startsWith('system.constant_')
    || operationKey === 'system.random_prompt_from_group'
    || name.includes('상수')
  ) {
    return { key: 'input', label: 'Input' }
  }

  if (
    category === 'image'
    || category === 'video'
    || category === 'retrieval'
    || GET_MODULE_OPERATION_KEYS.has(operationKey ?? '')
    || name.includes('찾기')
    || name.includes('불러오기')
    || name.includes('라이브러리')
  ) {
    return { key: 'get', label: 'Get' }
  }

  if (category === 'llm') {
    return { key: 'llm', label: 'LLM' }
  }

  if (category === 'analysis' || category === 'utility' || category === 'prompt' || name.includes('추출')) {
    return { key: 'utility', label: 'Utility' }
  }

  return { key: 'other', label: category ? toTitleCase(category) : 'Other' }
}

/** Build a user-facing group for saved generation modules with minimal noise. */
export function getSavedModuleGroup(module: ModuleDefinitionRecord): ModuleGroupLabel {
  const category = (module.category ?? '').trim().toLowerCase()
  if (category === 'generation' || category === 'image' || module.engine_type === 'nai' || module.engine_type === 'codex' || module.engine_type === 'comfyui') {
    return { key: 'generation', label: 'Generation' }
  }

  return { key: 'other', label: category ? toTitleCase(category) : 'Other' }
}

/** Build a user-facing group for custom-code nodes. */
export function getCustomNodeGroup(module: ModuleDefinitionRecord): ModuleGroupLabel {
  if (module.engine_type === 'custom_js' || module.authoring_source === 'custom_node_fs') {
    return { key: 'custom-js', label: 'Custom JS' }
  }

  const category = (module.category ?? '').toLowerCase()
  return { key: 'other', label: category ? toTitleCase(category) : 'Other' }
}

export const getCustomModuleGroup = getSavedModuleGroup

export function localizeModuleGroupLabel(label: string, t: TranslateFunction) {
  switch (label) {
    case 'Input':
      return t({ ko: '입력', en: 'Input' })
    case 'Get':
      return t({ ko: '가져오기', en: 'Get' })
    case 'Logic':
      return t({ ko: '로직', en: 'Logic' })
    case 'Utility':
      return t({ ko: '유틸리티', en: 'Utility' })
    case 'Generation':
      return t({ ko: '생성', en: 'Generation' })
    case 'Other':
      return t({ ko: '기타', en: 'Other' })
    case 'END':
      return t({ ko: '최종 결과', en: 'END' })
    case 'Custom JS':
      return t({ ko: '커스텀 JS', en: 'Custom JS' })
    default:
      return label
  }
}

export function isCustomNodeModule(module: ModuleDefinitionRecord) {
  return module.authoring_source === 'custom_node_fs' || module.engine_type === 'custom_js'
}

export function isGenerationModule(module: ModuleDefinitionRecord) {
  const operationKey = getModuleLibraryOperationKey(module)
  const category = (module.category ?? '').trim().toLowerCase()

  return category === 'generation'
    || module.engine_type === 'comfyui'
    || module.engine_type === 'nai'
    || module.engine_type === 'codex'
    || operationKey === 'system.generate_image_nai'
    || operationKey === 'system.generate_image_codex'
}
