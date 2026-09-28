import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * Render a subtle-fill block for dense notes, previews and code (one step off the page, surface-low). It is the only
 * box in its area: never put an Inset inside a Panel / raised Section, and prefer plain text or rows for key/value
 * summaries. Nesting no longer recesses it.
 */
function Inset({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="inset" className={cn('ui-tone-plinth rounded-sm px-4 py-3', className)} {...props} />
}

export { Inset }
