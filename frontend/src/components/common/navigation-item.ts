import { cn } from '@/lib/utils'

type NavigationItemClassOptions = {
  active: boolean
  density?: 'sm' | 'md'
  fullWidth?: boolean
  className?: string
}

/**
 * Build the shared className for navigation and selection items that cannot be a Button (e.g. block layouts).
 * Mirrors Button `variant="nav"` / SidebarItem: muted row, fill wash on hover, current row = fill + 2px primary bar on
 * the left + foreground text. Prefer `<Button variant="nav" data-active>` when the row fits a Button.
 */
export function getNavigationItemClassName({
  active,
  density = 'md',
  fullWidth = true,
  className,
}: NavigationItemClassOptions) {
  return cn(
    'rounded-sm text-left transition-colors',
    fullWidth && 'w-full',
    density === 'sm' ? 'px-2 py-2 text-sm' : 'px-3 py-2 text-sm',
    active
      ? 'bg-fill font-medium text-foreground shadow-[inset_2px_0_0_var(--primary)]'
      : 'text-muted-foreground hover:bg-fill hover:text-foreground',
    className,
  )
}
