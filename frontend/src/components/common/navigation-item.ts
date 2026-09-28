import { cn } from '@/lib/utils'

type NavigationItemClassOptions = {
  active: boolean
  density?: 'sm' | 'md'
  fullWidth?: boolean
  className?: string
}

/**
 * Build the shared className for navigation and selection items that cannot be a Button (e.g. block layouts).
 * Mirrors Button `variant="nav"`: muted row, surface-high hover, current row = primary/12 tint + foreground text
 * with a primary icon. Prefer `<Button variant="nav" data-active>` when the row fits a Button.
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
      ? 'bg-primary/12 font-medium text-foreground [&_svg]:text-primary'
      : 'text-muted-foreground hover:bg-surface-high hover:text-foreground',
    className,
  )
}
