import type { ExternalApiLlmOptionRecord } from '@/lib/api-external-api'
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

export function getLlmModelBindings(providers: ExternalApiLlmOptionRecord[] | undefined) {
  return (providers ?? [])
    .map((provider) => ({
      ...provider,
      default_model: normalizeOptionalString(provider.default_model),
    }))
    .filter((provider): provider is ExternalApiLlmOptionRecord & { default_model: string } => Boolean(provider.default_model))
    .sort((left, right) => left.provider_name.localeCompare(right.provider_name))
}

export function getLlmModelOptions(bindings: Array<ExternalApiLlmOptionRecord & { default_model: string }>) {
  return bindings.map((provider) => ({
    value: provider.provider_name,
    label: `${provider.provider_name} · ${provider.default_model}`,
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
