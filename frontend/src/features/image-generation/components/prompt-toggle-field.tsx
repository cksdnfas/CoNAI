import { useMemo, useState } from 'react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import type { WildcardTool } from '@/lib/api'
import { WildcardInlinePickerField } from './wildcard-inline-picker-field'

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

type PromptToggleTab = 'positive' | 'negative'

/** Return a lightweight prompt segment count using commas and line breaks. */
function countPromptSegments(value: string) {
  return value
    .split(/[,\n]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .length
}

/** Render one reusable positive/negative prompt editor with toggle tabs. */
export function PromptToggleField({
  tool,
  positiveValue,
  negativeValue,
  onPositiveChange,
  onNegativeChange,
  positiveRows = 6,
  negativeRows = 6,
  positiveLabel = '포지티브',
  negativeLabel = '네거티브',
  positivePlaceholder = '',
  negativePlaceholder = '',
}: PromptToggleFieldProps) {
  const [activeTab, setActiveTab] = useState<PromptToggleTab>('positive')
  const isPositiveTab = activeTab === 'positive'
  const activeValue = isPositiveTab ? positiveValue : negativeValue

  const promptStats = useMemo(() => ({
    positiveCharacters: positiveValue.trim().length,
    negativeCharacters: negativeValue.trim().length,
    positiveSegments: countPromptSegments(positiveValue),
    negativeSegments: countPromptSegments(negativeValue),
  }), [negativeValue, positiveValue])

  const activeCharacters = isPositiveTab ? promptStats.positiveCharacters : promptStats.negativeCharacters
  const activeSegments = isPositiveTab ? promptStats.positiveSegments : promptStats.negativeSegments

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <SegmentedTabBar
          value={activeTab}
          items={[
            { value: 'positive', label: positiveLabel },
            { value: 'negative', label: negativeLabel },
          ]}
          onChange={(nextTab) => setActiveTab(nextTab as PromptToggleTab)}
          size="sm"
        />

        <div className="text-[11px] text-muted-foreground">
          {activeCharacters.toLocaleString('ko-KR')}자 · {activeSegments.toLocaleString('ko-KR')}개
        </div>
      </div>

      <WildcardInlinePickerField
        tool={tool}
        multiline
        rows={isPositiveTab ? positiveRows : negativeRows}
        value={activeValue}
        onChange={isPositiveTab ? onPositiveChange : onNegativeChange}
        placeholder={isPositiveTab ? positivePlaceholder : negativePlaceholder}
      />
    </div>
  )
}
