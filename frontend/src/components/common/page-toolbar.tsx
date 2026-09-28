import { useEffect, useRef, useState, type ReactNode } from 'react'
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
  /** Stay under the app header while the page scrolls (default). Turn off for toolbars that are not at the page top. */
  sticky?: boolean
}

/** True once the sticky toolbar has reached the header, so it only gets a surface while it floats over content. */
function useStuckUnderHeader(enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [isStuck, setIsStuck] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!enabled || !node || typeof window === 'undefined') {
      setIsStuck(false)
      return
    }

    let frame = 0
    const update = () => {
      frame = 0
      const top = Number.parseFloat(window.getComputedStyle(node).top || '0') || 0
      setIsStuck(window.scrollY > 0 && node.getBoundingClientRect().top <= top + 0.5)
    }
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [enabled])

  return { ref, isStuck }
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
export function PageToolbar({ title, start, children, actions, className, sticky = true }: PageToolbarProps) {
  const sidebar = usePageSidebar()
  const showSidebarToggle = Boolean(sidebar && (!sidebar.isDesktop || sidebar.collapsed))
  const { ref, isStuck } = useStuckUnderHeader(sticky)

  if (!title && !start && !children && !actions && !showSidebarToggle) {
    return null
  }

  return (
    <div
      ref={ref}
      data-slot="page-toolbar"
      data-stuck={isStuck || undefined}
      className={cn(
        'flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 py-2',
        // Sticky under the header so the sidebar toggle and page actions stay reachable anywhere on the page. It is flat
        // at rest and only takes a surface + hairline while it floats over scrolled content.
        sticky && '-mx-(--page-gutter) sticky top-(--theme-shell-header-height) z-sticky px-(--page-gutter) transition-[background-color,box-shadow] duration-150',
        sticky && isStuck && 'bg-background/92 shadow-[0_1px_0_var(--line)] backdrop-blur-md',
        className,
      )}
    >
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
