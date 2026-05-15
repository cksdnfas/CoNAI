import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  searchAriaLabel?: string
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
  searchAriaLabel,
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

  const countLabel = normalizedQuery
    ? t({ ko: '{filtered} / {total}', en: '{filtered} / {total}' }, { filtered: formatNumber(filteredItems.length), total: formatNumber(items.length) })
    : formatNumber(filteredItems.length)
  const progress = resolveSettingsPagedListProgress({ page, pageSize, visibleCount: pagedItems.length, totalCount: filteredItems.length })
  const progressLabel = progress.visibleCount > 0
    ? t(
      { ko: '표시 {start}-{end} / 전체 {total}', en: 'Showing {start}-{end} / {total}' },
      { start: formatNumber(progress.start), end: formatNumber(progress.end), total: formatNumber(progress.totalCount) },
    )
    : t({ ko: '전체 {total}', en: '{total} total' }, { total: formatNumber(progress.totalCount) })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            variant="settings"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchAriaLabel ?? searchPlaceholder}
            className="pl-9"
          />
        </div>
        <Badge variant="secondary">{countLabel}</Badge>
      </div>

      {pagedItems.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border bg-surface-container px-4 py-6 text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        <div className={cn('space-y-2', listClassName)}>
          {pagedItems.map((item) => (
            <div key={getItemKey(item)}>
              {renderItem(item)}
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className={cn('flex items-center justify-between gap-3 border-t border-border/70 pt-3 text-sm text-muted-foreground', paginationClassName)}>
          <span>
            {t(
              { ko: '페이지 {page} / {totalPages} · {progress}', en: 'Page {page} / {totalPages} · {progress}' },
              { page: formatNumber(page), totalPages: formatNumber(totalPages), progress: progressLabel },
            )}
          </span>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              {t({ ko: '이전', en: 'Previous' })}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>
              {t({ ko: '다음', en: 'Next' })}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
