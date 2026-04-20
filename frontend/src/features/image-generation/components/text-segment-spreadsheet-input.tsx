import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { WildcardTool } from '@/lib/api'
import { cn } from '@/lib/utils'
import { WildcardInlinePickerField } from './wildcard-inline-picker-field'

export type TextSegmentSpreadsheetValue = string | string[]

export const DEFAULT_PROMPT_TEXTAREA_ROWS = 5

type TextSegmentSpreadsheetInputProps = {
  tool: WildcardTool
  value: TextSegmentSpreadsheetValue
  placeholder?: string
  showDetectedSyntax?: boolean
  className?: string
  onChange: (value: string[]) => void
}

/** Normalize one prompt-like value into stable spreadsheet rows. */
export function getTextSegmentSpreadsheetRows(value: TextSegmentSpreadsheetValue) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value : ['']
  }

  if (typeof value === 'string') {
    const lines = value.split('\n')
    return lines.length > 0 ? lines : ['']
  }

  return ['']
}

/** Render one expandable spreadsheet-style prompt editor with add/remove rows. */
export function TextSegmentSpreadsheetInput({
  tool,
  value,
  placeholder = '',
  showDetectedSyntax = true,
  className,
  onChange,
}: TextSegmentSpreadsheetInputProps) {
  const rows = getTextSegmentSpreadsheetRows(value)

  const handleRowChange = (index: number, nextValue: string) => {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? nextValue : row)))
  }

  const handleAddRow = () => {
    onChange([...rows, ''])
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
              className="min-h-[8.5rem] !rounded-none !border-0 !bg-transparent px-3 py-2"
              onChange={(nextValue) => handleRowChange(index, nextValue)}
            />
          </div>

          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => handleRemoveRow(index)}
            aria-label={`프롬프트 행 ${index + 1} 삭제`}
            title="삭제"
            className="h-auto self-stretch rounded-none border-l border-border/75 px-2 text-muted-foreground"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
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
