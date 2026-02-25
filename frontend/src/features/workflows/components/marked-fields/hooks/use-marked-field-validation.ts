import { useMemo } from 'react'
import type { MarkedField } from '@/services/workflow-api'

export interface FieldError {
  fieldId: string
  fieldIndex: number
  field: string
  message: string
  severity: 'error' | 'warning'
}

export function useMarkedFieldValidation(fields: MarkedField[]) {
  const errors = useMemo(() => {
    const validationErrors: FieldError[] = []

    fields.forEach((field, index) => {
      if (!field.id || field.id.trim() === '') {
        validationErrors.push({
          fieldId: field.id,
          fieldIndex: index,
          field: 'id',
          message: 'Field ID is required',
          severity: 'error',
        })
      } else if (!/^[a-zA-Z0-9_]+$/.test(field.id)) {
        validationErrors.push({
          fieldId: field.id,
          fieldIndex: index,
          field: 'id',
          message: 'Field ID must contain only letters, numbers, and underscores',
          severity: 'error',
        })
      }

      const duplicateIndex = fields.findIndex((f, i) => i !== index && f.id === field.id && field.id.trim() !== '')
      if (duplicateIndex !== -1) {
        validationErrors.push({
          fieldId: field.id,
          fieldIndex: index,
          field: 'id',
          message: `Duplicate Field ID: also used in field #${duplicateIndex + 1}`,
          severity: 'error',
        })
      }

      if (!field.label || field.label.trim() === '') {
        validationErrors.push({
          fieldId: field.id,
          fieldIndex: index,
          field: 'label',
          message: 'Label is required',
          severity: 'error',
        })
      }

      if (!field.jsonPath || field.jsonPath.trim() === '') {
        validationErrors.push({
          fieldId: field.id,
          fieldIndex: index,
          field: 'jsonPath',
          message: 'JSON Path is required',
          severity: 'error',
        })
      } else if (!/^\d+\./.test(field.jsonPath)) {
        validationErrors.push({
          fieldId: field.id,
          fieldIndex: index,
          field: 'jsonPath',
          message: 'JSON Path should start with a node number (e.g., "6.inputs.text")',
          severity: 'warning',
        })
      }

      const duplicateJsonPathIndex = fields.findIndex(
        (f, i) => i !== index && f.jsonPath === field.jsonPath && field.jsonPath.trim() !== '',
      )
      if (duplicateJsonPathIndex !== -1) {
        validationErrors.push({
          fieldId: field.id,
          fieldIndex: index,
          field: 'jsonPath',
          message: `Duplicate JSON Path: also used in field #${duplicateJsonPathIndex + 1}`,
          severity: 'warning',
        })
      }

      if (field.type === 'number' && field.min !== undefined && field.max !== undefined && field.min > field.max) {
        validationErrors.push({
          fieldId: field.id,
          fieldIndex: index,
          field: 'min',
          message: 'Min value must be less than or equal to Max value',
          severity: 'error',
        })
      }

      if (field.type === 'select' && (!field.options || field.options.length === 0)) {
        validationErrors.push({
          fieldId: field.id,
          fieldIndex: index,
          field: 'options',
          message: 'Select fields must have at least one option',
          severity: 'error',
        })
      }
    })

    return validationErrors
  }, [fields])

  const isValid = errors.every((error) => error.severity !== 'error')

  const getFieldErrors = (fieldIndex: number) => errors.filter((error) => error.fieldIndex === fieldIndex)
  const getErrorsByType = (severity: 'error' | 'warning') => errors.filter((error) => error.severity === severity)

  const errorCount = errors.filter((error) => error.severity === 'error').length
  const warningCount = errors.filter((error) => error.severity === 'warning').length

  return {
    errors,
    isValid,
    errorCount,
    warningCount,
    getFieldErrors,
    getErrorsByType,
  }
}
