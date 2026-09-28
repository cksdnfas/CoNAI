import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface StatTileProps extends ComponentProps<'div'> {
  label: ReactNode
  value: ReactNode
  valueClassName?: string
}

/** Render a labelled value tile for summaries and metadata blocks. */
function StatTile({ label, value, className, valueClassName, ...props }: StatTileProps) {
  return (
    <div data-slot="stat-tile" className={cn('min-w-0 rounded-sm border border-border/70 bg-surface-low/45 px-3 py-3', className)} {...props}>
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={cn('mt-2 text-sm font-semibold text-foreground', valueClassName)}>{value}</div>
    </div>
  )
}

export { StatTile }
