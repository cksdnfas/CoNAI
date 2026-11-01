import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type RowGroupHeadingElement = 'h2' | 'h3' | 'h4' | 'div'

interface RowGroupProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Optional group label above the rows: bold body-size text over a hairline, never smaller or lighter than the rows' names. */
  heading?: ReactNode
  headingAs?: RowGroupHeadingElement
  /** Item count after the label (lists). Leave out while loading. */
  count?: number
  /** Colour class for the label, e.g. the kind colour (`text-resource-*`) that the rows' icons use. Default foreground. */
  headingClassName?: string
  /** Small actions at the heading row end (add, sort…). */
  actions?: ReactNode
  /** Class for the rows container (e.g. a max-width). */
  bodyClassName?: string
}

/**
 * A run of SettingRow / ListRow / ResourceRow with an optional heading. Only a label, a hairline and spacing, no
 * surface: the rows' own hairlines separate them. Space several groups with `space-y-6`/`space-y-8` on the parent.
 */
function RowGroup({ heading, headingAs: Heading = 'h3', count, headingClassName, actions, className, bodyClassName, children, ...props }: RowGroupProps) {
  return (
    <div data-slot="row-group" className={cn('min-w-0', className)} {...props}>
      {heading || actions ? (
        <div className="mb-1 flex min-h-8 items-center justify-between gap-3 border-b border-foreground/15">
          {heading ? (
            <Heading className={cn('flex min-w-0 items-center gap-2 text-sm font-bold text-foreground', headingClassName)}>
              <span className="truncate">{heading}</span>
              {count !== undefined ? <span className="shrink-0 font-medium text-muted-foreground tabular-nums">{count}</span> : null}
            </Heading>
          ) : <span />}
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
      ) : null}
      <div data-slot="row-group-body" className={bodyClassName}>{children}</div>
    </div>
  )
}

export { RowGroup }
export type { RowGroupProps }
