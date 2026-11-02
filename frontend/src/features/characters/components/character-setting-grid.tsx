import type { ReactNode } from 'react'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Settings as a card grid with its loading and error states and the empty state; `footer` carries the paging (previous /
 * next in the pickers, the load-more sentinel on the library page).
 */
export function CharacterSettingGrid<T>({ items, pending, error, onRetry, retrying = false, footer, renderSetting, empty, gridClassName, columns, errorTitle }: {
  /** Undefined until the first load lands. */
  items: T[] | undefined
  pending: boolean
  /** A failed first load (nothing to show yet). */
  error: unknown
  onRetry: () => void
  retrying?: boolean
  footer?: ReactNode
  renderSetting: (setting: T) => ReactNode
  empty: ReactNode
  gridClassName?: string
  /** Cards per row chosen by the person (overrides the responsive default). */
  columns?: number
  errorTitle: string
}) {
  const grid = cn('grid gap-4 pt-2', columns ? undefined : gridClassName ?? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6')
  const style = columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined
  return <>
    {pending ? (
      <div className={grid} style={style}>{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} radius="sm" className="aspect-[3/4] w-full" />)}</div>
    ) : error && !items ? (
      <ErrorState title={errorTitle} error={error} onRetry={onRetry} isRetrying={retrying} />
    ) : items?.length ? (
      <div className={grid} style={style}>{items.map(renderSetting)}</div>
    ) : empty}
    {footer}
  </>
}
