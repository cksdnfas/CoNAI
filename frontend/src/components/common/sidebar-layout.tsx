import type { CSSProperties, ReactNode } from 'react'
import { SidebarFooter } from '@/components/ui/sidebar'
import { useMinWidth } from '@/lib/use-min-width'
import { cn } from '@/lib/utils'

/**
 * Sets `--page-gutter` on a content column: `--content-gutter` where a sidebar column can sit beside it (desktop
 * PageWithSidebar keeps it while the column is collapsed), `--content-gutter-narrow` otherwise. Toolbars and bodies
 * inside use `px-(--page-gutter)` so they share one inset.
 */
export function pageGutterStyle(besideColumn: boolean): CSSProperties {
  return { '--page-gutter': besideColumn ? 'var(--content-gutter)' : 'var(--content-gutter-narrow)' } as CSSProperties
}

interface SidebarColumnProps {
  /** `nav` when the column holds navigation / filter rows (chat list, picker trees); a page column stays `aside`. */
  as?: 'aside' | 'nav'
  /** Accessible name of the column. */
  label?: string
  /** Bottom row (a SidebarFooter), outside the scrolling body. */
  footer?: ReactNode
  /** Positioning only: sticky / height / responsive display. */
  className?: string
  /** Body layout only, e.g. `flex flex-col` when the content brings its own scroller. */
  bodyClassName?: string
  children: ReactNode
}

/**
 * The one sidebar column spec (DESIGN_PRESET "Page layout"): `--sidebar-column-width`, inner padding from the
 * `--sidebar-column-padding-*` tokens, a right hairline, its own scroll. PageWithSidebar, TwoPane and the chat page
 * render it; do not re-type the classes.
 */
export function SidebarColumn({ as: Comp = 'aside', label, footer, className, bodyClassName, children }: SidebarColumnProps) {
  return (
    <Comp aria-label={label} data-slot="sidebar-column" className={cn('flex w-(--sidebar-column-width) shrink-0 flex-col border-r border-line', className)}>
      <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-(--sidebar-column-padding-x) pt-(--sidebar-column-padding-top) pb-(--sidebar-column-padding-bottom)', bodyClassName)}>
        {children}
      </div>
      {footer}
    </Comp>
  )
}

/** Width from which TwoPane shows its column (Tailwind `sm`). Below it the content pane is alone. */
const TWO_PANE_COLUMN_MIN_WIDTH = 640

interface TwoPaneProps {
  /** Column content (tree / nav rows). Omit for a single content pane with the same edges and gutter. */
  sidebar?: ReactNode
  sidebarLabel?: string
  /** Left part of the column's bottom row. */
  sidebarFooter?: ReactNode
  /**
   * Cancel the Modal body's side padding (`px-4 md:px-5` in components/ui/modal) so the panes run edge to edge between
   * two hairlines. `false` inside a framed block that has no padding to cancel.
   */
  bleed?: boolean
  /** Layout only (height, frame). */
  className?: string
  children: ReactNode
}

/**
 * In-panel split: SidebarColumn on the left, a content pane on the right, each scrolling on its own (pickers inside a
 * Modal, catalog mocks). The content pane carries `--page-gutter`; put its rows in TwoPaneToolbar and give the body
 * `px-(--page-gutter)`. Narrow screens: no column (offer the column content another way, e.g. a popover).
 */
export function TwoPane({ sidebar, sidebarLabel, sidebarFooter, bleed = true, className, children }: TwoPaneProps) {
  const wide = useMinWidth(TWO_PANE_COLUMN_MIN_WIDTH)
  const showColumn = sidebar !== undefined && sidebar !== null && wide

  return (
    <div data-slot="two-pane" className={cn('flex min-h-0 flex-1', bleed && '-mx-4 border-y border-line md:-mx-5', className)}>
      {showColumn ? (
        <SidebarColumn as="nav" label={sidebarLabel} footer={sidebarFooter ? <SidebarFooter>{sidebarFooter}</SidebarFooter> : null}>
          {sidebar}
        </SidebarColumn>
      ) : null}
      <div data-slot="two-pane-content" className="flex min-w-0 flex-1 flex-col" style={pageGutterStyle(showColumn)}>
        {children}
      </div>
    </div>
  )
}

/** The content pane's one-row toolbar: horizontal inset = the content gutter. */
export function TwoPaneToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div data-slot="two-pane-toolbar" className={cn('flex shrink-0 flex-wrap items-center gap-2 px-(--page-gutter) py-2.5', className)}>{children}</div>
}
