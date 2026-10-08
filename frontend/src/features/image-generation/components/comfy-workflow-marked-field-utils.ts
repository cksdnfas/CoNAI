import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'

type MarkedFieldType = WorkflowMarkedField['type']

/** Turn a default value into one the next field type can hold; drops what it cannot convert. */
function convertDefaultValue(value: WorkflowMarkedField['default_value'], nextType: MarkedFieldType): WorkflowMarkedField['default_value'] {
  if (value === undefined || value === null) return undefined
  if (nextType === 'node') return value
  if (typeof value === 'object') return undefined
  if (nextType === 'number') {
    const parsed = typeof value === 'number' ? value : Number(String(value).trim())
    return String(value).trim().length > 0 && Number.isFinite(parsed) ? parsed : undefined
  }
  if (nextType === 'image') return undefined
  return String(value)
}

/**
 * Apply an editor patch to one marked field. A type change also drops the settings only the old type used
 * (number bounds, select options, image upload mode) and converts the default value, so no stale config is saved.
 */
export function applyMarkedFieldPatch(field: WorkflowMarkedField, patch: Partial<WorkflowMarkedField>): WorkflowMarkedField {
  const next = { ...field, ...patch }
  if (patch.type === undefined || patch.type === field.type) return next

  const nextType = patch.type
  if (nextType !== 'number') {
    delete next.min
    delete next.max
    delete next.step
  }
  if (nextType !== 'select') {
    delete next.options
    delete next.dropdown_list_name
  }
  if (nextType !== 'image') delete next.simple_upload_only
  if (!('default_value' in patch)) next.default_value = convertDefaultValue(field.default_value, nextType)
  return next
}

/** Add one select option; blank and duplicate values are ignored. Commas stay part of the value. */
export function addMarkedFieldOption(options: readonly string[] | undefined, rawValue: string) {
  const value = rawValue.trim()
  const current = options ?? []
  if (value.length === 0 || current.includes(value)) return [...current]
  return [...current, value]
}

/** Match a marked field against the field-list search (label, JSON path, source node title). */
export function markedFieldMatchesQuery(field: WorkflowMarkedField, query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true
  return [field.label, field.jsonPath, field.source_node_title ?? '', field.id]
    .join(' ')
    .toLowerCase()
    .includes(normalizedQuery)
}
