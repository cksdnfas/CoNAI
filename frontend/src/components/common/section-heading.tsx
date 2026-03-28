import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SectionHeadingProps extends ComponentProps<'div'> {
  heading: ReactNode
  description?: ReactNode
  actions?: ReactNode
  variant?: 'outside' | 'inside'
}

// Render a shared section heading row for either page sections or card-internal headings.
export function SectionHeading({
  heading,
  description,
  actions,
  variant = 'outside',
  className,
  ...props
}: SectionHeadingProps) {
  const descriptionClassName = variant === 'inside'
    ? 'mt-2 text-sm font-semibold text-foreground'
    : 'text-sm text-muted-foreground'

  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)} {...props}>
      <div className="min-w-0">
        <p className="text-xl font-semibold tracking-tight text-foreground">{heading}</p>
        {description ? <p className={descriptionClassName}>{description}</p> : null}
      </div>

      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}
