import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { FolderInput, Sparkles, Trash2 } from 'lucide-react'
import { useRef, type MouseEvent } from 'react'
import { ActionContextMenu, ActionMenuButton, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Checkbox } from '@/components/ui/checkbox'
import { ListRow } from '@/components/ui/list-row'
import { Tip } from '@/components/ui/tooltip'
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

/** One prompt as a hairline row: checkbox · text · group · ⋯ menu (also on right-click / long-press) · usage count. Click copies. */
export function PromptListItem({ item, groupName, selected = false, active = false, canAssign = true, canDelete = true, onToggleSelect, onAssignGroup, onDelete, onActivate }: PromptListItemProps) {
  const { canUpdatePrompts, canDeletePrompts } = useFeaturePermissions()
  const { t, formatNumber } = useI18n()
  // A long-press opens the menu; the click that may follow it should not also copy the prompt.
  const touchMenuAt = useRef(0)
  const pointerType = useRef('mouse')
  const stopAction = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }
  const entries: ActionMenuEntry[] = [
    { key: 'assign', label: t('prompts.components.prompt.list.item.assign.group'), icon: FolderInput, disabled: !canAssign || !canUpdatePrompts, onSelect: () => onAssignGroup?.() },
    '-',
    canDelete && canDeletePrompts && { key: 'delete', label: t('prompts.components.prompt.list.item.delete'), icon: Trash2, destructive: true, onSelect: () => onDelete?.() },
  ]

  return (
    <ActionContextMenu entries={entries} onOpenChange={(open) => { if (open && pointerType.current !== 'mouse') touchMenuAt.current = Date.now() }}>
      <ListRow
        interactive
        selected={selected}
        className="prompt-list-selectable group relative"
        data-prompt-id={item.id}
        data-active={active ? 'true' : 'false'}
        onPointerDown={(event) => { pointerType.current = event.pointerType }}
        onClick={() => { if (Date.now() - touchMenuAt.current > 800) onActivate?.() }}
        leading={(
          <span className="flex" data-no-select-drag="true" onClick={stopAction}>
            <Checkbox checked={selected} onCheckedChange={(checked) => onToggleSelect?.(checked === true)} aria-label={t({ ko: '{prompt} 선택', en: 'Select {prompt}' }, { prompt: item.prompt })} />
          </span>
        )}
        trailing={(
          <>
            <span
              className="flex items-center gap-0.5"
              data-no-select-drag="true"
              onClick={stopAction}
            >
              <ActionMenuButton entries={entries} size="icon-xs" className="text-muted-foreground" label={t({ ko: '더 보기', en: 'More' })} />
            </span>
            {active ? <Sparkles className="size-3.5 text-primary" aria-hidden /> : null}
            <Tip content={t({ ko: '사용 {count}회', en: 'Used {count} times' }, { count: formatNumber(item.usage_count) })}>
              <span className="min-w-10 text-right text-xs tabular-nums text-muted-foreground">{formatPromptUsageCount(item.usage_count)}</span>
            </Tip>
          </>
        )}
      >
        {/* Only the text carries the hint, so it never stacks with the row actions' tooltips. */}
        <Tip content={t('prompts.components.prompt.list.item.click.to.copy')} side="top" align="start" delayDuration={700}>
          <span className="min-w-0 break-all">{item.prompt}</span>
        </Tip>
        {groupName ? <span className="shrink-0 text-xs text-muted-foreground">{groupName}</span> : null}
        <span className="prompt-list-selection-frame pointer-events-none absolute inset-0 z-10 rounded-sm" />
      </ListRow>
    </ActionContextMenu>
  )
}
