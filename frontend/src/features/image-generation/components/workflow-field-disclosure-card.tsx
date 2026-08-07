import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, CircleQuestionMark } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { hasWorkflowFieldValue } from '../image-generation-drafts'
import type { SelectedImageDraft, WorkflowFieldDraftValue } from '../image-generation-shared'
import { WorkflowFieldInput } from './workflow-field-input'
import { validateMiniMaxH3DirectorNodeValue } from './minimax-h3-director-dasiwa-utils'

function formatWorkflowFieldTypeLabel(field: WorkflowMarkedField) {
  if (field.type === 'node') {
    return 'Node'
  }

  return field.type
}

export const WORKFLOW_FIELD_DISCLOSURE_SURFACE_CLASS = 'overflow-hidden rounded-sm border border-border/85 bg-surface-container/30'
export const WORKFLOW_FIELD_DISCLOSURE_ACTIVE_CLASS = 'bg-surface-container/45'
export const WORKFLOW_FIELD_DISCLOSURE_CONTENT_CLASS = 'border-t border-border/85'

type WorkflowFieldDisclosureCardProps = {
  field: WorkflowMarkedField
  value: WorkflowFieldDraftValue
  grouped?: boolean
  loraOptions?: string[]
  isRefreshingOptions?: boolean
  onRefreshOptions?: () => Promise<void> | void
  onChange: (value: WorkflowFieldDraftValue) => void
  onImageChange: (image?: SelectedImageDraft) => Promise<void> | void
}

/** Render one runtime workflow field inside a collapsible card. */
export function WorkflowFieldDisclosureCard({ field, value, grouped = false, loraOptions, isRefreshingOptions = false, onRefreshOptions, onChange, onImageChange }: WorkflowFieldDisclosureCardProps) {
  const { t } = useI18n()
  const [isExpanded, setIsExpanded] = useState(field.default_collapsed !== true)
  const hasValue = hasWorkflowFieldValue(value)
  const fieldLabel = field.label || field.id
  const hasNodeIssues = field.type === 'node'
    && field.node_editor === 'minimax_h3_director_dasiwa'
    && typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && validateMiniMaxH3DirectorNodeValue(value).length > 0

  useEffect(() => {
    setIsExpanded(field.default_collapsed !== true)
  }, [field.default_collapsed, field.id])

  return (
    <div className={cn(
      grouped ? 'overflow-hidden' : WORKFLOW_FIELD_DISCLOSURE_SURFACE_CLASS,
      hasValue && WORKFLOW_FIELD_DISCLOSURE_ACTIVE_CLASS,
      hasNodeIssues && (grouped ? 'bg-destructive/5' : 'border-destructive/80 ring-1 ring-destructive/25'),
    )}>
      <div className="px-4 py-3">
        <button
          type="button"
          className="flex w-full items-start gap-3 text-left"
          onClick={() => setIsExpanded((current) => !current)}
          aria-expanded={isExpanded}
        >
          {isExpanded ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{fieldLabel}</span>
                {field.required ? <Badge variant="outline">{t('image-generation.components.workflow.field.disclosure.card.required')}</Badge> : null}
                {field.description ? (
                  <span
                    className="inline-flex cursor-help text-muted-foreground"
                    title={field.description}
                    aria-label={t('image-generation.components.workflow.field.disclosure.card.description', { label: fieldLabel })}
                  >
                    <CircleQuestionMark className="h-3.5 w-3.5" />
                  </span>
                ) : null}
              </div>

              <div className={cn(
                'shrink-0 text-[11px] font-medium tracking-[0.14em] text-muted-foreground',
                field.type !== 'node' && 'uppercase',
              )}>
                {formatWorkflowFieldTypeLabel(field)}
              </div>
            </div>
          </div>
        </button>
      </div>

      {isExpanded ? (
        <div className={cn(
          WORKFLOW_FIELD_DISCLOSURE_CONTENT_CLASS,
          field.type === 'textarea' ? 'px-0 py-0' : 'px-4 py-4',
        )}>
          <WorkflowFieldInput
            field={field}
            value={value}
            hideLabel
            loraOptions={loraOptions}
            isRefreshingOptions={isRefreshingOptions}
            onRefreshOptions={onRefreshOptions}
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
  onChange,
  onImageChange,
}: WorkflowNodeFieldDisclosureCardProps) {
  const { t } = useI18n()
  const hasValue = fields.some((field) => hasWorkflowFieldValue(values[field.id]))
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

  return (
    <div className={cn(
      WORKFLOW_FIELD_DISCLOSURE_SURFACE_CLASS,
      hasValue && WORKFLOW_FIELD_DISCLOSURE_ACTIVE_CLASS,
      issueCount > 0 && 'border-destructive/80 ring-1 ring-destructive/25',
    )}>
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{nodeTitle ?? t('image-generation.components.workflow.field.group.unknown.node')}</div>
          {nodeId ? <div className="mt-0.5 text-[11px] text-muted-foreground">{t('image-generation.components.workflow.field.group.node.id', { id: nodeId })}</div> : null}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Badge variant="outline">{t('image-generation.components.workflow.field.group.field.count', { count: fields.length })}</Badge>
          {issueCount > 0 ? <Badge variant="destructive">{t('image-generation.components.workflow.field.group.error.count', { count: issueCount })}</Badge> : null}
        </div>
      </div>

      <div className="divide-y divide-border/85 border-t border-border/85">
        {fields.map((field) => (
          <WorkflowFieldDisclosureCard
            key={field.id}
            grouped
            field={field}
            value={values[field.id] ?? ''}
            loraOptions={loraOptions}
            isRefreshingOptions={isRefreshingOptions}
            onRefreshOptions={onRefreshOptions}
            onChange={(value) => onChange(field.id, value)}
            onImageChange={(image) => onImageChange(field.id, image)}
          />
        ))}
      </div>
    </div>
  )
}
