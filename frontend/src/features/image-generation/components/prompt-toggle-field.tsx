import { useState, type ReactNode } from 'react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { useI18n } from '@/i18n'
import type { PromptWildcardTool } from './wildcard-inline-picker-helpers'
import { TextSegmentSpreadsheetInput, getTextSegmentSpreadsheetRows, joinTextSegmentSpreadsheetRows } from './text-segment-spreadsheet-input'

/** An extra tab next to positive/negative (e.g. NAI character prompts). */
export type PromptToggleExtraTab = {
  value: string
  label: ReactNode
  content: ReactNode
}

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
  extraTabs?: PromptToggleExtraTab[]
  /** Smaller tab bar for nested editors (e.g. one character inside the character tab). */
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

/** Tab label with the prompt's segment count, so a filled negative prompt stays visible while another tab is open. */
function PromptTabLabel({ label, value }: { label: string; value: string }) {
  const { formatNumber } = useI18n()
  const segmentCount = countPromptSegments(value)

  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      {segmentCount > 0 ? <span className="text-xs tabular-nums text-muted-foreground">{formatNumber(segmentCount)}</span> : null}
    </span>
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
  extraTabs = [],
  compact = false,
}: PromptToggleFieldProps) {
  const { t, formatNumber } = useI18n()
  const [activeTab, setActiveTab] = useState('positive')
  const resolvedPositiveLabel = positiveLabel ?? t('image-generation.components.prompt.toggle.field.positive')
  const resolvedNegativeLabel = negativeLabel ?? t('image-generation.components.prompt.toggle.field.negative')
  const extraTab = extraTabs.find((tab) => tab.value === activeTab) ?? null
  const currentTab = extraTab ? activeTab : activeTab === 'negative' ? 'negative' : 'positive'
  const promptValue = currentTab === 'negative' ? negativeValue : positiveValue

  const summary = extraTab ? null : t({ ko: '{characters}자 · {rows}행', en: '{characters} chars · {rows} rows' }, {
    characters: formatNumber(promptValue.trim().length),
    rows: formatNumber(getTextSegmentSpreadsheetRows(promptValue).length),
  })

  return (
    <div className="min-w-0 space-y-3">
      <SegmentedTabBar
        size={compact ? 'xs' : 'sm'}
        value={currentTab}
        ariaLabel={t({ ko: '프롬프트', en: 'Prompt' })}
        items={[
          { value: 'positive', label: <PromptTabLabel label={resolvedPositiveLabel} value={positiveValue} /> },
          { value: 'negative', label: <PromptTabLabel label={resolvedNegativeLabel} value={negativeValue} /> },
          ...extraTabs.map(({ value, label }) => ({ value, label })),
        ]}
        onChange={setActiveTab}
        actions={summary ? <span className="text-xs tabular-nums text-muted-foreground">{summary}</span> : undefined}
      />

      {extraTab ? extraTab.content : (
        <TextSegmentSpreadsheetInput
          key={currentTab}
          tool={tool}
          value={promptValue}
          placeholder={currentTab === 'negative' ? negativePlaceholder : positivePlaceholder}
          autocompletePromptType={currentTab === 'negative' ? 'negative' : 'positive'}
          onChange={(nextRows) => (currentTab === 'negative' ? onNegativeChange : onPositiveChange)(joinTextSegmentSpreadsheetRows(nextRows))}
        />
      )}
    </div>
  )
}
