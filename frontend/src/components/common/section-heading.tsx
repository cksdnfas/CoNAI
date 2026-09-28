import type { ComponentProps, ReactNode } from 'react'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
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
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)} {...props}>
      <div className="min-w-0">
        <Heading level={2}>{heading}</Heading>
        {description ? (
          variant === 'inside'
            ? <Text variant="title" className="mt-2">{description}</Text>
            : <Text variant="muted">{description}</Text>
        ) : null}
      </div>

      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}
