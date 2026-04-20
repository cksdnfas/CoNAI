import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

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
    ? `${filteredItems.length} / ${items.length}`
    : filteredItems.length.toLocaleString('ko-KR')

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
            page {page} / {totalPages} · total {filteredItems.length.toLocaleString('ko-KR')}
          </span>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              이전
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>
              다음
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
