import { useQuery } from '@tanstack/react-query'
import { TypedFieldInput, type TypedFieldOption } from '@/features/shared-fields/typed-field-input'
import { useI18n } from '@/i18n'
import type { GraphNodeOption } from '@/lib/api-module-graph'
import { graphNodeOptionsQuery, toStoredOptionValue as toStoredValue } from '../module-graph-node-option-values'
import { hasMeaningfulValue } from './module-graph-field-shared'
import { NodeSelectControl } from './module-graph-node-controls'
import { formatModuleGraphDefaultOptionLabel } from './module-graph-simple-value-input'

type Translate = ReturnType<typeof useI18n>['t']

/** Live choices of a select whose ui field names an `options_source` (model rows, chat profiles, presets…). */
export function useModuleGraphNodeOptions(source: string | null | undefined) {
  return useQuery({ ...graphNodeOptionsQuery(source ?? ''), enabled: Boolean(source) })
}

type OptionSourceFieldProps = {
  source: string
  value: unknown
  onChange: (value: string | number) => void
  /** Ids are stored as numbers; other fields keep the option value as text. */
  numeric: boolean
  required?: boolean
  defaultValue?: unknown
}

/**
 * The empty choice: an empty entry the list names itself ("기본"), else the module default the node runs with when
 * left empty, else the default the list marks (`★ gemma-4 · strata`), else "선택" for a required pick and "없음" for
 * an optional one.
 */
function resolveEmptyLabel(t: Translate, options: GraphNodeOption[] | undefined, isLoading: boolean, required: boolean, defaultValue: unknown) {
  if (isLoading) return t({ ko: '불러오는 중', en: 'Loading' })
  const namedEmpty = options?.find((option) => option.value === '')
  if (namedEmpty) return namedEmpty.label
  if (hasMeaningfulValue(defaultValue)) return formatModuleGraphDefaultOptionLabel(t, defaultValue)
  const defaultOption = options?.find((option) => option.is_default)
  if (defaultOption) return `★ ${defaultOption.label}`
  return required ? t({ ko: '선택', en: 'Select' }) : t({ ko: '없음', en: 'None' })
}

/** The list as select options; a saved value that is no longer in it stays visible as a disabled "없는 항목". */
function buildFieldOptions(t: Translate, options: GraphNodeOption[] | undefined, value: unknown, isLoaded: boolean): TypedFieldOption[] {
  const fieldOptions: TypedFieldOption[] = (options ?? [])
    .filter((option) => option.value !== '')
    .map((option) => ({ value: option.value, label: option.label, disabled: option.disabled }))
  const current = value === undefined || value === null ? '' : String(value)
  if (isLoaded && current && !fieldOptions.some((option) => typeof option !== 'string' && option.value === current)) {
    fieldOptions.unshift({ value: current, label: t({ ko: '없는 항목 ({value})', en: 'Missing ({value})' }, { value: current }), disabled: true })
  }
  return fieldOptions
}

function useOptionSourceField({ source, value, required = false, defaultValue }: OptionSourceFieldProps) {
  const { t } = useI18n()
  const query = useModuleGraphNodeOptions(source)
  return {
    options: buildFieldOptions(t, query.data, value, query.isSuccess),
    emptyLabel: resolveEmptyLabel(t, query.data, query.isLoading, required, defaultValue),
  }
}

/** A node-card select over an option source. */
export function NodeOptionSourceSelect({ ariaLabel, ...props }: OptionSourceFieldProps & { ariaLabel: string }) {
  const { options, emptyLabel } = useOptionSourceField(props)
  return (
    <NodeSelectControl
      ariaLabel={ariaLabel}
      value={props.value}
      options={options}
      onChange={(raw) => props.onChange(toStoredValue(raw, props.numeric))}
      emptyLabel={emptyLabel}
      className="w-full"
    />
  )
}

/** The side-panel select over an option source (phones edit these here). */
export function OptionSourceFieldInput(props: OptionSourceFieldProps) {
  const { options, emptyLabel } = useOptionSourceField(props)
  return (
    <TypedFieldInput
      kind="select"
      value={props.value === undefined || props.value === null ? '' : String(props.value)}
      onChange={(raw) => props.onChange(toStoredValue(typeof raw === 'string' ? raw : String(raw ?? ''), props.numeric))}
      options={options}
      emptyLabel={emptyLabel}
      emptyOption="selectable"
    />
  )
}
