import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  type ComponentProps,
  type ComponentType,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Slot } from 'radix-ui'
import { cn } from '@/lib/utils'

/** State shared by PageWithSidebar with its toolbar toggle and sidebar rows. */
interface PageSidebarContextValue {
  /** Desktop layout: the sidebar is a column. Otherwise it lives in a bottom drawer. */
  isDesktop: boolean
  /** Desktop column hidden by the user (persisted per storageKey). */
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  /** Mobile drawer state. */
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
  /** Accessible name of the sidebar (drawer title). */
  label: string
}

const PageSidebarContext = createContext<PageSidebarContextValue | null>(null)

/** Read the surrounding PageWithSidebar state, or null outside one. */
function usePageSidebar() {
  return useContext(PageSidebarContext)
}

/** Vertical list of SidebarGroupLabel / SidebarItem rows. */
function SidebarNav({ className, ...props }: ComponentProps<'nav'>) {
  return <nav data-slot="sidebar-nav" className={cn('flex min-w-0 flex-col gap-0.5', className)} {...props} />
}

interface SidebarGroupLabelProps extends ComponentProps<'div'> {
  /** Small trailing action (e.g. an icon-xs "add" IconButton). */
  actions?: ReactNode
}

/** Quiet group caption between sidebar rows. */
function SidebarGroupLabel({ className, children, actions, ...props }: SidebarGroupLabelProps) {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn(
        'flex min-h-7 items-center justify-between gap-2 px-2.5 pt-3 pb-1 text-2xs font-semibold text-muted-foreground/75 first:pt-0.5',
        className,
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      {actions ? <span className="flex shrink-0 items-center">{actions}</span> : null}
    </div>
  )
}

type SidebarItemIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

interface SidebarItemProps extends Omit<ComponentProps<'button'>, 'children'> {
  /** Lucide icon component or a prebuilt node (colour dot, thumbnail). */
  icon?: SidebarItemIcon | ReactNode
  label: ReactNode
  /** Right-aligned count (tabular numbers). */
  count?: ReactNode
  /** Extra trailing node after the count (e.g. a row menu). Keep it small. */
  trailing?: ReactNode
  /** Current row: subtle fill + 2px primary bar on the left; sets aria-current. */
  active?: boolean
  /** Tree indent level (0 = none, 16px per level). */
  depth?: number
  /** Render the single child (e.g. a router Link) as the row instead of a <button>; its own children are replaced. */
  asChild?: boolean
  children?: ReactNode
}

function renderSidebarIcon(icon: SidebarItemProps['icon']) {
  if (icon === null || icon === undefined || icon === false) {
    return null
  }

  const isComponent = typeof icon === 'function' || (typeof icon === 'object' && !isValidElement(icon) && '$$typeof' in icon)
  if (isComponent) {
    const Icon = icon as SidebarItemIcon
    return <Icon className="size-4 shrink-0" aria-hidden />
  }

  return <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>{icon as ReactNode}</span>
}

/**
 * One sidebar row: icon, label, count. Inside PageWithSidebar's mobile drawer a click also closes the drawer.
 */
function SidebarItem({
  icon,
  label,
  count,
  trailing,
  active = false,
  depth = 0,
  asChild = false,
  className,
  style,
  onClick,
  children,
  type = 'button',
  ...props
}: SidebarItemProps) {
  const sidebar = usePageSidebar()
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event)
    if (!event.defaultPrevented && sidebar && !sidebar.isDesktop) {
      sidebar.setMobileOpen(false)
    }
  }

  const content = (
    <>
      {renderSidebarIcon(icon)}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count !== null ? (
        <span className="shrink-0 text-xs text-muted-foreground/75 tabular-nums">{count}</span>
      ) : null}
      {trailing ? <span className="flex shrink-0 items-center">{trailing}</span> : null}
    </>
  )
  const rowClassName = cn(
    'flex min-h-9 w-full min-w-0 items-center gap-2.5 rounded-sm px-2.5 text-left text-sm text-muted-foreground transition-colors outline-none',
    'hover:bg-fill hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
    'data-[active=true]:bg-fill data-[active=true]:font-medium data-[active=true]:text-foreground data-[active=true]:shadow-[inset_2px_0_0_var(--primary)]',
    className,
  )
  const rowStyle = depth > 0 ? { paddingLeft: `calc(0.625rem + ${depth} * 1rem)`, ...style } : style

  if (asChild && isValidElement(children)) {
    return (
      <Slot.Root
        data-slot="sidebar-item"
        data-active={active ? 'true' : undefined}
        aria-current={active ? 'page' : undefined}
        className={rowClassName}
        style={rowStyle}
        onClick={handleClick}
        {...props}
      >
        {cloneElement(children as ReactElement<{ children?: ReactNode }>, undefined, content)}
      </Slot.Root>
    )
  }

  return (
    <button
      type={type}
      data-slot="sidebar-item"
      data-active={active ? 'true' : undefined}
      aria-current={active ? 'page' : undefined}
      className={rowClassName}
      style={rowStyle}
      onClick={handleClick}
      {...props}
    >
      {content}
    </button>
  )
}

/** Bottom row of the sidebar column (version, small actions). PageWithSidebar adds the collapse toggle itself. */
function SidebarFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn('flex min-h-11 items-center justify-between gap-2 px-2.5 text-2xs text-muted-foreground/75', className)}
      {...props}
    />
  )
}

export { PageSidebarContext, SidebarFooter, SidebarGroupLabel, SidebarItem, SidebarNav, usePageSidebar }
export type { PageSidebarContextValue, SidebarItemProps }
