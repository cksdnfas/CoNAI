import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Text } from './text'

interface StatTileProps extends ComponentProps<'div'> {
  label: ReactNode
  value: ReactNode
  valueClassName?: string
  /** `flat` (default): overline label + value on the page, no box. `fill`: the old subtle-fill tile. */
  tone?: 'flat' | 'fill'
}

/** Render a labelled value for summaries and metadata. Flat by default; lay several out in a grid with a gap. */
function StatTile({ label, value, className, valueClassName, tone = 'flat', ...props }: StatTileProps) {
  return (
    <div
      data-slot="stat-tile"
      data-tone={tone}
      className={cn('min-w-0', tone === 'fill' ? 'ui-tone-plinth rounded-sm px-3 py-3' : 'py-1', className)}
      {...props}
    >
      <Text as="div" variant="overline">{label}</Text>
      <Text as="div" variant="title" className={cn(tone === 'fill' ? 'mt-2' : 'mt-1', valueClassName)}>{value}</Text>
    </div>
  )
}

export { StatTile }
