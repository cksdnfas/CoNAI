import type { ReactNode } from 'react'
import { shortRunLabel } from '@/components/common/schedule-field'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { getReservationTypeLabel } from '@/features/image-generation/components/workflow-reservations-ui'
import { useI18n } from '@/i18n'
import type { GraphWorkflowScheduleRecord } from '@/lib/api-module-graph'
import { cn } from '@/lib/utils'
import { getGraphWorkflowScheduleStatusLabel, getGraphWorkflowStopReasonLabel } from '../module-graph-shared'
import { WorkflowCover } from './workflow-picker'

/**
 * One workflow autorun in a list: the workflow's face, a status dot, the name and its cadence, what it runs, and when it
 * runs next on the row's end. `compact` (the header queue popup) keeps the first two lines; `actions` sit at the end.
 */
export function WorkflowScheduleRow({ schedule, workflowName, cover, compact = false, actions }: {
  schedule: GraphWorkflowScheduleRecord
  workflowName: string
  cover?: string | null
  compact?: boolean
  actions?: ReactNode
}) {
  const { t, formatNumber, formatDate } = useI18n()
  const auth = useAuthStatusQuery().data
  const active = schedule.status === 'active'
  const stopped = schedule.status === 'error_stopped' || schedule.status === 'overlap_stopped'
  const statusLabel = getGraphWorkflowScheduleStatusLabel(schedule.status, t)
  const cadence = schedule.schedule_type === 'once'
    ? t({ ko: '1회 · {time}', en: 'Once · {time}' }, { time: schedule.run_at ? shortRunLabel(schedule.run_at, t, formatDate) : '-' })
    : getReservationTypeLabel(schedule, t, formatNumber)
  const perRun = schedule.run_enqueue_count ?? 1
  const runAs = schedule.run_as_account_name
    ? schedule.run_as_account_id !== auth?.accountId ? schedule.run_as_account_name : null
    : auth?.hasCredentials ? t({ ko: '실행 계정 없음', en: 'No run-as account' }) : null
  const details = [
    workflowName,
    perRun > 1 ? t({ ko: '한 번에 {count}개', en: '{count} per run' }, { count: formatNumber(perRun) }) : null,
    !compact && schedule.failure_policy === 'continue' ? t({ ko: '실패해도 계속', en: 'Continues on failure' }) : null,
    !compact ? runAs : null,
  ].filter(Boolean).join(' · ')
  const maxRuns = schedule.max_run_count !== null && schedule.max_run_count !== undefined && schedule.max_run_count > 0 ? schedule.max_run_count : null
  const completed = schedule.completed_run_count ?? 0
  const running = schedule.running_run_count ?? 0
  const queued = schedule.queued_run_count ?? 0
  const stats = [
    maxRuns !== null
      ? t({ ko: '{count} / {max}회', en: '{count} / {max} runs' }, { count: formatNumber(completed), max: formatNumber(maxRuns) })
      : t({ ko: '{count}회', en: '{count} runs' }, { count: formatNumber(completed) }),
    running > 0 ? t({ ko: '실행 중 {count}', en: 'Running {count}' }, { count: formatNumber(running) }) : null,
    queued > 0 ? t({ ko: '대기 {count}', en: 'Queued {count}' }, { count: formatNumber(queued) }) : null,
    schedule.last_enqueued_at ? t({ ko: '최근 {time}', en: 'Last {time}' }, { time: shortRunLabel(schedule.last_enqueued_at, t, formatDate) }) : null,
  ].filter(Boolean).join(' · ')
  const stopReason = getGraphWorkflowStopReasonLabel(schedule.stop_reason_code, schedule.stop_reason_message, t)

  return (
    <div className="border-b border-line py-2.5 last:border-b-0">
      <div className="flex items-start gap-3">
        <WorkflowCover hash={cover} className={cn(!active && 'opacity-60')} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span role="img" aria-label={statusLabel} className={cn('size-1.5 shrink-0 rounded-full', active ? 'bg-success' : stopped ? 'bg-destructive' : 'bg-surface-highest ring-1 ring-inset ring-muted-foreground/60')} />
            <span className="truncate text-sm font-semibold text-foreground">{schedule.name}</span>
            <span className={cn('text-xs font-semibold tabular-nums', active ? 'text-secondary-text' : 'text-muted-foreground')}>{cadence}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">{details}</div>
          {compact ? null : <div className="text-2xs tabular-nums text-muted-foreground">{stats}</div>}
        </div>
        <div className="hidden shrink-0 flex-col items-end pt-0.5 text-2xs tabular-nums text-muted-foreground sm:flex">
          {active && schedule.next_run_at ? <>
            <span>{t({ ko: '다음', en: 'Next' })}</span>
            <span className="text-xs font-semibold text-foreground">{shortRunLabel(schedule.next_run_at, t, formatDate)}</span>
          </> : <span className={cn(stopped && 'text-destructive')}>{statusLabel}</span>}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {stopReason ? (
        <div role="status" className="mt-2 ml-12 rounded-sm bg-warning-soft/45 px-3 py-2 text-xs text-muted-foreground">{stopReason}</div>
      ) : null}
    </div>
  )
}
