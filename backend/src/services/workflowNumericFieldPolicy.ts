export type WorkflowNumericFieldLike = {
  id: string
  label?: string
  type?: string
  default_value?: unknown
  min?: unknown
  max?: unknown
  step?: unknown
}

export class WorkflowNumericFieldValidationError extends Error {
  readonly fieldId: string

  constructor(field: WorkflowNumericFieldLike, message: string) {
    const fieldLabel = typeof field.label === 'string' && field.label.trim().length > 0
      ? field.label.trim()
      : field.id
    super(`Numeric workflow field "${fieldLabel}" ${message}`)
    this.name = 'WorkflowNumericFieldValidationError'
    this.fieldId = field.id
  }
}

function readFiniteBound(field: WorkflowNumericFieldLike, key: 'min' | 'max' | 'step') {
  const value = field[key]
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new WorkflowNumericFieldValidationError(field, `has an invalid ${key} constraint`)
  }

  return value
}

/** Return a validation message when marked-field numeric constraints are inconsistent. */
export function getWorkflowNumericFieldDefinitionError(markedFields: unknown): string | null {
  if (markedFields === undefined || markedFields === null) {
    return null
  }

  if (!Array.isArray(markedFields)) {
    return 'marked_fields must be an array'
  }

  for (const candidate of markedFields) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return 'marked_fields entries must be objects'
    }

    const field = candidate as WorkflowNumericFieldLike
    if (field.type !== 'number') {
      continue
    }

    if (typeof field.id !== 'string' || field.id.trim().length === 0) {
      return 'Numeric workflow fields must have a non-empty id'
    }

    try {
      const min = readFiniteBound(field, 'min')
      const max = readFiniteBound(field, 'max')
      const step = readFiniteBound(field, 'step')

      if (min !== undefined && max !== undefined && min > max) {
        return new WorkflowNumericFieldValidationError(field, 'must have min less than or equal to max').message
      }

      if (step !== undefined && step <= 0) {
        return new WorkflowNumericFieldValidationError(field, 'must have step greater than zero').message
      }
    } catch (error) {
      if (error instanceof WorkflowNumericFieldValidationError) {
        return error.message
      }
      throw error
    }
  }

  return null
}

/** Parse and clamp one number field value without applying step alignment. */
export function normalizeWorkflowNumericFieldValue(field: WorkflowNumericFieldLike, value: unknown) {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim().length > 0
      ? Number(value)
      : Number.NaN

  if (!Number.isFinite(numericValue)) {
    throw new WorkflowNumericFieldValidationError(field, 'must be a finite number')
  }

  const min = readFiniteBound(field, 'min')
  const max = readFiniteBound(field, 'max')
  if (min !== undefined && max !== undefined && min > max) {
    throw new WorkflowNumericFieldValidationError(field, 'must have min less than or equal to max')
  }
  let normalizedValue = numericValue

  if (min !== undefined) {
    normalizedValue = Math.max(min, normalizedValue)
  }
  if (max !== undefined) {
    normalizedValue = Math.min(max, normalizedValue)
  }

  return normalizedValue
}

/** Normalize every numeric marked-field value while preserving unrelated prompt data. */
export function normalizeWorkflowNumericPromptValues<T extends Record<string, any>>(
  markedFields: WorkflowNumericFieldLike[],
  promptData: T,
): T {
  const normalizedPromptData: Record<string, any> = { ...promptData }

  for (const field of markedFields) {
    if (field.type !== 'number' || typeof field.id !== 'string' || field.id.length === 0) {
      continue
    }

    const rawValue = normalizedPromptData[field.id] ?? field.default_value
    if (rawValue === undefined || rawValue === null) {
      continue
    }

    normalizedPromptData[field.id] = normalizeWorkflowNumericFieldValue(field, rawValue)
  }

  return normalizedPromptData as T
}
