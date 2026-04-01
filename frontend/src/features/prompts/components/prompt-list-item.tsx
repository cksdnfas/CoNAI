import { Copy, FolderInput, Trash2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { PromptCollectionItem } from '@/types/prompt'

interface PromptListItemProps {
  item: PromptCollectionItem
  selected?: boolean
  canAssign?: boolean
  canDelete?: boolean
  onCopy: (text: string) => void
  onToggleSelect?: (checked: boolean) => void
  onAssignGroup?: () => void
  onDelete?: () => void
  onActivate?: () => void
}

export function PromptListItem({ item, selected = false, canAssign = true, canDelete = true, onCopy, onToggleSelect, onAssignGroup, onDelete, onActivate }: PromptListItemProps) {
  const stopAction = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      className="prompt-list-selectable group relative grid cursor-pointer grid-cols-[32px_minmax(0,1fr)_120px_116px] items-center rounded-sm bg-surface-container px-3 py-2 transition-colors hover:bg-surface-high"
      data-prompt-id={item.id}
      data-selected={selected ? 'true' : 'false'}
      onClick={() => onActivate?.()}
      title="클릭해서 복사"
    >
      <div className="flex justify-center" data-no-select-drag="true" onClick={stopAction}>
        <input type="checkbox" checked={selected} onChange={(event) => onToggleSelect?.(event.target.checked)} aria-label={`${item.prompt} 선택`} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-foreground">{item.prompt}</div>
      </div>
      <div className="text-right text-[11px] font-mono text-muted-foreground">{item.usage_count.toLocaleString('ko-KR')}</div>
      <div className="flex justify-end gap-1" data-no-select-drag="true" onClick={stopAction}>
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
        <button
          type="button"
          className="rounded-sm p-2 text-muted-foreground transition-colors hover:text-primary"
          onClick={() => onCopy(item.prompt)}
          aria-label="프롬프트 복사"
          title="복사"
        >
          <Copy className="h-4 w-4" />
        </button>
      </div>
      <div className="prompt-list-selection-frame pointer-events-none absolute inset-0 z-10 rounded-sm" />
    </div>
  )
}
