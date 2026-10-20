import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import {
  resolvePreferredWildcardItemTool,
  type PromptWildcardTool,
} from './wildcard-inline-picker-helpers'
import { renderHighlightedText } from './wildcard-inline-picker-field-ui'
import type { IndexedWildcardInlinePickerSuggestion } from './use-wildcard-inline-picker-suggestions'

type WildcardInlinePickerPopupContentProps = {
  activeIndex: number
  activeListSuggestions: IndexedWildcardInlinePickerSuggestion[]
  normalizedActiveQuery: string
  tool: PromptWildcardTool
  onInsertPreprocess: (preprocessName: string) => void
}

/** Preprocess keyword suggestions (random sources moved to the `@` / `__` palette). */
export function WildcardInlinePickerPopupContent({
  activeIndex,
  activeListSuggestions,
  normalizedActiveQuery,
  tool,
  onInsertPreprocess,
}: WildcardInlinePickerPopupContentProps) {
  const { t } = useI18n()

  const renderSuggestionButton = ({
    record,
    toolItemCount,
    generalItemCount,
    naiItemCount,
    comfyuiItemCount,
    index,
  }: IndexedWildcardInlinePickerSuggestion) => {
    const isActive = index === activeIndex
    const preferredBadgeTool = resolvePreferredWildcardItemTool(record.itemCounts, tool)

    return (
      <Button
        key={record.id}
        type="button"
        variant="nav"
        data-active={isActive || undefined}
        className="h-auto items-start justify-between gap-3 px-3 py-2 whitespace-normal"
        onMouseDown={(event) => {
          event.preventDefault()
          onInsertPreprocess(record.name)
        }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{renderHighlightedText(record.name, normalizedActiveQuery)}</span>
            <Badge variant={record.type === 'chain' ? 'secondary' : 'outline'}>{record.type === 'chain' ? 'Chain' : 'Wildcard'}</Badge>
            {record.isAutoCollected ? <Badge variant="outline">Auto LoRA</Badge> : null}
            {toolItemCount === 0 ? <Badge variant="outline">{t('image-generation.components.wildcard.inline.picker.field.current.tool.is.empty')}</Badge> : null}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{renderHighlightedText(record.path.join(' / '), normalizedActiveQuery)}</div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Badge variant={preferredBadgeTool === 'general' ? 'secondary' : 'outline'}>General {generalItemCount}</Badge>
          <Badge variant={preferredBadgeTool === 'nai' ? 'secondary' : 'outline'}>NAI {naiItemCount}</Badge>
          <Badge variant={preferredBadgeTool === 'comfyui' ? 'secondary' : 'outline'}>Comfy {comfyuiItemCount}</Badge>
        </div>
      </Button>
    )
  }

  return (
    <>
      <div className="space-y-2 px-3 pt-2.5 pb-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Text as="div" variant="overline" className="font-semibold">{t({ ko: '전처리', en: 'Preprocess' })}</Text>
          <Badge variant="outline">{activeListSuggestions.length}</Badge>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {activeListSuggestions.map(renderSuggestionButton)}
      </div>
    </>
  )
}
