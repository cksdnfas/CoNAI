import { TypedFieldInput, type TypedFieldOption } from '@/features/shared-fields/typed-field-input'
import { useI18n } from '@/i18n'

export type ModuleGraphSelectOption = TypedFieldOption

type ModuleGraphSimpleValueInputProps = {
  dataType: 'select' | 'number' | 'boolean' | 'text' | 'prompt' | 'json'
  value: unknown
  onChange: (value: unknown) => void
  options?: ModuleGraphSelectOption[]
  placeholder?: string
  emptyLabel?: string
  allowEmptyOption?: boolean
  className?: string
  rows?: number
  min?: number
  max?: number
  step?: number
}

function formatModuleGraphOptionDefaultValue(value: unknown) {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (value === null || value === undefined) {
    return ''
  }

  const serialized = JSON.stringify(value)
  return serialized.length > 48 ? `${serialized.slice(0, 47)}…` : serialized
}

export function formatModuleGraphDefaultOptionLabel(t: ReturnType<typeof useI18n>['t'], value: unknown) {
  const formattedValue = formatModuleGraphOptionDefaultValue(value)
  return formattedValue
    ? t({ ko: '기본: {value}', en: 'Default: {value}' }, { value: formattedValue })
    : t({ ko: '선택', en: 'Select' })
}

/**
 * Canvas node-card adapter over TypedFieldInput: `allowEmptyOption` maps to the empty select option / empty
 * number, and prompts stay a plain textarea because caret-anchored wildcard popups drift under canvas zoom.
 */
export function ModuleGraphSimpleValueInput({ dataType, allowEmptyOption = true, ...props }: ModuleGraphSimpleValueInputProps) {
  return (
    <TypedFieldInput
      kind={dataType}
      emptyOption={dataType === 'select' ? (allowEmptyOption ? 'auto' : 'none') : undefined}
      allowEmpty={allowEmptyOption}
      promptEditor="plain"
      {...props}
    />
  )
}
