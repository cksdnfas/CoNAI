import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { PromptWildcardTool } from './wildcard-inline-picker-helpers'
import { TextSegmentSpreadsheetInput, getTextSegmentSpreadsheetRows, joinTextSegmentSpreadsheetRows } from './text-segment-spreadsheet-input'
import {
  WORKFLOW_FIELD_DISCLOSURE_ACTIVE_CLASS,
  WORKFLOW_FIELD_DISCLOSURE_CONTENT_CLASS,
  WORKFLOW_FIELD_DISCLOSURE_SURFACE_CLASS,
} from './workflow-field-disclosure-card'

type PromptToggleFieldProps = {
  tool: PromptWildcardTool
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
  autocompletePromptType,
  onChange,
}: {
  tool: PromptWildcardTool
  label: string
  value: string
  placeholder: string
  autocompletePromptType: 'positive' | 'negative'
  isExpanded: boolean
  onToggle: () => void
  onChange: (value: string) => void
}) {
  const { t, formatNumber } = useI18n()
  const segmentCount = countPromptSegments(value)
  const rowCount = getTextSegmentSpreadsheetRows(value).length
  const characterCount = value.trim().length
  const hasValue = characterCount > 0
  const summary = t({ ko: '{characters}자 · {segments}개 · {rows}행', en: '{characters} chars · {segments} segments · {rows} rows' }, {
    characters: formatNumber(characterCount),
    segments: formatNumber(segmentCount),
    rows: formatNumber(rowCount),
  })

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
                {summary}
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
            autocompletePromptType={autocompletePromptType}
            onChange={(nextRows) => onChange(joinTextSegmentSpreadsheetRows(nextRows))}
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
  positiveLabel,
  negativeLabel,
  positivePlaceholder = '',
  negativePlaceholder = '',
}: PromptToggleFieldProps) {
  const { t } = useI18n()
  const [isPositiveExpanded, setIsPositiveExpanded] = useState(true)
  const [isNegativeExpanded, setIsNegativeExpanded] = useState(true)

  return (
    <div className="space-y-3">
      <PromptSpreadsheetDisclosure
        tool={tool}
        label={positiveLabel ?? t('image-generation.components.prompt.toggle.field.positive')}
        value={positiveValue}
        placeholder={positivePlaceholder}
        autocompletePromptType="positive"
        isExpanded={isPositiveExpanded}
        onToggle={() => setIsPositiveExpanded((current) => !current)}
        onChange={onPositiveChange}
      />

      <PromptSpreadsheetDisclosure
        tool={tool}
        label={negativeLabel ?? t('image-generation.components.prompt.toggle.field.negative')}
        value={negativeValue}
        placeholder={negativePlaceholder}
        autocompletePromptType="negative"
        isExpanded={isNegativeExpanded}
        onToggle={() => setIsNegativeExpanded((current) => !current)}
        onChange={onNegativeChange}
      />
    </div>
  )
}
