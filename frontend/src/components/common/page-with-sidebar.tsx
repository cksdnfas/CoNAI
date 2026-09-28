import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { BottomDrawerSheet } from '@/components/ui/bottom-drawer-sheet'
import { PageSidebarContext, SidebarFooter, type PageSidebarContextValue } from '@/components/ui/sidebar'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { PageToolbar, SidebarToggle } from './page-toolbar'

interface PageWithSidebarProps {
  /** Persists the collapsed state (`conai:sidebar-collapsed:<storageKey>`). One key per page. */
  storageKey: string
  /** Sidebar content, usually a SidebarNav with SidebarGroupLabel / SidebarItem rows (or a tree). */
  sidebar: ReactNode
  /** Left part of the sidebar's bottom row (version, small actions). The collapse toggle is added on the right. */
  sidebarFooter?: ReactNode
  /** Accessible name of the sidebar; also the mobile drawer title. */
  sidebarLabel: string
  /** Column width in px on desktop. */
  sidebarWidth?: number
  /** The page's PageToolbar. It gets the sidebar toggle automatically when the sidebar is hidden. */
  toolbar?: ReactNode
  defaultCollapsed?: boolean
  className?: string
  contentClassName?: string
  children: ReactNode
}

const STORAGE_PREFIX = 'conai:sidebar-collapsed:'

function readCollapsed(storageKey: string, fallback: boolean) {
  try {
    const value = window.localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`)
    return value === null ? fallback : value === 'true'
  } catch {
    return fallback
  }
}

function writeCollapsed(storageKey: string, collapsed: boolean) {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, collapsed ? 'true' : 'false')
  } catch {
    // Storage blocked (private mode): the toggle still works for this visit.
  }
}

/**
 * Page layout with a left sidebar (DESIGN_PRESET "Flat" S1).
 * Desktop: a fixed-width column that stays in place (sticky under the app header, own scroll), separated from the
 * content by one hairline; collapsible, state persisted per `storageKey`. Narrow screens: no column; the toolbar's
 * sidebar button opens the same content in a BottomDrawerSheet. Bleeds to the shell's content edges, so render it as
 * the page root.
 */
export function PageWithSidebar({
  storageKey,
  sidebar,
  sidebarFooter,
  sidebarLabel,
  sidebarWidth = 232,
  toolbar,
  defaultCollapsed = false,
  className,
  contentClassName,
  children,
}: PageWithSidebarProps) {
  const isDesktop = useDesktopPageLayout()
  const [collapsed, setCollapsedState] = useState(() => readCollapsed(storageKey, defaultCollapsed))
  const [mobileOpen, setMobileOpen] = useState(false)

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next)
    writeCollapsed(storageKey, next)
  }, [storageKey])

  const contextValue = useMemo<PageSidebarContextValue>(() => ({
    isDesktop,
    collapsed,
    setCollapsed,
    mobileOpen: !isDesktop && mobileOpen,
    setMobileOpen,
    label: sidebarLabel,
  }), [collapsed, isDesktop, mobileOpen, setCollapsed, sidebarLabel])

  const showColumn = isDesktop && !collapsed

  return (
    <PageSidebarContext.Provider value={contextValue}>
      <div
        data-slot="page-with-sidebar"
        className={cn(
          // Cancel the shell's top gap, side padding and bottom padding so the column meets the header and runs the
          // full height; the content column puts the same spacing back.
          '-mx-(--theme-shell-inline-padding) -mt-6 -mb-(--theme-shell-main-padding-bottom) flex min-h-[calc(100dvh-var(--theme-shell-header-height))]',
          className,
        )}
        style={{ '--page-sidebar-width': `${sidebarWidth}px` } as CSSProperties}
      >
        {showColumn ? (
          <aside
            aria-label={sidebarLabel}
            data-slot="page-sidebar"
            className="sticky top-(--theme-shell-header-height) flex h-[calc(100dvh-var(--theme-shell-header-height))] w-(--page-sidebar-width) shrink-0 flex-col self-start border-r border-line"
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 pt-3.5 pb-2">{sidebar}</div>
            <SidebarFooter className="px-2.5 pr-2">
              <div className="flex min-w-0 items-center gap-2">{sidebarFooter}</div>
              <SidebarToggle />
            </SidebarFooter>
          </aside>
        ) : null}

        <div
          data-slot="page-with-sidebar-content"
          className={cn(
            'min-w-0 flex-1 pb-(--theme-shell-main-padding-bottom)',
            isDesktop ? 'px-8' : 'px-(--theme-shell-inline-padding)',
            contentClassName,
          )}
        >
          {toolbar ?? <PageToolbar />}
          {children}
        </div>
      </div>

      {!isDesktop ? (
        <BottomDrawerSheet open={mobileOpen} title={sidebarLabel} ariaLabel={sidebarLabel} onClose={() => setMobileOpen(false)}>
          {sidebar}
          {sidebarFooter ? <SidebarFooter className="mt-3">{sidebarFooter}</SidebarFooter> : null}
        </BottomDrawerSheet>
      ) : null}
    </PageSidebarContext.Provider>
  )
}
