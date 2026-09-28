import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type RowGroupHeadingElement = 'h2' | 'h3' | 'h4' | 'div'

interface RowGroupProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Optional group title above the rows (small, semibold, no box). */
  heading?: ReactNode
  headingAs?: RowGroupHeadingElement
  /** Small actions at the heading row end (add, sort…). */
  actions?: ReactNode
  /** Class for the rows container (e.g. a max-width). */
  bodyClassName?: string
}

/**
 * A run of SettingRow / ListRow with an optional heading. Only a heading and spacing, no surface: the rows' own
 * hairlines separate them. Space several groups with `space-y-6`/`space-y-8` on the parent.
 */
function RowGroup({ heading, headingAs: Heading = 'h3', actions, className, bodyClassName, children, ...props }: RowGroupProps) {
  return (
    <div data-slot="row-group" className={cn('min-w-0', className)} {...props}>
      {heading || actions ? (
        <div className="flex min-h-8 items-center justify-between gap-3">
          {heading ? <Heading className="min-w-0 truncate text-sm font-semibold tracking-tight text-foreground">{heading}</Heading> : <span />}
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
      ) : null}
      <div data-slot="row-group-body" className={bodyClassName}>{children}</div>
    </div>
  )
}

export { RowGroup }
export type { RowGroupProps }
