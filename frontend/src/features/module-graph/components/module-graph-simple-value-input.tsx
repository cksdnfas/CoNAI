import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type ModuleGraphSimpleValueInputProps = {
  dataType: 'select' | 'number' | 'boolean' | 'text' | 'prompt' | 'json'
  value: unknown
  onChange: (value: unknown) => void
  options?: string[]
  placeholder?: string
  emptyLabel?: string
  className?: string
  rows?: number
  min?: number
  max?: number
}

/** Render one small shared value editor for the common scalar module-graph field types. */
export function ModuleGraphSimpleValueInput({
  dataType,
  value,
  onChange,
  options,
  placeholder,
  emptyLabel = '기본값 사용',
  className,
  rows,
  min,
  max,
}: ModuleGraphSimpleValueInputProps) {
  if (dataType === 'select') {
    return (
      <Select
        value={typeof value === 'string' ? value : value == null ? '' : String(value)}
        onChange={(event) => onChange(event.target.value)}
        className={className}
      >
        <option value="">{emptyLabel}</option>
        {(options ?? []).map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </Select>
    )
  }

  if (dataType === 'number') {
    return (
      <Input
        type="number"
        min={min}
        max={max}
        value={typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
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

  if (dataType === 'prompt' || dataType === 'json') {
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
