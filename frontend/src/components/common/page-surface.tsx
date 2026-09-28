import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageSectionProps extends Omit<ComponentProps<'section'>, 'title'> {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  headerClassName?: string
  bodyClassName?: string
}

/** Render one shared minimal page section shell with an optional compact header row. */
export function PageSection({
  title,
  description,
  actions,
  children,
  className,
  headerClassName,
  bodyClassName,
  ...props
}: PageSectionProps) {
  const hasHeader = title || description || actions

  return (
    <section className={cn('overflow-hidden rounded-sm border border-border/85 bg-surface-container/30', className)} {...props}>
      {hasHeader ? (
        <div className={cn('flex flex-col gap-3 border-b border-border/85 px-4 py-3 sm:flex-row sm:items-start sm:justify-between', headerClassName)}>
          <div className="min-w-0 flex-1">
            {title ? <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2> : null}
            {description ? <div className="mt-1 text-sm text-muted-foreground">{description}</div> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}

      <div className={cn('space-y-4 px-4 py-4', bodyClassName)}>{children}</div>
    </section>
  )
}
