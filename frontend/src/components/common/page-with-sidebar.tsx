import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { BottomDrawerSheet } from '@/components/ui/bottom-drawer-sheet'
import { PageSidebarContext, SidebarFooter, type PageSidebarContextValue } from '@/components/ui/sidebar'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { PageToolbar, SidebarToggle } from './page-toolbar'
import { pageGutterStyle, SidebarColumn } from './sidebar-layout'

interface PageWithSidebarProps {
  /** Persists the collapsed state (`conai:sidebar-collapsed:<storageKey>`). One key per page. */
  storageKey: string
  /** Sidebar content, usually a SidebarNav with SidebarGroupLabel / SidebarItem rows (or a tree). */
  sidebar: ReactNode
  /** Left part of the sidebar's bottom row (version, small actions). The collapse toggle is added on the right. */
  sidebarFooter?: ReactNode
  /** Accessible name of the sidebar; also the mobile drawer title. */
  sidebarLabel: string
  /** Column width in px on desktop; default `--sidebar-column-width` (232px). */
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
  sidebarWidth,
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
        // page-bleed: the column runs the full height and edge; the content column puts the bottom padding back.
        className={cn('page-bleed flex min-h-(--shell-content-height)', className)}
        style={sidebarWidth ? { '--sidebar-column-width': `${sidebarWidth}px` } as CSSProperties : undefined}
      >
        {showColumn ? (
          <SidebarColumn
            label={sidebarLabel}
            className="sticky top-(--theme-shell-header-height) h-(--shell-content-height) self-start"
            footer={(
              <SidebarFooter>
                <div className="flex min-w-0 items-center gap-2">{sidebarFooter}</div>
                <SidebarToggle />
              </SidebarFooter>
            )}
          >
            {sidebar}
          </SidebarColumn>
        ) : null}

        <div
          data-slot="page-with-sidebar-content"
          // The sticky PageToolbar bleeds its background across this gutter.
          className={cn('min-w-0 flex-1 px-(--page-gutter) pb-(--theme-shell-main-padding-bottom)', contentClassName)}
          style={pageGutterStyle(isDesktop)}
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
