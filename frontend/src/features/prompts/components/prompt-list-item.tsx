import { FolderInput, Trash2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { PromptCollectionItem } from '@/types/prompt'

interface PromptListItemProps {
  item: PromptCollectionItem
  selected?: boolean
  canAssign?: boolean
  canDelete?: boolean
  onToggleSelect?: (checked: boolean) => void
  onAssignGroup?: () => void
  onDelete?: () => void
  onActivate?: () => void
}

export function PromptListItem({ item, selected = false, canAssign = true, canDelete = true, onToggleSelect, onAssignGroup, onDelete, onActivate }: PromptListItemProps) {
  const stopAction = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      className="prompt-list-selectable group relative grid cursor-pointer grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-sm bg-surface-container px-3 py-2 transition-colors hover:bg-surface-high"
      data-prompt-id={item.id}
      data-selected={selected ? 'true' : 'false'}
      onClick={() => onActivate?.()}
      title="클릭해서 복사"
    >
      <div className="flex justify-center" data-no-select-drag="true" onClick={stopAction}>
        <input type="checkbox" checked={selected} onChange={(event) => onToggleSelect?.(event.target.checked)} aria-label={`${item.prompt} 선택`} />
      </div>
      <div className="min-w-0 pr-1">
        <div className="break-all text-sm leading-5 font-semibold text-foreground">{item.prompt}</div>
      </div>
      <div className="flex items-center justify-end gap-1 sm:gap-1.5" data-no-select-drag="true" onClick={stopAction}>
        <span className="min-w-[2.5rem] text-right text-[11px] font-mono text-muted-foreground sm:min-w-[3rem]">{item.usage_count.toLocaleString('ko-KR')}</span>
        <button
          type="button"
          className="rounded-sm p-2 text-muted-foreground transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => onAssignGroup?.()}
          aria-label="프롬프트 그룹 지정"
          title="그룹 지정"
          disabled={!canAssign}
        >
          <FolderInput className="h-4 w-4" />
        </button>
        {canDelete ? (
          <button
            type="button"
            className="rounded-sm p-2 text-muted-foreground transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => onDelete?.()}
            aria-label="프롬프트 삭제"
            title="삭제"
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
