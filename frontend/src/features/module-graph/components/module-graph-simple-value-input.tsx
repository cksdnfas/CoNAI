import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

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

/** Render one small shared value editor for the common scalar module-graph field types. */
export function ModuleGraphSimpleValueInput({
  dataType,
  value,
  onChange,
  options,
  placeholder,
  emptyLabel = '기본값 사용',
  allowEmptyOption = true,
  className,
  rows,
  min,
  max,
  step,
}: ModuleGraphSimpleValueInputProps) {
  if (dataType === 'select') {
    return (
      <Select
        value={typeof value === 'string' ? value : value == null ? '' : String(value)}
        onChange={(event) => onChange(event.target.value)}
        className={className}
      >
        {allowEmptyOption ? <option value="">{emptyLabel}</option> : null}
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
        <option value="">{emptyLabel}</option>
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
