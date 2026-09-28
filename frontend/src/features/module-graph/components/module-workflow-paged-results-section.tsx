import type { ReactNode, Ref } from 'react'
import { Square, SquareCheckBig, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Inset } from '@/components/ui/inset'
import { Section } from '@/components/ui/section'
import { useI18n } from '@/i18n'
import { resolveModuleWorkflowOutputProgress } from '../module-workflow-output-progress'

/** Server page size shared by the workflow output-management tabs. */
export const MODULE_WORKFLOW_RESULTS_PAGE_SIZE = 50

type PagedResultsSectionProps = {
  heading: string
  page: number
  totalPages: number
  visibleCount: number
  totalCount: number
  allVisibleSelected: boolean
  selectPageLabel: string
  clearPageLabel: string
  /** Optional title/aria-label for the page-selection toggle. */
  selectToggleTitle?: string
  canClearAll: boolean
  isClearing: boolean
  isEmpty: boolean
  empty: ReactNode
  /** Controls rendered between the header and the list (filters, copy panel). */
  toolbar?: ReactNode
  /** Ref for the list container, e.g. a drag-selection root. */
  listContainerRef?: Ref<HTMLDivElement>
  onPageChange: (page: number) => void
  onToggleVisibleSelection: () => void
  onClearAll: () => void
  children: ReactNode
}

/**
 * Shared frame for the paged, selectable workflow result tabs: header with progress badge,
 * select-page toggle and clear-all, optional toolbar, empty state, and top/bottom pagination
 * around the caller-rendered list.
 */
export function ModuleWorkflowPagedResultsSection({
  heading,
  page,
  totalPages,
  visibleCount,
  totalCount,
  allVisibleSelected,
  selectPageLabel,
  clearPageLabel,
  selectToggleTitle,
  canClearAll,
  isClearing,
  isEmpty,
  empty,
  toolbar,
  listContainerRef,
  onPageChange,
  onToggleVisibleSelection,
  onClearAll,
  children,
}: PagedResultsSectionProps) {
  const { t, formatNumber } = useI18n()
  const progress = resolveModuleWorkflowOutputProgress({
    page,
    pageSize: MODULE_WORKFLOW_RESULTS_PAGE_SIZE,
    visibleCount,
    totalCount,
  })
  const progressLabel = progress.visibleCount > 0
    ? t(
      { ko: '표시 {start}-{end} / 전체 {total}', en: 'showing {start}-{end} / total {total}' },
      {
        start: formatNumber(progress.start),
        end: formatNumber(progress.end),
        total: formatNumber(progress.totalCount),
      },
    )
    : formatNumber(progress.totalCount)

  return (
    <Section
      heading={heading}
      headingAs="h3"
      actions={(
        <>
          <Badge variant="outline">{progressLabel}</Badge>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onToggleVisibleSelection}
            disabled={visibleCount === 0}
            title={selectToggleTitle}
            aria-label={selectToggleTitle}
            data-no-select-drag="true"
          >
            {allVisibleSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            {allVisibleSelected ? clearPageLabel : selectPageLabel}
          </Button>
          {canClearAll ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={onClearAll}
              disabled={isClearing || totalCount === 0}
              data-no-select-drag="true"
            >
              <Trash2 className="h-4 w-4" />
              {t({ ko: '전체 비우기', en: 'Clear all' })}
            </Button>
          ) : null}
        </>
      )}
    >
      {toolbar}
      {isEmpty ? empty : (
        <div ref={listContainerRef} className="space-y-3">
          <ModuleWorkflowResultsPagination page={page} totalPages={totalPages} visibleCount={visibleCount} totalCount={totalCount} onPageChange={onPageChange} />
          {children}
          <ModuleWorkflowResultsPagination page={page} totalPages={totalPages} visibleCount={visibleCount} totalCount={totalCount} onPageChange={onPageChange} />
        </div>
      )}
    </Section>
  )
}

function ModuleWorkflowResultsPagination({
  page,
  totalPages,
  visibleCount,
  totalCount,
  onPageChange,
}: {
  page: number
  totalPages: number
  visibleCount: number
  totalCount: number
  onPageChange: (page: number) => void
}) {
  const { t, formatNumber } = useI18n()
  const progress = resolveModuleWorkflowOutputProgress({ page, pageSize: MODULE_WORKFLOW_RESULTS_PAGE_SIZE, visibleCount, totalCount })
  const progressLabel = progress.visibleCount > 0
    ? t(
      { ko: '표시 {start}-{end} / 전체 {total}', en: 'showing {start}-{end} / total {total}' },
      {
        start: formatNumber(progress.start),
        end: formatNumber(progress.end),
        total: formatNumber(progress.totalCount),
      },
    )
    : t({ ko: '전체 {total}', en: 'total {total}' }, { total: formatNumber(progress.totalCount) })

  if (totalPages <= 1) {
    return null
  }

  return (
    <Inset className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
      <span>{t({ ko: '페이지 {page} / {totalPages} · {progress} · 페이지당 50개', en: 'page {page} / {totalPages} · {progress} · 50 per page' }, { page: formatNumber(page), totalPages: formatNumber(totalPages), progress: progressLabel })}</span>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>
          {t({ ko: '이전', en: 'Previous' })}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          {t({ ko: '다음', en: 'Next' })}
        </Button>
      </div>
    </Inset>
  )
}
