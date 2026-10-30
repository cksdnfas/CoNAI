import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { ListPager } from '@/components/common/list-pager'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * One page of settings as a card grid with its loading and error states, the empty state, and previous/next paging
 * (the library page and the setting picker; pages come from `useCharacterSettingsPage`).
 */
export function CharacterSettingGrid<T>({ query, page, onPageChange, renderSetting, empty, gridClassName, errorTitle }: {
  query: UseQueryResult<{ items: T[]; total: number; hasMore: boolean }>
  /** 0-based page. */
  page: number
  onPageChange: (page: number) => void
  renderSetting: (setting: T) => ReactNode
  empty: ReactNode
  gridClassName?: string
  errorTitle: string
}) {
  const data = query.data
  const grid = cn('grid gap-4 pt-2', gridClassName ?? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6')
  return <>
    {query.isPending ? (
      <div className={grid}>{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} radius="sm" className="aspect-[3/4] w-full" />)}</div>
    ) : query.isError && !data ? (
      <ErrorState title={errorTitle} error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />
    ) : data?.items.length ? (
      <div className={grid}>{data.items.map(renderSetting)}</div>
    ) : empty}
    <ListPager className="pt-3" hasPrevious={page > 0} hasNext={Boolean(data?.hasMore)} onPrevious={() => onPageChange(page - 1)} onNext={() => onPageChange(page + 1)} />
  </>
}
