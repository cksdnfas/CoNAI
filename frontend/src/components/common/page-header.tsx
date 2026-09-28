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

/**
 * @deprecated Flat redesign: use `PageToolbar` (components/common/page-toolbar) — one 56px row, title left, icon
 * actions right, no eyebrow / description. Kept only until every page has migrated.
 */
export function PageHeader({ eyebrow, title, titleAccessory, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0 flex-1">
        {/* Quiet kicker (D1): muted overline, no accent colour or rule line; the title carries the emphasis. */}
        {eyebrow ? <Text variant="overline" className="font-semibold">{eyebrow}</Text> : null}
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
