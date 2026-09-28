import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * Render a tonal inset for dense notes, summaries, previews and empty states.
 * surface-low on the page; recessed to surface-lowest inside a raised surface (Section, Card, Panel, drawer).
 */
function Inset({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="inset" className={cn('ui-tone-plinth rounded-sm px-4 py-3', className)} {...props} />
}

export { Inset }
