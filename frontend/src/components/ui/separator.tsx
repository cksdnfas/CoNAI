import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type SeparatorProps = ComponentProps<'div'> & {
  orientation?: 'horizontal' | 'vertical'
  /** Purely visual by default; set false when the line separates content semantically. */
  decorative?: boolean
}

/** Render the rare divider that spacing and tone cannot replace (lists inside one surface, toolbars). */
function Separator({ className, orientation = 'horizontal', decorative = true, ...props }: SeparatorProps) {
  return (
    <div
      data-slot="separator"
      data-orientation={orientation}
      role={decorative ? 'none' : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      className={cn('shrink-0 bg-outline-subtle', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px self-stretch', className)}
      {...props}
    />
  )
}

export { Separator }
