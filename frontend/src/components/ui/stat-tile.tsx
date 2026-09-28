import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Text } from './text'

interface StatTileProps extends ComponentProps<'div'> {
  label: ReactNode
  value: ReactNode
  valueClassName?: string
}

/** Render a labelled value tile for summaries and metadata blocks. */
function StatTile({ label, value, className, valueClassName, ...props }: StatTileProps) {
  return (
    <div data-slot="stat-tile" className={cn('ui-tone-plinth min-w-0 rounded-sm px-3 py-3', className)} {...props}>
      <Text as="div" variant="overline">{label}</Text>
      <Text as="div" variant="title" className={cn('mt-2', valueClassName)}>{value}</Text>
    </div>
  )
}

export { StatTile }
