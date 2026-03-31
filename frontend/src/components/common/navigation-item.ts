import { cn } from '@/lib/utils'

type NavigationItemClassOptions = {
  active: boolean
  density?: 'sm' | 'md'
  fullWidth?: boolean
  className?: string
}

/** Build the shared className for navigation and selection items. */
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
      ? 'bg-surface-container text-primary'
      : 'text-muted-foreground hover:bg-surface-low hover:text-foreground',
    className,
  )
}
