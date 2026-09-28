import type { ReactNode } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { usePageSidebar } from '@/components/ui/sidebar'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

interface PageToolbarProps {
  /** Page title (rendered as the page h1). Omit when `start` carries the left side (e.g. a SegmentedControl). */
  title?: ReactNode
  /** Left slot after the title: segmented control, breadcrumb, count… */
  start?: ReactNode
  /** Flexible middle (search field, filters). Takes the remaining width. */
  children?: ReactNode
  /** Right slot: ghost IconButtons, one primary Button at most. */
  actions?: ReactNode
  className?: string
}

/**
 * Show / hide the surrounding PageWithSidebar: on desktop it collapses or reopens the column, on narrow screens it
 * opens the sidebar drawer. Renders nothing outside a PageWithSidebar.
 */
export function SidebarToggle({ className }: { className?: string }) {
  const { t } = useI18n()
  const sidebar = usePageSidebar()

  if (!sidebar) {
    return null
  }

  if (!sidebar.isDesktop) {
    return (
      <IconButton variant="ghost" size="icon-sm" className={className} label={sidebar.label || t({ ko: '사이드바 열기', en: 'Open sidebar' })} aria-expanded={sidebar.mobileOpen} onClick={() => sidebar.setMobileOpen(true)}>
        <PanelLeftOpen />
      </IconButton>
    )
  }

  return sidebar.collapsed ? (
    <IconButton variant="ghost" size="icon-sm" className={className} label={t({ ko: '사이드바 열기', en: 'Show sidebar' })} onClick={() => sidebar.setCollapsed(false)}>
      <PanelLeftOpen />
    </IconButton>
  ) : (
    <IconButton variant="ghost" size="icon-sm" className={className} label={t({ ko: '사이드바 접기', en: 'Hide sidebar' })} onClick={() => sidebar.setCollapsed(true)}>
      <PanelLeftClose />
    </IconButton>
  )
}

/**
 * One ~56px page row with no surface: [sidebar toggle] title / start · flexible middle · right actions.
 * Replaces PageHeader title rows. Inside PageWithSidebar the sidebar toggle is added automatically whenever the
 * sidebar is not visible (desktop collapsed, or any narrow screen). Wraps onto a second line on narrow screens.
 */
export function PageToolbar({ title, start, children, actions, className }: PageToolbarProps) {
  const sidebar = usePageSidebar()
  const showSidebarToggle = Boolean(sidebar && (!sidebar.isDesktop || sidebar.collapsed))

  if (!title && !start && !children && !actions && !showSidebarToggle) {
    return null
  }

  return (
    <div data-slot="page-toolbar" className={cn('flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 py-2', className)}>
      {showSidebarToggle || title || start ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          {showSidebarToggle || title ? (
            <div className="flex min-w-0 items-center gap-2">
              {showSidebarToggle ? <SidebarToggle className="-ml-1.5" /> : null}
              {title ? <h1 className="min-w-0 truncate text-base font-bold tracking-tight text-foreground">{title}</h1> : null}
            </div>
          ) : null}
          {start}
        </div>
      ) : null}
      {children ? <div className="flex min-w-0 flex-1 basis-60 items-center gap-2">{children}</div> : <div className="flex-1" />}
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  )
}
