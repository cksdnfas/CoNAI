import { useMemo, useState } from 'react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Badge } from '@/components/ui/badge'
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
    <div className="space-y-3">
      <SegmentedControl
        value={activeTab}
        items={[
          { value: 'positive', label: positiveLabel },
          { value: 'negative', label: negativeLabel },
        ]}
        onChange={(nextTab) => setActiveTab(nextTab as PromptToggleTab)}
        fullWidth
        size="sm"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={promptStats.positiveCharacters > 0 ? 'secondary' : 'outline'}>
            {positiveLabel} {promptStats.positiveCharacters > 0 ? '입력됨' : '비어있음'}
          </Badge>
          <Badge variant={promptStats.negativeCharacters > 0 ? 'secondary' : 'outline'}>
            {negativeLabel} {promptStats.negativeCharacters > 0 ? '입력됨' : '비어있음'}
          </Badge>
        </div>
        <div>
          현재 {activeCharacters.toLocaleString('ko-KR')}자 · 약 {activeSegments.toLocaleString('ko-KR')}개 항목
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
