import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** Render a light inset surface for dense notes, summaries, previews and empty states. */
function Inset({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="inset" className={cn('rounded-sm border border-border/70 bg-surface-low/45 px-4 py-3', className)} {...props} />
}

export { Inset }
