import type { CSSProperties, PropsWithChildren, ReactNode } from 'react'
import { textVariants } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'

interface ExplorerSidebarProps extends PropsWithChildren {
  /** Overline title row; omit (with `badge`) when `headerExtra` carries the header. */
  title?: ReactNode
  badge?: ReactNode
  headerExtra?: ReactNode
  className?: string
  bodyClassName?: string
  /** Keeps the compact sticky behaviour on narrow screens. The floating frame itself is gone (flat redesign). */
  floatingFrame?: boolean
  /** @deprecated No effect: the pin toggle was removed with the floating frame. */
  floatingLockStorageKey?: string
  /** @deprecated Always reports false: the sidebar no longer floats. */
  onFloatingChange?: (isFloating: boolean) => void
}

/**
 * Legacy explorer sidebar shell, flattened: no surface, no floating frame, no pin. On desktop a hairline on the right
 * separates it from the content. New pages use `PageWithSidebar` + `SidebarNav` instead; this stays until the
 * remaining callers migrate.
 */
export function ExplorerSidebar({
  title,
  badge,
  headerExtra,
  className,
  bodyClassName,
  floatingFrame = false,
  children,
}: ExplorerSidebarProps) {
  const isDesktopPageLayout = useDesktopPageLayout()

  // Narrow screens: the sidebar stacks above the content and stays sticky with a capped height, so it needs the page
  // tone behind it (content scrolls underneath) and a hairline below.
  const isCompactSticky = floatingFrame && !isDesktopPageLayout
  const sidebarStyle: CSSProperties | undefined = isCompactSticky
    ? {
        position: 'sticky',
        top: 'var(--theme-shell-header-height)',
        maxHeight: 'max(30vh, 16rem)',
      }
    : undefined

  return (
    <aside
      className={cn(
        'explorer-sidebar relative flex min-h-0 flex-col py-1',
        isDesktopPageLayout ? 'border-r border-line pr-4' : 'border-b border-line pb-3',
        isCompactSticky && 'bg-background',
        className,
      )}
      style={sidebarStyle}
      data-floating="false"
    >
      {/*
        Compact sticky mode caps the whole sidebar, so header tools + list scroll together in one container. Scrolling
        only the list left it a sliver (or nothing) under tall header tools on phones.
      */}
      <div className={cn('flex min-h-0 flex-1 flex-col', isCompactSticky && '-mr-2 overflow-y-auto overscroll-contain pr-2')}>
        {title || badge ? (
          <div className="mb-3 flex items-center justify-between gap-3">
            {title ? <h2 className={cn(textVariants({ variant: 'overline' }), 'font-semibold')}>{title}</h2> : null}
            {badge}
          </div>
        ) : null}

        {headerExtra ? <div className="mb-3">{headerExtra}</div> : null}

        <div className={cn('min-h-0 flex-1', bodyClassName, isCompactSticky && 'flex-none overflow-y-visible')}>{children}</div>
      </div>
    </aside>
  )
}
