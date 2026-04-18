import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, CircleQuestionMark } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { WorkflowMarkedField } from '@/lib/api'
import { hasWorkflowFieldValue, type SelectedImageDraft, type WorkflowFieldDraftValue } from '../image-generation-shared'
import { WorkflowFieldInput } from './workflow-field-input'

export const WORKFLOW_FIELD_DISCLOSURE_SURFACE_CLASS = 'overflow-hidden rounded-sm border border-border/85 bg-surface-container/30'
export const WORKFLOW_FIELD_DISCLOSURE_ACTIVE_CLASS = 'bg-surface-container/45'
export const WORKFLOW_FIELD_DISCLOSURE_CONTENT_CLASS = 'border-t border-border/85'

type WorkflowFieldDisclosureCardProps = {
  field: WorkflowMarkedField
  value: WorkflowFieldDraftValue
  onChange: (value: WorkflowFieldDraftValue) => void
  onImageChange: (image?: SelectedImageDraft) => Promise<void> | void
}

/** Render one runtime workflow field inside a collapsible card. */
export function WorkflowFieldDisclosureCard({ field, value, onChange, onImageChange }: WorkflowFieldDisclosureCardProps) {
  const [isExpanded, setIsExpanded] = useState(field.default_collapsed !== true)
  const hasValue = hasWorkflowFieldValue(value)
  const fieldLabel = field.label || field.id

  useEffect(() => {
    setIsExpanded(field.default_collapsed !== true)
  }, [field.default_collapsed, field.id])

  return (
    <div className={cn(
      WORKFLOW_FIELD_DISCLOSURE_SURFACE_CLASS,
      hasValue && WORKFLOW_FIELD_DISCLOSURE_ACTIVE_CLASS,
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
                {field.required ? <Badge variant="outline">필수</Badge> : null}
                {field.description ? (
                  <span
                    className="inline-flex cursor-help text-muted-foreground"
                    title={field.description}
                    aria-label={`${fieldLabel} 설명`}
                  >
                    <CircleQuestionMark className="h-3.5 w-3.5" />
                  </span>
                ) : null}
              </div>

              <div className="shrink-0 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {field.type}
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
            onChange={onChange}
            onImageChange={onImageChange}
          />
        </div>
      ) : null}
    </div>
  )
}
