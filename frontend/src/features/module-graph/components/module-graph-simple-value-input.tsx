import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'

export type ModuleGraphSelectOption = string | { value: string; label: string }

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

/** Render one small shared value editor for the common scalar module-graph field types. */
export function ModuleGraphSimpleValueInput({
  dataType,
  value,
  onChange,
  options,
  placeholder,
  emptyLabel,
  allowEmptyOption = true,
  className,
  rows,
  min,
  max,
  step,
}: ModuleGraphSimpleValueInputProps) {
  const { t } = useI18n()
  const resolvedEmptyLabel = emptyLabel ?? t({ ko: '선택', en: 'Select' })
  if (dataType === 'select') {
    return (
      <Select
        value={typeof value === 'string' ? value : value == null ? '' : String(value)}
        onChange={(event) => onChange(event.target.value)}
        className={className}
      >
        {allowEmptyOption ? <option value="">{resolvedEmptyLabel}</option> : null}
        {(options ?? []).map((option) => {
          const resolvedOption = typeof option === 'string'
            ? { value: option, label: option }
            : option

          return <option key={resolvedOption.value} value={resolvedOption.value}>{resolvedOption.label}</option>
        })}
      </Select>
    )
  }

  if (dataType === 'number') {
    return (
      <ScrubbableNumberInput
        min={min}
        max={max}
        step={typeof step === 'number' ? step : 1}
        value={typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''}
        onChange={(nextValue) => onChange(nextValue === '' ? '' : Number(nextValue))}
        placeholder={placeholder}
        className={className}
      />
    )
  }

  if (dataType === 'boolean') {
    return (
      <Select
        value={typeof value === 'boolean' ? String(value) : ''}
        onChange={(event) => {
          const nextValue = event.target.value
          onChange(nextValue === '' ? '' : nextValue === 'true')
        }}
        className={className}
      >
        <option value="">{resolvedEmptyLabel}</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </Select>
    )
  }

  if (dataType === 'prompt' || dataType === 'json' || (dataType === 'text' && (rows ?? 0) > 1)) {
    return (
      <Textarea
        rows={rows ?? (dataType === 'json' ? 6 : 4)}
        value={typeof value === 'string' ? value : value ? JSON.stringify(value, null, 2) : ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={className}
      />
    )
  }

  return (
    <Input
      value={typeof value === 'string' ? value : value ? String(value) : ''}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={className}
    />
  )
}
