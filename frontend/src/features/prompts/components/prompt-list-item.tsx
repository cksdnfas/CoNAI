import { FolderInput, Sparkles, Trash2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import type { PromptCollectionItem } from '@/types/prompt'
import { useI18n } from '@/i18n'
import { formatPromptUsageCount } from '../prompt-page-utils'

interface PromptListItemProps {
  item: PromptCollectionItem
  groupName?: string | null
  selected?: boolean
  active?: boolean
  canAssign?: boolean
  canDelete?: boolean
  onToggleSelect?: (checked: boolean) => void
  onAssignGroup?: () => void
  onDelete?: () => void
  onActivate?: () => void
}

/** One prompt as a hairline row: checkbox · text · group · row actions (on hover) · usage count. Click copies. */
export function PromptListItem({ item, groupName, selected = false, active = false, canAssign = true, canDelete = true, onToggleSelect, onAssignGroup, onDelete, onActivate }: PromptListItemProps) {
  const { t } = useI18n()
  const stopAction = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <ListRow
      interactive
      selected={selected}
      className="prompt-list-selectable group relative"
      data-prompt-id={item.id}
      data-active={active ? 'true' : 'false'}
      onClick={() => onActivate?.()}
      title={t('prompts.components.prompt.list.item.click.to.copy')}
      leading={(
        <span className="flex" data-no-select-drag="true" onClick={stopAction}>
          <Checkbox checked={selected} onCheckedChange={(checked) => onToggleSelect?.(checked === true)} aria-label={t({ ko: '{prompt} 선택', en: 'Select {prompt}' }, { prompt: item.prompt })} />
        </span>
      )}
      trailing={(
        <>
          <span
            className="flex items-center gap-0.5 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
            data-no-select-drag="true"
            onClick={stopAction}
          >
            <IconButton variant="ghost" size="icon-xs" onClick={() => onAssignGroup?.()} label={t('prompts.components.prompt.list.item.assign.prompt.group')} disabled={!canAssign}>
              <FolderInput />
            </IconButton>
            {canDelete ? (
              <IconButton variant="ghost" size="icon-xs" onClick={() => onDelete?.()} label={t('prompts.components.prompt.list.item.delete.prompt')}>
                <Trash2 />
              </IconButton>
            ) : null}
          </span>
          {active ? <Sparkles className="size-3.5 text-primary" aria-hidden /> : null}
          <span className="min-w-10 text-right text-xs tabular-nums text-muted-foreground" title={String(item.usage_count)}>{formatPromptUsageCount(item.usage_count)}</span>
        </>
      )}
    >
      <span className="min-w-0 break-all">{item.prompt}</span>
      {groupName ? <span className="shrink-0 text-xs text-muted-foreground">{groupName}</span> : null}
      <span className="prompt-list-selection-frame pointer-events-none absolute inset-0 z-10 rounded-sm" />
    </ListRow>
  )
}
