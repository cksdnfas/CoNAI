import { useEffect, useState } from 'react'
import { ChevronDown, CircleQuestionMark } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'
import type { SelectedImageDraft, WorkflowFieldDraftValue } from '../image-generation-shared'
import { WorkflowFieldInput } from './workflow-field-input'
import { validateMiniMaxH3DirectorNodeValue } from './minimax-h3-director-dasiwa-utils'

function formatWorkflowFieldTypeLabel(field: WorkflowMarkedField) {
  if (field.type === 'node') {
    return 'Node'
  }

  return field.type
}

/** Flat field block (DESIGN_PRESET "Flat"): a plain disclosure row over the field, no surface of its own. */
export const WORKFLOW_FIELD_DISCLOSURE_SURFACE_CLASS = 'min-w-0'
/** Disclosure header: a plain row with a chevron whose hover wash bleeds a little past the field edges. */
export const WORKFLOW_FIELD_DISCLOSURE_HEADER_CLASS = '-mx-2 h-auto w-[calc(100%+1rem)] gap-3 px-2 py-2.5 text-foreground'
/** Body under the disclosure header, separated by spacing instead of a divider. */
export const WORKFLOW_FIELD_DISCLOSURE_CONTENT_CLASS = 'pb-1'

/** Selector for the fields marked by the last failed generate validation (see `data-workflow-field-invalid`). */
export const WORKFLOW_FIELD_INVALID_SELECTOR = '[data-workflow-field-invalid="true"]'

function buildWorkflowFieldErrorId(fieldId: string) {
  return `workflow-field-error-${fieldId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

type WorkflowFieldDisclosureCardProps = {
  field: WorkflowMarkedField
  value: WorkflowFieldDraftValue
  grouped?: boolean
  loraOptions?: string[]
  isRefreshingOptions?: boolean
  onRefreshOptions?: () => Promise<void> | void
  /** Validation message from the last generate attempt; marks the field invalid while set. */
  issueMessage?: string
  onChange: (value: WorkflowFieldDraftValue) => void
  onImageChange: (image?: SelectedImageDraft) => Promise<void> | void
}

/** Render one runtime workflow field inside a collapsible card. */
export function WorkflowFieldDisclosureCard({ field, value, grouped = false, loraOptions, isRefreshingOptions = false, onRefreshOptions, issueMessage, onChange, onImageChange }: WorkflowFieldDisclosureCardProps) {
  const { t } = useI18n()
  const [isExpanded, setIsExpanded] = useState(field.default_collapsed !== true)
  const fieldLabel = field.label || field.id
  const hasNodeIssues = field.type === 'node'
    && field.node_editor === 'minimax_h3_director_dasiwa'
    && typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && validateMiniMaxH3DirectorNodeValue(value).length > 0
  const isInvalid = Boolean(issueMessage)
  const errorMessageId = buildWorkflowFieldErrorId(field.id)

  useEffect(() => {
    setIsExpanded(field.default_collapsed !== true)
  }, [field.default_collapsed, field.id])

  useEffect(() => {
    // 검증 실패 필드는 접혀 있어도 펼쳐서 바로 고칠 수 있게 한다.
    if (issueMessage) {
      setIsExpanded(true)
    }
  }, [issueMessage])

  return (
    <div
      className={cn(WORKFLOW_FIELD_DISCLOSURE_SURFACE_CLASS, grouped && 'py-1')}
      data-workflow-field-invalid={isInvalid ? 'true' : undefined}
    >
      <Button
        type="button"
        variant="nav"
        className={cn(WORKFLOW_FIELD_DISCLOSURE_HEADER_CLASS, 'items-start')}
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
      >
        <ChevronDown className={cn('mt-0.5 text-muted-foreground transition-transform', !isExpanded && '-rotate-90')} aria-hidden />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className={cn('min-w-0 truncate font-medium', isInvalid || hasNodeIssues ? 'text-destructive' : 'text-foreground')}>{fieldLabel}</span>
          {field.required ? <Badge variant="outline">{t('image-generation.components.workflow.field.disclosure.card.required')}</Badge> : null}
          {field.description ? (
            <span
              className="inline-flex cursor-help text-muted-foreground"
              title={field.description}
              aria-label={t('image-generation.components.workflow.field.disclosure.card.description', { label: fieldLabel })}
            >
              <CircleQuestionMark className="size-3.5" />
            </span>
          ) : null}
        </span>
        <span className={cn(
          'shrink-0 text-2xs font-medium text-muted-foreground',
          field.type !== 'node' && 'uppercase tracking-overline',
        )}>
          {formatWorkflowFieldTypeLabel(field)}
        </span>
      </Button>
      {issueMessage ? (
        <p id={errorMessageId} className="-mt-1 pb-2 pl-7 text-xs text-destructive">{issueMessage}</p>
      ) : null}

      {isExpanded ? (
        <div className={WORKFLOW_FIELD_DISCLOSURE_CONTENT_CLASS}>
          <WorkflowFieldInput
            field={field}
            value={value}
            hideLabel
            loraOptions={loraOptions}
            isRefreshingOptions={isRefreshingOptions}
            onRefreshOptions={onRefreshOptions}
            invalid={isInvalid}
            errorMessageId={errorMessageId}
            onChange={onChange}
            onImageChange={onImageChange}
          />
        </div>
      ) : null}
    </div>
  )
}

type WorkflowNodeFieldDisclosureCardProps = {
  nodeId: string | null
  nodeTitle: string | null
  fields: WorkflowMarkedField[]
  values: Record<string, WorkflowFieldDraftValue>
  loraOptions?: string[]
  isRefreshingOptions?: boolean
  onRefreshOptions?: () => Promise<void> | void
  fieldIssues?: Record<string, string>
  onChange: (fieldId: string, value: WorkflowFieldDraftValue) => void
  onImageChange: (fieldId: string, image?: SelectedImageDraft) => Promise<void> | void
}

/** Render multiple fields from one workflow node inside a single outer surface. */
export function WorkflowNodeFieldDisclosureCard({
  nodeId,
  nodeTitle,
  fields,
  values,
  loraOptions,
  isRefreshingOptions = false,
  onRefreshOptions,
  fieldIssues,
  onChange,
  onImageChange,
}: WorkflowNodeFieldDisclosureCardProps) {
  const { t } = useI18n()
  const issueCount = fields.reduce((count, field) => {
    const value = values[field.id]
    if (field.type !== 'node'
      || field.node_editor !== 'minimax_h3_director_dasiwa'
      || typeof value !== 'object'
      || value === null
      || Array.isArray(value)) {
      return count
    }

    return count + validateMiniMaxH3DirectorNodeValue(value).length
  }, 0)
  const hasFieldIssues = fields.some((field) => Boolean(fieldIssues?.[field.id]))

  return (
    <div className={WORKFLOW_FIELD_DISCLOSURE_SURFACE_CLASS}>
      <div className="flex items-start justify-between gap-3 py-2">
        <div className="min-w-0">
          <div className={cn('truncate text-sm font-semibold', issueCount > 0 || hasFieldIssues ? 'text-destructive' : 'text-foreground')}>{nodeTitle ?? t('image-generation.components.workflow.field.group.unknown.node')}</div>
          {nodeId ? <div className="mt-0.5 text-2xs text-muted-foreground">{t('image-generation.components.workflow.field.group.node.id', { id: nodeId })}</div> : null}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Badge variant="outline">{t('image-generation.components.workflow.field.group.field.count', { count: fields.length })}</Badge>
          {issueCount > 0 ? <Badge variant="destructive">{t('image-generation.components.workflow.field.group.error.count', { count: issueCount })}</Badge> : null}
        </div>
      </div>

      <div className="divide-y divide-line">
        {fields.map((field) => (
          <WorkflowFieldDisclosureCard
            key={field.id}
            grouped
            field={field}
            value={values[field.id] ?? ''}
            loraOptions={loraOptions}
            isRefreshingOptions={isRefreshingOptions}
            onRefreshOptions={onRefreshOptions}
            issueMessage={fieldIssues?.[field.id]}
            onChange={(value) => onChange(field.id, value)}
            onImageChange={(image) => onImageChange(field.id, image)}
          />
        ))}
      </div>
    </div>
  )
}
