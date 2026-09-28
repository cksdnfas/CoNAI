import { cn } from '@/lib/utils'

/** Accept only plain hex colours from the group record before putting them in an inline style. */
const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

interface GroupColorDotProps {
  color?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/** Render the group's colour as a small dot; groups without a colour get a neutral one. */
export function GroupColorDot({ color, size = 'sm', className }: GroupColorDotProps) {
  const safeColor = color && HEX_COLOR_PATTERN.test(color.trim()) ? color.trim() : null

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block shrink-0 rounded-full',
        size === 'sm' ? 'size-2' : size === 'md' ? 'size-2.5' : 'size-3.5',
        !safeColor && 'bg-muted-foreground/45',
        className,
      )}
      style={safeColor ? { backgroundColor: safeColor } : undefined}
    />
  )
}
