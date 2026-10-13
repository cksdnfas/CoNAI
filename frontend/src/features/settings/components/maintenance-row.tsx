import type { ReactNode } from 'react'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

/** One action row of the 유지보수 › 데이터베이스 group: icon + title + meta, actions on the right, body under it. */
export function MaintenanceRow({ icon, title, meta, actions, children }: { icon: ReactNode; title: ReactNode; meta?: ReactNode; actions: ReactNode; children?: ReactNode }) {
  return (
    <div className="border-b border-line py-2.5 last:border-b-0">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 text-muted-foreground">{icon}</span>
          <div className="shrink-0 text-sm text-foreground">{title}</div>
          {meta ? <div className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block">{meta}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      </div>
      {children ? <div className="pt-2 pl-7">{children}</div> : null}
    </div>
  )
}

/** A count from a maintenance job's result; green once the job really ran (not a preview). */
export function MaintenanceStat({ label, value, extra, done }: { label: string; value: string; extra?: string; done: boolean }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-base font-semibold tabular-nums', done && 'text-success')}>
        {value}
        {extra ? <span className="ml-1 text-xs font-normal text-muted-foreground">{extra}</span> : null}
      </div>
    </div>
  )
}

/** A running job's phase line and percentage over the bar; `value` null = indeterminate. */
export function MaintenanceJobProgress({ label, percentage, value, className }: { label: ReactNode; percentage: ReactNode; value: number | null; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="truncate">{label}</span>
        <span className="tabular-nums">{percentage}%</span>
      </div>
      <Progress size="lg" value={value} />
    </div>
  )
}
