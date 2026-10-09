import { useState } from 'react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import type { PromptWildcardTool } from './wildcard-inline-picker-helpers'
import { TextSegmentSpreadsheetInput, getTextSegmentSpreadsheetRows, joinTextSegmentSpreadsheetRows } from './text-segment-spreadsheet-input'

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
  /** Smaller tab bar for nested editors (one NAI character block). */
  compact?: boolean
}

/** Return a lightweight prompt segment count using commas and line breaks. */
function countPromptSegments(value: string) {
  return value
    .split(/[,\n]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .length
}

/** Tab label with the prompt's segment count, so a filled negative prompt stays visible while another tab is open; the length readout lives in its tooltip. */
function PromptTabLabel({ label, value }: { label: string; value: string }) {
  const { t, formatNumber } = useI18n()
  const segmentCount = countPromptSegments(value)
  const summary = value.trim().length > 0
    ? t({ ko: '{characters}자 · {rows}행', en: '{characters} chars · {rows} rows' }, {
      characters: formatNumber(value.trim().length),
      rows: formatNumber(getTextSegmentSpreadsheetRows(value).length),
    })
    : null

  return (
    <Tip content={summary}>
      <span className="inline-flex items-center gap-1.5">
        {label}
        {segmentCount > 0 ? <span className="text-xs tabular-nums text-muted-foreground">{formatNumber(segmentCount)}</span> : null}
      </span>
    </Tip>
  )
}

/** Render one reusable positive/negative prompt editor as tabs, so only the prompt being edited takes up space. */
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
  compact = false,
}: PromptToggleFieldProps) {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<'positive' | 'negative'>('positive')
  const resolvedPositiveLabel = positiveLabel ?? t('image-generation.components.prompt.toggle.field.positive')
  const resolvedNegativeLabel = negativeLabel ?? t('image-generation.components.prompt.toggle.field.negative')
  const promptValue = activeTab === 'negative' ? negativeValue : positiveValue

  return (
    <div className="min-w-0 space-y-3">
      <SegmentedTabBar
        size={compact ? 'xs' : 'sm'}
        value={activeTab}
        ariaLabel={t({ ko: '프롬프트', en: 'Prompt' })}
        items={[
          { value: 'positive', label: <PromptTabLabel label={resolvedPositiveLabel} value={positiveValue} /> },
          { value: 'negative', label: <PromptTabLabel label={resolvedNegativeLabel} value={negativeValue} /> },
        ]}
        onChange={(value) => setActiveTab(value === 'negative' ? 'negative' : 'positive')}
      />

      <TextSegmentSpreadsheetInput
        key={activeTab}
        tool={tool}
        value={promptValue}
        placeholder={activeTab === 'negative' ? negativePlaceholder : positivePlaceholder}
        autocompletePromptType={activeTab}
        onChange={(nextRows) => (activeTab === 'negative' ? onNegativeChange : onPositiveChange)(joinTextSegmentSpreadsheetRows(nextRows))}
      />
    </div>
  )
}
