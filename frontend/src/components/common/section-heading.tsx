import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SectionHeadingProps extends ComponentProps<'div'> {
  heading: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

// Render a shared section heading row above a page surface.
export function SectionHeading({
  heading,
  description,
  actions,
  className,
  ...props
}: SectionHeadingProps) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)} {...props}>
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">{heading}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>

      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}
