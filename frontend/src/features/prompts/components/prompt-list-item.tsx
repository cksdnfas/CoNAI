import { FolderInput, Sparkles, Trash2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import { cn } from '@/lib/utils'
import type { PromptCollectionItem } from '@/types/prompt'
import { useI18n } from '@/i18n'

interface PromptListItemProps {
  item: PromptCollectionItem
  selected?: boolean
  active?: boolean
  canAssign?: boolean
  canDelete?: boolean
  onToggleSelect?: (checked: boolean) => void
  onAssignGroup?: () => void
  onDelete?: () => void
  onActivate?: () => void
}

export function PromptListItem({ item, selected = false, active = false, canAssign = true, canDelete = true, onToggleSelect, onAssignGroup, onDelete, onActivate }: PromptListItemProps) {
  const { t, formatNumber } = useI18n()
  const stopAction = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      className={cn(
        'prompt-list-selectable group relative grid cursor-pointer grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-sm bg-surface-container px-3 py-2 transition-colors hover:bg-surface-high',
        active ? 'ring-1 ring-primary/50 bg-surface-high' : null,
      )}
      data-prompt-id={item.id}
      data-selected={selected ? 'true' : 'false'}
      data-active={active ? 'true' : 'false'}
      onClick={() => onActivate?.()}
      title={t('prompts.components.prompt.list.item.click.to.copy')}
    >
      <div className="flex justify-center" data-no-select-drag="true" onClick={stopAction}>
        <input type="checkbox" checked={selected} onChange={(event) => onToggleSelect?.(event.target.checked)} aria-label={t({ ko: '{prompt} 선택', en: 'Select {prompt}' }, { prompt: item.prompt })} />
      </div>
      <div className="min-w-0 pr-1">
        <div className="break-all text-sm leading-5 font-semibold text-foreground">{item.prompt}</div>
      </div>
      <div className="flex items-center justify-end gap-1 sm:gap-1.5" data-no-select-drag="true" onClick={stopAction}>
        {active ? <Sparkles className="h-3.5 w-3.5 text-primary" /> : null}
        <span className="min-w-[2.5rem] text-right text-[11px] font-mono text-muted-foreground sm:min-w-[3rem]">{formatNumber(item.usage_count)}</span>
        <button
          type="button"
          className="rounded-sm p-2 text-muted-foreground transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => onAssignGroup?.()}
          aria-label={t('prompts.components.prompt.list.item.assign.prompt.group')}
          title={t('prompts.components.prompt.list.item.assign.group')}
          disabled={!canAssign}
        >
          <FolderInput className="h-4 w-4" />
        </button>
        {canDelete ? (
          <button
            type="button"
            className="rounded-sm p-2 text-muted-foreground transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => onDelete?.()}
            aria-label={t('prompts.components.prompt.list.item.delete.prompt')}
            title={t('prompts.components.prompt.list.item.delete')}
            disabled={!canDelete}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <div className="prompt-list-selection-frame pointer-events-none absolute inset-0 z-10 rounded-sm" />
    </div>
  )
}
