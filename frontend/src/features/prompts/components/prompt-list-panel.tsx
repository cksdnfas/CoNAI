import type { RefObject } from 'react'
import { PageInset } from '@/components/common/page-surface'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { PromptCollectionItem } from '@/types/prompt'
import { useI18n } from '@/i18n'
import { resolvePromptListProgress } from '../prompt-list-progress'
import { PromptListItem } from './prompt-list-item'

interface PromptListPanelProps {
  items: PromptCollectionItem[]
  selectedPromptIdSet: ReadonlySet<number>
  isLoading: boolean
  isError: boolean
  errorMessage?: string | null
  isDraggingSelection?: boolean
  totalPages?: number
  page?: number
  limit?: number
  total?: number
  promptListRef: RefObject<HTMLDivElement | null>
  onPageChange: (page: number) => void
  onTogglePromptSelection: (promptId: number, checked: boolean) => void
  activePrompt?: { prompt: string; type: PromptCollectionItem['type'] } | null
  onAssignPrompt: (item: PromptCollectionItem) => void
  onDeletePrompt: (item: PromptCollectionItem) => void
  onActivatePrompt: (item: PromptCollectionItem) => void
  isLockedPromptItem: (item: PromptCollectionItem) => boolean
  canDeletePromptItem: (item: PromptCollectionItem) => boolean
}

export function PromptListPanel({
  items,
  selectedPromptIdSet,
  isLoading,
  isError,
  errorMessage,
  isDraggingSelection = false,
  totalPages = 0,
  page = 1,
  limit = 40,
  total = 0,
  promptListRef,
  onPageChange,
  onTogglePromptSelection,
  activePrompt,
  onAssignPrompt,
  onDeletePrompt,
  onActivatePrompt,
  isLockedPromptItem,
  canDeletePromptItem,
}: PromptListPanelProps) {
  const { t, formatNumber } = useI18n()
  const progress = resolvePromptListProgress({ page, pageSize: limit, visibleCount: items.length, totalCount: total })
  const progressLabel = progress.visibleCount > 0
    ? t(
      { ko: '표시 {start}-{end} / 전체 {total}', en: 'showing {start}-{end} / {total}' },
      {
        start: formatNumber(progress.start),
        end: formatNumber(progress.end),
        total: formatNumber(progress.totalCount),
      },
    )
    : t({ ko: '전체 {total}', en: 'total {total}' }, { total: formatNumber(progress.totalCount) })

  return (
    <section className="space-y-4">
      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t('prompts.components.prompt.list.panel.failed.to.load.prompts')}</AlertTitle>
          <AlertDescription>{errorMessage ?? t('prompts.components.prompt.list.panel.an.unknown.error.occurred')}</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && items.length === 0 ? (
        <PageInset className="text-sm text-muted-foreground">{t('prompts.components.prompt.list.panel.no.items')}</PageInset>
      ) : null}

      <div ref={promptListRef} className={isDraggingSelection ? 'select-none' : undefined}>
        <div className="space-y-1">
          <div className="hidden grid-cols-[32px_auto_minmax(0,1fr)_auto] border-b border-border/70 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground sm:grid">
            <span />
            <span>Usage</span>
            <span>Prompt</span>
            <span className="text-right">Actions</span>
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
                  selected={selectedPromptIdSet.has(item.id)}
                  active={activePrompt?.type === item.type && activePrompt?.prompt === item.prompt}
                  canAssign={!isLocked}
                  canDelete={canDeletePromptItem(item)}
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
        <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-4 text-sm text-muted-foreground">
          <span>
            {t(
              { ko: '페이지 {page} / {totalPages} · {progress}', en: 'page {page} / {totalPages} · {progress}' },
              { page, totalPages, progress: progressLabel },
            )}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>
              {t({ ko: '이전', en: 'Previous' })}
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
              {t({ ko: '다음', en: 'Next' })}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
