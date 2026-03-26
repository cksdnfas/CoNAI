import type { PropsWithChildren, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ExplorerSidebarProps extends PropsWithChildren {
  title: ReactNode
  badge?: ReactNode
  headerExtra?: ReactNode
  className?: string
  bodyClassName?: string
}

/** Render a reusable sidebar shell for explorer-style navigation panels. */
export function ExplorerSidebar({ title, badge, headerExtra, className, bodyClassName, children }: ExplorerSidebarProps) {
  return (
    <aside className={cn('rounded-sm bg-surface-lowest p-4', className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold tracking-[0.22em] text-muted-foreground uppercase">{title}</h2>
        {badge}
      </div>

      {headerExtra ? <div className="mb-4">{headerExtra}</div> : null}

      <div className={bodyClassName}>{children}</div>
    </aside>
  )
}
