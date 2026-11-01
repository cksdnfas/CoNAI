import type { ComponentProps, ReactNode } from 'react'
import { Heading } from '@/components/ui/heading'
import { cn } from '@/lib/utils'

interface SectionHeadingProps extends ComponentProps<'div'> {
  heading: ReactNode
  actions?: ReactNode
}

// Render a shared section heading row for either page sections or card-internal headings.
export function SectionHeading({
  heading,
  actions,
  className,
  ...props
}: SectionHeadingProps) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)} {...props}>
      <div className="min-w-0">
        <Heading level={2}>{heading}</Heading>
      </div>

      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}
