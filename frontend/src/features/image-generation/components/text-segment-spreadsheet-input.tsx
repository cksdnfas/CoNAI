import { Fragment, useRef, useState } from 'react'
import { BookmarkPlus, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Separator } from '@/components/ui/separator'
import { useI18n } from '@/i18n'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
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
  invalid?: boolean
  errorMessageId?: string
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
  invalid = false,
  errorMessageId,
  onChange,
}: TextSegmentSpreadsheetInputProps) {
  const { t } = useI18n()
  const { canViewPrompts } = useFeaturePermissions()
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
    if (!canViewPrompts) return
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
    <div className={cn('space-y-1', className)}>
      {/* One field fill around every row; the row actions sit on the same fill, rows split by a hairline. */}
      <div
        className={cn(
          'theme-input-surface overflow-hidden rounded-sm border transition-[border-color,box-shadow] focus-within:border-primary/55 focus-within:ring-2 focus-within:ring-primary/15',
          invalid && 'border-destructive/70 focus-within:border-destructive/70 focus-within:ring-destructive/20',
        )}
      >
        {rows.map((row, index) => (
          <Fragment key={index}>
            {index > 0 ? <Separator /> : null}
            <div className="flex items-stretch">
              <div className="min-w-0 flex-1">
                <WildcardInlinePickerField
                  tool={tool}
                  multiline
                  rows={DEFAULT_PROMPT_TEXTAREA_ROWS}
                  value={row}
                  placeholder={placeholder}
                  showDetectedSyntax={showDetectedSyntax}
                  autocompletePromptType={autocompletePromptType}
                  invalid={invalid}
                  errorMessageId={errorMessageId}
                  className="min-h-[8.5rem] !rounded-none !border-0 !bg-transparent px-3 py-2 focus:!ring-0"
                  onChange={(nextValue) => handleRowChange(index, nextValue)}
                />
              </div>

              <div className="flex w-10 shrink-0 flex-col items-center gap-1 py-1.5">
                <IconButton
                  ref={(node: HTMLButtonElement | null) => {
                    presetButtonRefs.current.set(index, node)
                  }}
                  size="icon-sm"
                  variant="ghost"
                  disabled={!canViewPrompts}
                  onClick={() => setPresetPickerRowIndex((current) => current === index ? null : index)}
                  label={t('image-generation.components.text.segment.spreadsheet.input.insert.preset.into.prompt.row', { row: index + 1 })}
                  tooltipSide="left"
                >
                  <BookmarkPlus />
                </IconButton>
                <IconButton
                  size="icon-sm"
                  variant="ghost"
                  className="mt-auto hover:text-destructive"
                  onClick={() => handleRemoveRow(index)}
                  label={t('image-generation.components.text.segment.spreadsheet.input.delete.prompt.row', { row: index + 1 })}
                  tooltipSide="left"
                >
                  <Trash2 />
                </IconButton>

                <PromptPresetInlinePicker
                  open={presetPickerRowIndex === index}
                  anchorRef={{ current: presetButtonRefs.current.get(index) ?? null }}
                  onClose={() => setPresetPickerRowIndex(null)}
                  onInsert={(text) => handleInsertPreset(index, text)}
                />
              </div>
            </div>
          </Fragment>
        ))}
      </div>

      <Button
        type="button"
        size="xs"
        variant="ghost"
        onClick={handleAddRow}
      >
        <Plus />
        {t({ ko: '행 추가', en: 'Add row' })}
      </Button>
    </div>
  )
}
