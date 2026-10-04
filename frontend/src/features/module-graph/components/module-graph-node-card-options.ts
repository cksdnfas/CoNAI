import type { LlmProfileOptionRecord } from '@/lib/api-external-api'
import type { ModuleGraphSelectOption } from './module-graph-simple-value-input'

type ModelDefaultSource = {
  default_value?: unknown
}

type ModelUiFieldSource = {
  data_type?: string
  default_value?: unknown
  options?: ModuleGraphSelectOption[] | null
}

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function getSelectOptionValue(option: ModuleGraphSelectOption) {
  return typeof option === 'string' ? option : option.value
}

export function normalizeSelectOptions(options: ModuleGraphSelectOption[] | null | undefined) {
  return Array.isArray(options)
    ? options.filter((option) => getSelectOptionValue(option).trim().length > 0)
    : []
}

/** The LLM node's choices: API LLM chat profiles, shown as "name · model". */
export function getLlmProfileSelectOptions(profiles: LlmProfileOptionRecord[] | undefined) {
  return (profiles ?? []).map((profile) => ({
    value: String(profile.id),
    label: profile.model ? `${profile.name} · ${profile.model}` : profile.name,
  })) satisfies ModuleGraphSelectOption[]
}

export function resolveModelSelectValue(params: {
  currentValue: unknown
  port?: ModelDefaultSource | null
  uiField?: ModelUiFieldSource | null
  options: ModuleGraphSelectOption[]
}) {
  const { currentValue, port, uiField, options } = params
  return normalizeOptionalString(currentValue)
    ?? normalizeOptionalString(port?.default_value)
    ?? (typeof uiField?.default_value === 'string' ? uiField.default_value : null)
    ?? (options[0] ? getSelectOptionValue(options[0]) : null)
    ?? ''
}
