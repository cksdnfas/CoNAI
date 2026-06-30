import { ModuleGraphSimpleValueInput } from '../module-graph-simple-value-input'
import { useI18n } from '@/i18n'
import type { ModuleUiFieldDefinition } from '@/lib/api-module-graph'
import type { ModuleGraphNode } from '../../module-graph-shared'
import { MODULE_GRAPH_INLINE_CONTROL_CLASS, stopNodeInteraction } from '../module-graph-port-cells'

/** Resolve one inline UI-field string value from node state with a default fallback. */
export function getInlineUiFieldValue(rawValue: unknown, field?: ModuleUiFieldDefinition | null) {
  if (typeof rawValue === 'string') {
    return rawValue
  }

  if (typeof field?.default_value === 'string') {
    return field.default_value
  }

  return rawValue == null ? '' : String(rawValue)
}

function getCompactUiFieldInputType(field: ModuleUiFieldDefinition): 'select' | 'number' | 'boolean' | 'text' {
  if (field.data_type === 'select') {
    return 'select'
  }

  if (field.data_type === 'number') {
    return 'number'
  }

  if (field.data_type === 'boolean') {
    return 'boolean'
  }

  return 'text'
}

export function renderCompactUiField({
  id,
  data,
  field,
  value,
  allowEmptyOption = true,
  t,
}: {
  id: string
  data: ModuleGraphNode['data']
  field: ModuleUiFieldDefinition
  value?: unknown
  allowEmptyOption?: boolean
  t: ReturnType<typeof useI18n>['t']
}) {
  const normalizedValue = value ?? data.inputValues?.[field.key] ?? field.default_value

  return (
    <label key={field.key} className="nodrag nowheel flex min-h-[28px] items-center gap-2 border-b border-border/30 px-1 pb-1" onMouseDown={stopNodeInteraction} title={field.description || field.label}>
      <span className="shrink-0 text-[11px] font-medium text-foreground">{field.label}</span>
      <div className="min-w-0 flex-1" onMouseDown={stopNodeInteraction}>
        <ModuleGraphSimpleValueInput
          dataType={getCompactUiFieldInputType(field)}
          value={normalizedValue}
          onChange={(nextValue) => data.onNodeValueChange?.(id, field.key, nextValue)}
          options={field.options ?? []}
          placeholder={field.placeholder || field.description || field.label}
          emptyLabel={t({ ko: '선택', en: 'Select' })}
          allowEmptyOption={allowEmptyOption}
          className={`h-7 min-w-0 flex-1 text-[11px] ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
        />
      </div>
    </label>
  )
}
