import { CustomDropdownListModel } from '../models/CustomDropdownList'
import { stripPromptPresetComments } from '../utils/promptComments'
import { WildcardService } from './wildcardService'
import { normalizeWorkflowNumericPromptValues } from './workflowNumericFieldPolicy'

export type WorkflowPromptFieldLike = {
  id: string
  type?: string
  jsonPath?: string
  default_value?: unknown
  dropdown_list_name?: string
  options?: unknown[]
}

export const DROPDOWN_RANDOM_OPTION_VALUE = '__random__'

/**
 * A dropdown field's choices as the generation form offers them: the items of the custom dropdown list it names
 * (`listName`), or its own options when it names none or the list is gone. Null when there is nothing to choose from.
 */
export function workflowDropdownChoices(field: WorkflowPromptFieldLike): { options: string[]; listName: string | null } | null {
  const listName = typeof field.dropdown_list_name === 'string' ? field.dropdown_list_name.trim() : ''
  const list = listName ? CustomDropdownListModel.findByName(listName) : null
  if (!list && field.type !== 'select') return null
  const options = (list ? list.items : Array.isArray(field.options) ? field.options : [])
    .filter((option): option is string => typeof option === 'string' && option.trim().length > 0 && option !== DROPDOWN_RANDOM_OPTION_VALUE)
  return options.length > 0 ? { options, listName: list ? list.name : null } : null
}

const COMFY_MODEL_PATH_INPUT_KEYS = new Set([
  'ckpt_name',
  'lora_name',
  'unet_name',
  'vae_name',
  'clip_name',
  'control_net_name',
  'style_model_name',
])

/** Normalize ComfyUI model-path separators to the same form exposed by the server object-info API. */
function normalizeComfyModelPathValue(field: WorkflowPromptFieldLike, value: string, tool: 'comfyui' | 'nai', modelPathSeparator: 'windows' | 'posix') {
  if (tool !== 'comfyui') {
    return value
  }

  const inputKey = typeof field.jsonPath === 'string'
    ? field.jsonPath.match(/\.inputs\.([^.[\]]+)$/)?.[1] ?? null
    : null

  if (!inputKey || !COMFY_MODEL_PATH_INPUT_KEYS.has(inputKey)) {
    return value
  }

  return modelPathSeparator === 'posix'
    ? value.replace(/\\/g, '/')
    : value.replace(/\//g, '\\')
}

function resolveRandomDropdownValue(field: WorkflowPromptFieldLike) {
  const dropdownListName = typeof field.dropdown_list_name === 'string' ? field.dropdown_list_name.trim() : ''
  const options = dropdownListName
    ? CustomDropdownListModel.findByName(dropdownListName)?.items
    : Array.isArray(field.options) ? field.options : []

  if (!options || options.length === 0) {
    throw new Error(dropdownListName
      ? `드롭다운 목록에 랜덤 선택할 항목이 없어: ${dropdownListName}`
      : `드롭다운 필드에 랜덤 선택할 항목이 없어: ${field.id}`)
  }

  const candidateOptions = options.filter((option): option is string => typeof option === 'string' && option.trim().length > 0 && option !== DROPDOWN_RANDOM_OPTION_VALUE)
  if (candidateOptions.length === 0) {
    throw new Error(dropdownListName
      ? `드롭다운 목록에 랜덤 선택할 항목이 없어: ${dropdownListName}`
      : `드롭다운 필드에 랜덤 선택할 항목이 없어: ${field.id}`)
  }

  const randomIndex = Math.floor(Math.random() * candidateOptions.length)
  return candidateOptions[randomIndex] ?? candidateOptions[0]
}

/** Resolve one prompt-data object with preprocess chains first, then wildcard parsing on text-like fields. */
export function resolveWorkflowPromptValues<T extends Record<string, any>>(
  markedFields: WorkflowPromptFieldLike[],
  promptData: T,
  tool: 'comfyui' | 'nai' = 'comfyui',
  options: { modelPathSeparator?: 'windows' | 'posix' } = {},
): T {
  const resolvedPromptData: Record<string, any> = normalizeWorkflowNumericPromptValues(markedFields, promptData)

  for (const field of markedFields) {
    if (field.type === 'image' || field.type === 'number') {
      continue
    }

    const rawValue = resolvedPromptData[field.id] ?? field.default_value
    if (typeof rawValue !== 'string') {
      if (rawValue !== undefined) {
        resolvedPromptData[field.id] = rawValue
      }
      continue
    }

    const normalizedValue = rawValue === DROPDOWN_RANDOM_OPTION_VALUE && field.type === 'select'
      ? resolveRandomDropdownValue(field)
      : normalizeComfyModelPathValue(field, rawValue, tool, options.modelPathSeparator ?? 'windows')

    if (field.type === 'select') {
      resolvedPromptData[field.id] = normalizedValue
      continue
    }

    const trimmedValue = normalizedValue.trim()
    resolvedPromptData[field.id] = trimmedValue.length > 0
      ? stripPromptPresetComments(WildcardService.parseWildcards(normalizedValue, tool))
      : normalizedValue
  }

  return resolvedPromptData as T
}
