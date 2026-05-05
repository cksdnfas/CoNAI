import { useRef, useState } from 'react'
import { BookmarkPlus, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getTextSegmentSpreadsheetRows, type TextSegmentSpreadsheetValue } from './prompt-text-segment-helpers'
import { PromptPresetInlinePicker } from './prompt-preset-inline-picker'
import { WildcardInlinePickerField } from './wildcard-inline-picker-field'
import type { PromptTypeFilter } from '@/types/prompt'
import type { PromptWildcardTool } from './wildcard-inline-picker-helpers'

export { getTextSegmentSpreadsheetRows, joinTextSegmentSpreadsheetRows, normalizeTextSegmentSpreadsheetText, TEXT_SEGMENT_SPREADSHEET_ROW_SEPARATOR, type TextSegmentSpreadsheetValue } from './prompt-text-segment-helpers'

export const DEFAULT_PROMPT_TEXTAREA_ROWS = 5

type TextSegmentSpreadsheetInputProps = {
  tool: PromptWildcardTool
  value: TextSegmentSpreadsheetValue
  placeholder?: string
  showDetectedSyntax?: boolean
  className?: string
  autocompletePromptType?: PromptTypeFilter
  onChange: (value: string[]) => void
}

/** Render one expandable spreadsheet-style prompt editor with add/remove rows. */
export function TextSegmentSpreadsheetInput({
  tool,
  value,
  placeholder = '',
  showDetectedSyntax = true,
  className,
  autocompletePromptType = 'positive',
  onChange,
}: TextSegmentSpreadsheetInputProps) {
  const rows = getTextSegmentSpreadsheetRows(value)
  const presetButtonRefs = useRef(new Map<number, HTMLButtonElement | null>())
  const [presetPickerRowIndex, setPresetPickerRowIndex] = useState<number | null>(null)

  const handleRowChange = (index: number, nextValue: string) => {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? nextValue : row)))
  }

  const handleAddRow = () => {
    onChange([...rows, ''])
  }

  const handleInsertPreset = (index: number, insertionText: string) => {
    const currentValue = rows[index] ?? ''
    const separator = currentValue.trim().length > 0 && !currentValue.endsWith('\n') ? '\n' : ''
    handleRowChange(index, `${currentValue}${separator}${insertionText}`)
  }

  const handleRemoveRow = (index: number) => {
    if (rows.length === 1) {
      onChange([''])
      return
    }

    onChange(rows.filter((_, rowIndex) => rowIndex !== index))
  }

  return (
    <div className={cn('theme-input-surface overflow-hidden rounded-sm border border-border/80', className)}>
      {rows.map((row, index) => (
        <div key={index} className="flex items-stretch border-b border-border/75 last:border-b-0">
          <div className="min-w-0 flex-1">
            <WildcardInlinePickerField
              tool={tool}
              multiline
              rows={DEFAULT_PROMPT_TEXTAREA_ROWS}
              value={row}
              placeholder={placeholder}
              showDetectedSyntax={showDetectedSyntax}
              autocompletePromptType={autocompletePromptType}
              className="min-h-[8.5rem] !rounded-none !border-0 !bg-transparent px-3 py-2"
              onChange={(nextValue) => handleRowChange(index, nextValue)}
            />
          </div>

          <div className="flex w-11 shrink-0 flex-col border-l border-border/75">
            <Button
              ref={(node) => {
                presetButtonRefs.current.set(index, node)
              }}
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => setPresetPickerRowIndex((current) => current === index ? null : index)}
              aria-label={`프롬프트 행 ${index + 1}에 프리셋 삽입`}
              title="프리셋"
              className="min-h-0 flex-[7] rounded-none px-2 text-muted-foreground"
            >
              <BookmarkPlus className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => handleRemoveRow(index)}
              aria-label={`프롬프트 행 ${index + 1} 삭제`}
              title="삭제"
              className="min-h-0 flex-[3] rounded-none border-t border-border/75 px-2 text-muted-foreground"
            >
              <Trash2 className="h-4 w-4" />
            </Button>

            <PromptPresetInlinePicker
              open={presetPickerRowIndex === index}
              anchorRef={{ current: presetButtonRefs.current.get(index) ?? null }}
              onClose={() => setPresetPickerRowIndex(null)}
              onInsert={(text) => handleInsertPreset(index, text)}
            />
          </div>
        </div>
      ))}

      <div className="flex border-t border-border/75">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={handleAddRow}
          aria-label="프롬프트 행 추가"
          title="입력 행 추가"
          className="h-9 w-full rounded-none"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
