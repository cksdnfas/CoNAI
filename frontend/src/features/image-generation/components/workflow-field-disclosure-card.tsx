import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, CircleQuestionMark } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { WorkflowMarkedField } from '@/lib/api'
import { hasWorkflowFieldValue, type SelectedImageDraft, type WorkflowFieldDraftValue } from '../image-generation-shared'
import { WorkflowFieldInput } from './workflow-field-input'

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
    <div className="overflow-hidden bg-surface-container/95 backdrop-blur-sm">
      <div className="px-4 py-3">
        <button
          type="button"
          className="flex w-full items-start gap-3 text-left"
          onClick={() => setIsExpanded((current) => !current)}
          aria-expanded={isExpanded}
        >
          {isExpanded ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">{fieldLabel}</span>
              <Badge variant="outline">{field.type}</Badge>
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

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{hasValue ? '입력됨' : '비어 있음'}</span>
              {field.description ? <span className="truncate">{field.description}</span> : null}
            </div>
          </div>
        </button>
      </div>

      {isExpanded ? (
        <div className="border-t border-border/85 px-0 pt-0 pb-0">
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
