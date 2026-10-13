import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { SearchField } from '@/components/common/search-field'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { resolveSettingsPagedListProgress } from './settings-searchable-paged-list-progress'

interface SettingsSearchablePagedListProps<T> {
  items: T[]
  pageSize: number
  searchPlaceholder: string
  emptyMessage: ReactNode
  getItemKey: (item: T) => string | number
  matchesQuery: (item: T, normalizedQuery: string) => boolean
  renderItem: (item: T) => ReactNode
  listClassName?: string
  paginationClassName?: string
}

/** Shared searchable settings list with compact previous/next paging. */
export function SettingsSearchablePagedList<T>({
  items,
  pageSize,
  searchPlaceholder,
  emptyMessage,
  getItemKey,
  matchesQuery,
  renderItem,
  listClassName,
  paginationClassName,
}: SettingsSearchablePagedListProps<T>) {
  const { t, formatNumber } = useI18n()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const normalizedQuery = query.trim().toLowerCase()
  const filteredItems = useMemo(() => {
    if (!normalizedQuery) {
      return items
    }

    return items.filter((item) => matchesQuery(item, normalizedQuery))
  }, [items, matchesQuery, normalizedQuery])

  const totalPages = filteredItems.length > 0 ? Math.ceil(filteredItems.length / pageSize) : 0
  const pagedItems = useMemo(() => {
    if (filteredItems.length === 0) {
      return []
    }

    const startIndex = (page - 1) * pageSize
    return filteredItems.slice(startIndex, startIndex + pageSize)
  }, [filteredItems, page, pageSize])

  useEffect(() => {
    setPage(1)
  }, [normalizedQuery])

  useEffect(() => {
    if (totalPages === 0) {
      if (page !== 1) {
        setPage(1)
      }
      return
    }

    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  const countLabel = t({ ko: '{filtered} / {total}', en: '{filtered} / {total}' }, { filtered: formatNumber(filteredItems.length), total: formatNumber(items.length) })
  const progress = resolveSettingsPagedListProgress({ page, pageSize, visibleCount: pagedItems.length, totalCount: filteredItems.length })
  const progressLabel = progress.visibleCount > 0
    ? t(
      { ko: '표시 {start}-{end} / 전체 {total}', en: 'Showing {start}-{end} / {total}' },
      { start: formatNumber(progress.start), end: formatNumber(progress.end), total: formatNumber(progress.totalCount) },
    )
    : t({ ko: '전체 {total}', en: '{total} total' }, { total: formatNumber(progress.totalCount) })

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField value={query} onChange={setQuery} placeholder={searchPlaceholder} className="min-w-[220px] flex-1" />
        {normalizedQuery ? <span className="shrink-0 text-xs text-muted-foreground">{countLabel}</span> : null}
      </div>

      {pagedItems.length === 0 ? (
        <EmptyState size="compact" title={emptyMessage} />
      ) : (
        <div className={listClassName}>
          {pagedItems.map((item) => (
            <Fragment key={getItemKey(item)}>
              {renderItem(item)}
            </Fragment>
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className={cn('flex items-center justify-between gap-3 pt-3 text-sm text-muted-foreground', paginationClassName)}>
          <span>
            {t(
              { ko: '페이지 {page} / {totalPages} · {progress}', en: 'Page {page} / {totalPages} · {progress}' },
              { page: formatNumber(page), totalPages: formatNumber(totalPages), progress: progressLabel },
            )}
          </span>
          <div className="flex gap-2">
            <IconButton size="icon-sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} label={t({ ko: '이전', en: 'Previous' })}>
              <ChevronLeft className="h-4 w-4" />
            </IconButton>
            <IconButton size="icon-sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} label={t({ ko: '다음', en: 'Next' })}>
              <ChevronRight className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      ) : null}
    </div>
  )
}
