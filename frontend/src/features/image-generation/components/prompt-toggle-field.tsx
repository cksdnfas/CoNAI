import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { WildcardTool } from '@/lib/api'
import { cn } from '@/lib/utils'
import { TextSegmentSpreadsheetInput, getTextSegmentSpreadsheetRows } from './text-segment-spreadsheet-input'
import {
  WORKFLOW_FIELD_DISCLOSURE_ACTIVE_CLASS,
  WORKFLOW_FIELD_DISCLOSURE_CONTENT_CLASS,
  WORKFLOW_FIELD_DISCLOSURE_SURFACE_CLASS,
} from './workflow-field-disclosure-card'

type PromptToggleFieldProps = {
  tool: WildcardTool
  positiveValue: string
  negativeValue: string
  onPositiveChange: (value: string) => void
  onNegativeChange: (value: string) => void
  positiveRows?: number
  negativeRows?: number
  positiveLabel?: string
  negativeLabel?: string
  positivePlaceholder?: string
  negativePlaceholder?: string
}

/** Return a lightweight prompt segment count using commas and line breaks. */
function countPromptSegments(value: string) {
  return value
    .split(/[,\n]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .length
}

function PromptSpreadsheetDisclosure({
  tool,
  label,
  value,
  placeholder,
  isExpanded,
  onToggle,
  onChange,
}: {
  tool: WildcardTool
  label: string
  value: string
  placeholder: string
  isExpanded: boolean
  onToggle: () => void
  onChange: (value: string) => void
}) {
  const segmentCount = countPromptSegments(value)
  const rowCount = getTextSegmentSpreadsheetRows(value).length
  const hasValue = value.trim().length > 0

  return (
    <div className={cn(WORKFLOW_FIELD_DISCLOSURE_SURFACE_CLASS, hasValue && WORKFLOW_FIELD_DISCLOSURE_ACTIVE_CLASS)}>
      <div className="px-4 py-3">
        <button
          type="button"
          className="flex w-full items-start gap-3 text-left"
          onClick={onToggle}
          aria-expanded={isExpanded}
        >
          {isExpanded ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{label}</span>
              <div className="shrink-0 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {value.trim().length.toLocaleString('ko-KR')}자 · {segmentCount.toLocaleString('ko-KR')}개 · {rowCount.toLocaleString('ko-KR')}행
              </div>
            </div>
          </div>
        </button>
      </div>

      {isExpanded ? (
        <div className={cn(WORKFLOW_FIELD_DISCLOSURE_CONTENT_CLASS, 'px-0 py-0')}>
          <TextSegmentSpreadsheetInput
            tool={tool}
            value={value}
            placeholder={placeholder}
            onChange={(nextRows) => onChange(nextRows.join('\n'))}
          />
        </div>
      ) : null}
    </div>
  )
}

/** Render one reusable positive/negative prompt editor with expandable spreadsheet-style rows. */
export function PromptToggleField({
  tool,
  positiveValue,
  negativeValue,
  onPositiveChange,
  onNegativeChange,
  positiveLabel = '포지티브',
  negativeLabel = '네거티브',
  positivePlaceholder = '',
  negativePlaceholder = '',
}: PromptToggleFieldProps) {
  const [isPositiveExpanded, setIsPositiveExpanded] = useState(true)
  const [isNegativeExpanded, setIsNegativeExpanded] = useState(true)

  return (
    <div className="space-y-3">
      <PromptSpreadsheetDisclosure
        tool={tool}
        label={positiveLabel}
        value={positiveValue}
        placeholder={positivePlaceholder}
        isExpanded={isPositiveExpanded}
        onToggle={() => setIsPositiveExpanded((current) => !current)}
        onChange={onPositiveChange}
      />

      <PromptSpreadsheetDisclosure
        tool={tool}
        label={negativeLabel}
        value={negativeValue}
        placeholder={negativePlaceholder}
        isExpanded={isNegativeExpanded}
        onToggle={() => setIsNegativeExpanded((current) => !current)}
        onChange={onNegativeChange}
      />
    </div>
  )
}
