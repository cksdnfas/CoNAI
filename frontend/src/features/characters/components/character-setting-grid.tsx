import type { ReactNode } from 'react'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * The character card grid (appearance settings, catalog, chat profiles). Cards per row follow the width the grid really
 * has (sidebar, docked chat, dialog), not the window, so a card keeps room for its name; never fewer than two per row.
 */
export const characterCardGridClassName = 'grid grid-cols-[repeat(auto-fill,minmax(min(11rem,calc(50%_-_0.5rem)),1fr))] gap-4'

/**
 * Settings as a card grid with its loading and error states and the empty state; `footer` carries the paging (previous /
 * next in the pickers, the load-more sentinel on the library page).
 */
export function CharacterSettingGrid<T>({ items, pending, error, onRetry, retrying = false, footer, renderSetting, empty, errorTitle }: {
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
  errorTitle: string
}) {
  const grid = cn(characterCardGridClassName, 'pt-2')
  return <>
    {pending ? (
      <div className={grid}>{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} radius="sm" className="aspect-[3/4] w-full" />)}</div>
    ) : error && !items ? (
      <ErrorState title={errorTitle} error={error} onRetry={onRetry} isRetrying={retrying} />
    ) : items?.length ? (
      <div className={grid}>{items.map(renderSetting)}</div>
    ) : empty}
    {footer}
  </>
}
