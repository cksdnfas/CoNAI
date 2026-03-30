import type { RefObject } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { PromptCollectionItem } from '@/types/prompt'
import { PromptListItem } from './prompt-list-item'

interface PromptListPanelProps {
  items: PromptCollectionItem[]
  selectedPromptIds: number[]
  isLoading: boolean
  isError: boolean
  errorMessage?: string | null
  isDraggingSelection?: boolean
  totalPages?: number
  page?: number
  total?: number
  promptListRef: RefObject<HTMLDivElement | null>
  onPageChange: (page: number) => void
  onTogglePromptSelection: (promptId: number, checked: boolean) => void
  onAssignPrompt: (item: PromptCollectionItem) => void
  onDeletePrompt: (item: PromptCollectionItem) => void
  onCopyPrompt: (text: string) => void
  onActivatePrompt: (item: PromptCollectionItem) => void
  isLockedPromptItem: (item: PromptCollectionItem) => boolean
}

export function PromptListPanel({
  items,
  selectedPromptIds,
  isLoading,
  isError,
  errorMessage,
  isDraggingSelection = false,
  totalPages = 0,
  page = 1,
  total = 0,
  promptListRef,
  onPageChange,
  onTogglePromptSelection,
  onAssignPrompt,
  onDeletePrompt,
  onCopyPrompt,
  onActivatePrompt,
  isLockedPromptItem,
}: PromptListPanelProps) {
  return (
    <section className="space-y-6">
      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>프롬프트 목록을 불러오지 못했어</AlertTitle>
          <AlertDescription>{errorMessage ?? '알 수 없는 오류가 발생했어.'}</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && items.length === 0 ? (
        <div className="rounded-sm bg-surface-lowest text-sm text-muted-foreground">항목 없음</div>
      ) : null}

      <div ref={promptListRef} className={isDraggingSelection ? 'select-none' : undefined}>
        <div className="space-y-1">
          <div className="grid grid-cols-[32px_minmax(0,1fr)_120px_116px] border-b border-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            <span />
            <span>Prompt</span>
            <span className="text-right">Usage</span>
            <span />
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full rounded-sm" />
              ))}
            </div>
          ) : null}

          {!isLoading && items.length > 0
            ? items.map((item) => {
              const isLocked = isLockedPromptItem(item)
              return (
                <PromptListItem
                  key={`${item.type}-${item.id}`}
                  item={item}
                  selected={selectedPromptIds.includes(item.id)}
                  canAssign={!isLocked}
                  canDelete={!isLocked}
                  onCopy={onCopyPrompt}
                  onToggleSelect={(checked) => onTogglePromptSelection(item.id, checked)}
                  onAssignGroup={() => onAssignPrompt(item)}
                  onDelete={() => onDeletePrompt(item)}
                  onActivate={() => onActivatePrompt(item)}
                />
              )
            })
            : null}
        </div>
      </div>

      {totalPages > 0 ? (
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            page {page} / {totalPages} · total {total.toLocaleString('ko-KR')}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>
              이전
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
              다음
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
