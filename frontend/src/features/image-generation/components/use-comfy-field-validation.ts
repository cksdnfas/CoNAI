import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { collectWorkflowNodeDraftIssues, hasWorkflowFieldValue, isValidWorkflowNumberDraftValue } from '../image-generation-drafts'
import type { WorkflowFieldDraftValue } from '../image-generation-shared'
import { revealFirstInvalidField } from './focus-invalid-field'
import { WORKFLOW_FIELD_INVALID_SELECTOR } from './workflow-field-disclosure-card'

/** Collect all invalid field messages before a private or public queue request. */
export function collectComfyFieldIssues(fields: WorkflowMarkedField[], draft: Record<string, WorkflowFieldDraftValue>, t: ReturnType<typeof useI18n>['t']) {
  const fieldIssues: Record<string, string> = {}
  const summaries: string[] = []
  const nodeIssues = new Map(collectWorkflowNodeDraftIssues(fields, draft).map((entry) => [entry.field.id, entry.issue] as const))
  for (const field of fields) {
    const value = draft[field.id]
    const nodeIssue = nodeIssues.get(field.id)
    if (field.required && !hasWorkflowFieldValue(value)) {
      fieldIssues[field.id] = t({ ko: '필수 입력이야.', en: 'This field is required.' })
      summaries.push(t({ ko: '필수 필드가 비어 있어: {label}', en: 'A required field is empty: {label}' }, { label: field.label }))
    } else if (field.type === 'number' && hasWorkflowFieldValue(value) && !isValidWorkflowNumberDraftValue(value)) {
      fieldIssues[field.id] = t({ ko: '올바른 숫자를 입력해줘.', en: 'Enter a valid number.' })
      summaries.push(t({ ko: '숫자 필드 값이 올바르지 않아: {label}', en: 'Invalid number field value: {label}' }, { label: field.label }))
    } else if (nodeIssue) {
      const message = t({ ko: nodeIssue.ko, en: nodeIssue.en })
      fieldIssues[field.id] = message
      summaries.push(`${field.label}: ${message}`)
    }
  }
  return { fieldIssues, summaries }
}

/** Mark and focus all offending fields while keeping the existing summarized snackbar. */
export function useComfyFieldValidation(workflowId: number | null, fields: WorkflowMarkedField[], draft: Record<string, WorkflowFieldDraftValue>, showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void) {
  const { t } = useI18n()
  const [fieldIssues, setFieldIssues] = useState<Record<string, string>>({})
  const [revealNonce, setRevealNonce] = useState(0)
  useEffect(() => { setFieldIssues({}) }, [workflowId])
  useEffect(() => {
    if (revealNonce === 0) return
    const frame = window.requestAnimationFrame(() => revealFirstInvalidField(WORKFLOW_FIELD_INVALID_SELECTOR))
    return () => window.cancelAnimationFrame(frame)
  }, [revealNonce])
  const clearFieldIssue = useCallback((fieldId: string) => {
    setFieldIssues((current) => {
      if (!(fieldId in current)) return current
      const next = { ...current }
      delete next[fieldId]
      return next
    })
  }, [])
  const clearFieldIssues = useCallback(() => setFieldIssues({}), [])
  const validate = () => {
    const result = collectComfyFieldIssues(fields, draft, t)
    setFieldIssues(result.fieldIssues)
    if (result.summaries.length === 0) return true
    setRevealNonce((current) => current + 1)
    const extraCount = result.summaries.length - 1
    showSnackbar({
      message: extraCount > 0
        ? t({ ko: '{message} (외 {count}개)', en: '{message} (+{count} more)' }, { message: result.summaries[0], count: extraCount })
        : result.summaries[0],
      tone: 'error',
    })
    return false
  }
  return { fieldIssues, clearFieldIssue, clearFieldIssues, validate }
}
