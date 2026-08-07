export type WorkflowNumericFieldLike = {
  id: string
  label?: string
  type?: string
  default_value?: unknown
  min?: unknown
  max?: unknown
  step?: unknown
  node_editor?: string
  node_numeric_bounds?: unknown
}

const MINIMAX_H3_DIRECTOR_EDITOR = 'minimax_h3_director_dasiwa'
const MINIMAX_H3_DIRECTOR_NUMERIC_FIELDS = ['width', 'height', 'duration'] as const
const MINIMAX_H3_DIRECTOR_DURATION_MIN_SECONDS = 1
const MINIMAX_H3_DIRECTOR_DURATION_MAX_SECONDS = 60

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isComfyInputLink(value: unknown) {
  return Array.isArray(value)
    && value.length >= 2
    && (typeof value[0] === 'string' || typeof value[0] === 'number')
    && typeof value[1] === 'number'
    && Number.isInteger(value[1])
}

/** Convert one composite Director bound into the ordinary numeric-field contract. */
function buildMiniMaxDirectorNumericField(
  field: WorkflowNumericFieldLike,
  fieldKey: typeof MINIMAX_H3_DIRECTOR_NUMERIC_FIELDS[number],
  bounds: Record<string, unknown>,
): WorkflowNumericFieldLike {
  return {
    id: `${field.id}.${fieldKey}`,
    label: `${field.label || field.id} ${fieldKey}`,
    type: 'number',
    min: bounds.min,
    max: bounds.max,
  }
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
    if (field.type === 'node' && field.node_editor === MINIMAX_H3_DIRECTOR_EDITOR) {
      if (typeof field.id !== 'string' || field.id.trim().length === 0) {
        return 'Numeric workflow fields must have a non-empty id'
      }
      if (field.node_numeric_bounds === undefined || field.node_numeric_bounds === null) {
        continue
      }
      if (!isRecord(field.node_numeric_bounds)) {
        return `Numeric workflow field "${field.label || field.id}" has invalid node_numeric_bounds`
      }

      for (const fieldKey of MINIMAX_H3_DIRECTOR_NUMERIC_FIELDS) {
        const bounds = field.node_numeric_bounds[fieldKey]
        if (bounds === undefined || bounds === null) {
          continue
        }
        if (!isRecord(bounds)) {
          return `Numeric workflow field "${field.label || field.id} ${fieldKey}" has invalid bounds`
        }

        const numericField = buildMiniMaxDirectorNumericField(field, fieldKey, bounds)
        try {
          const min = readFiniteBound(numericField, 'min')
          const max = readFiniteBound(numericField, 'max')
          if (min !== undefined && max !== undefined && min > max) {
            return new WorkflowNumericFieldValidationError(numericField, 'must have min less than or equal to max').message
          }
          if (fieldKey === 'duration' && min !== undefined && (min < MINIMAX_H3_DIRECTOR_DURATION_MIN_SECONDS || min > MINIMAX_H3_DIRECTOR_DURATION_MAX_SECONDS)) {
            return new WorkflowNumericFieldValidationError(numericField, 'must have min between 1 and 60').message
          }
          if (fieldKey === 'duration' && max !== undefined && (max < MINIMAX_H3_DIRECTOR_DURATION_MIN_SECONDS || max > MINIMAX_H3_DIRECTOR_DURATION_MAX_SECONDS)) {
            return new WorkflowNumericFieldValidationError(numericField, 'must have max between 1 and 60').message
          }
        } catch (error) {
          if (error instanceof WorkflowNumericFieldValidationError) {
            return error.message
          }
          throw error
        }
      }
      continue
    }

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
    if (typeof field.id !== 'string' || field.id.length === 0) {
      continue
    }

    if (field.type === 'node' && field.node_editor === MINIMAX_H3_DIRECTOR_EDITOR) {
      const rawNodeValue = normalizedPromptData[field.id] ?? field.default_value
      if (!isRecord(rawNodeValue)) {
        continue
      }

      const nodeNumericBounds = isRecord(field.node_numeric_bounds) ? field.node_numeric_bounds : {}
      let normalizedNodeValue: Record<string, unknown> | null = null
      for (const fieldKey of MINIMAX_H3_DIRECTOR_NUMERIC_FIELDS) {
        const configuredBounds = nodeNumericBounds[fieldKey]
        const bounds = isRecord(configuredBounds) ? configuredBounds : {}
        const rawValue = rawNodeValue[fieldKey]
        if (rawValue === undefined || rawValue === null || isComfyInputLink(rawValue)) {
          continue
        }
        if (fieldKey !== 'duration' && bounds.min === undefined && bounds.max === undefined) {
          continue
        }

        const effectiveBounds = fieldKey === 'duration'
          ? {
              min: typeof bounds.min === 'number' && Number.isFinite(bounds.min)
                ? Math.max(MINIMAX_H3_DIRECTOR_DURATION_MIN_SECONDS, bounds.min)
                : MINIMAX_H3_DIRECTOR_DURATION_MIN_SECONDS,
              max: typeof bounds.max === 'number' && Number.isFinite(bounds.max)
                ? Math.min(MINIMAX_H3_DIRECTOR_DURATION_MAX_SECONDS, bounds.max)
                : MINIMAX_H3_DIRECTOR_DURATION_MAX_SECONDS,
            }
          : bounds
        const numericField = buildMiniMaxDirectorNumericField(field, fieldKey, effectiveBounds)
        normalizedNodeValue ??= { ...rawNodeValue }
        normalizedNodeValue[fieldKey] = normalizeWorkflowNumericFieldValue(numericField, rawValue)
      }

      if (normalizedNodeValue) {
        normalizedPromptData[field.id] = normalizedNodeValue
      }
      continue
    }

    if (field.type !== 'number') {
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
