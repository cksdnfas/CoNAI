import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  className?: string
}

export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-6 md:flex-row md:items-end md:justify-between', className)}>
      <div className="space-y-3">
        {eyebrow ? <p className="text-[11px] font-semibold tracking-[0.22em] text-secondary uppercase">{eyebrow}</p> : null}
        <div className="space-y-3">
          <h1 className="max-w-4xl text-4xl font-extrabold tracking-[-0.03em] text-balance md:text-5xl">{title}</h1>
          {description ? <p className="max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
