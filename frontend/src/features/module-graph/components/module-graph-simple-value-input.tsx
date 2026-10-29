import type { TypedFieldOption } from '@/features/shared-fields/typed-field-input'
import { useI18n } from '@/i18n'

export type ModuleGraphSelectOption = TypedFieldOption

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
