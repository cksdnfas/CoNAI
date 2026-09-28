import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { PromptWildcardTool } from './wildcard-inline-picker-helpers'
import { TextSegmentSpreadsheetInput, getTextSegmentSpreadsheetRows, joinTextSegmentSpreadsheetRows } from './text-segment-spreadsheet-input'
import {
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
    <div data-surface="raised" className={WORKFLOW_FIELD_DISCLOSURE_SURFACE_CLASS}>
      <Button
        type="button"
        variant="nav"
        className="h-auto gap-3 px-4 py-3 text-foreground"
        onClick={onToggle}
        aria-expanded={isExpanded}
      >
        <ChevronDown className={cn('text-muted-foreground transition-transform', !isExpanded && '-rotate-90')} aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        <span className={cn('shrink-0 text-xs tabular-nums', hasValue ? 'text-muted-foreground' : 'text-muted-foreground/70')}>{summary}</span>
      </Button>

      {isExpanded ? (
        <div className={cn(WORKFLOW_FIELD_DISCLOSURE_CONTENT_CLASS, 'px-3 pb-3')}>
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
