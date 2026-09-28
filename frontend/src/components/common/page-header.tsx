import type { ReactNode } from 'react'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  eyebrow?: string
  title: string
  titleAccessory?: ReactNode
  description?: string
  actions?: ReactNode
  className?: string
}

export function PageHeader({ eyebrow, title, titleAccessory, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0 flex-1">
        {eyebrow ? <Text variant="overline" className="text-[11px] font-semibold tracking-[0.22em] text-secondary">{eyebrow}</Text> : null}
        <div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Heading level={1}>{title}</Heading>
            {titleAccessory ? <div className="shrink-0">{titleAccessory}</div> : null}
          </div>
          {description ? <Text variant="muted" className="mt-1 max-w-3xl">{description}</Text> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
