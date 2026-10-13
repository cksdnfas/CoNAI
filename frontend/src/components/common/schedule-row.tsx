import type { ReactNode } from 'react'
import { shortRunLabel } from '@/components/common/schedule-field'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/** `active` runs on its schedule, `stopped` halted on errors, `idle` is paused or done. */
export type ScheduleRowStatus = 'active' | 'stopped' | 'idle'

/** The status as a dot before the name (its label is the dot's name). */
function ScheduleStatusDot({ status, label }: { status: ScheduleRowStatus; label: string }) {
  const tone = status === 'active' ? 'bg-success' : status === 'stopped' ? 'bg-destructive' : 'bg-surface-highest ring-1 ring-inset ring-muted-foreground/60'
  return <span role="img" aria-label={label} className={cn('size-1.5 shrink-0 rounded-full', tone)} />
}

/** The end column: "다음" over the next run time while it runs, else the status label (red when stopped). Hidden on phones. */
function ScheduleNextRun({ nextRunAt, statusLabel, stopped }: { nextRunAt: string | null | undefined; statusLabel: string; stopped: boolean }) {
  const { t, formatDate } = useI18n()
  return (
    <div className="hidden shrink-0 flex-col items-end pt-0.5 text-2xs tabular-nums text-muted-foreground sm:flex">
      {nextRunAt ? <>
        <span>{t({ ko: '다음', en: 'Next' })}</span>
        <span className="text-xs font-semibold text-foreground">{shortRunLabel(nextRunAt, t, formatDate)}</span>
      </> : <span className={cn(stopped && 'text-destructive')}>{statusLabel}</span>}
    </div>
  )
}

/**
 * One schedule in a list (workflow autoruns, chat routines): the thing's face, a status dot, the name and its cadence,
 * a muted details line, a smaller stats line, when it runs next on the row's end, then `actions`. `notice` (why it
 * stopped, the last error) sits under the text, indented past the face; `compact` shows it as one clipped line.
 */
export function ScheduleRow({ leading, status, statusLabel, name, cadence, details, stats, nextRunAt, actions, notice, noticeTone = 'warning', compact = false }: {
  leading: ReactNode
  status: ScheduleRowStatus
  statusLabel: string
  name: ReactNode
  cadence: ReactNode
  details?: ReactNode
  stats?: ReactNode
  /** Shown only while `status` is active. */
  nextRunAt?: string | null
  actions?: ReactNode
  notice?: ReactNode
  noticeTone?: 'warning' | 'destructive'
  compact?: boolean
}) {
  const active = status === 'active'
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-b border-line py-2.5 last:border-b-0">
      <div className="flex items-start">{leading}</div>
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <ScheduleStatusDot status={status} label={statusLabel} />
            <span className="truncate text-sm font-semibold text-foreground">{name}</span>
            <span className={cn('text-xs font-semibold tabular-nums', active ? 'text-secondary-text' : 'text-muted-foreground')}>{cadence}</span>
          </div>
          {details ? <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">{details}</div> : null}
          {stats ? <div className="flex flex-wrap items-center gap-x-1.5 text-2xs tabular-nums text-muted-foreground">{stats}</div> : null}
        </div>
        <ScheduleNextRun nextRunAt={active ? nextRunAt : null} statusLabel={statusLabel} stopped={status === 'stopped'} />
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {notice ? (
        <div
          role="status"
          className={cn(
            'col-start-2',
            compact
              ? cn('mt-1 truncate text-2xs', noticeTone === 'destructive' ? 'text-destructive' : 'text-warning')
              : cn('mt-2 rounded-sm px-3 py-2 text-xs', noticeTone === 'destructive' ? 'bg-destructive-soft/50 text-destructive-soft-foreground' : 'bg-warning-soft/45 text-muted-foreground'),
          )}
        >
          {notice}
        </div>
      ) : null}
    </div>
  )
}
