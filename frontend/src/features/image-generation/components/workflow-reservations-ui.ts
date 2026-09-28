import type { TranslationInput, TranslationParams } from '@/i18n'
import type { GraphExecutionRecord, GraphWorkflowScheduleRecord } from '@/lib/api-module-graph'

type Translate = (input: TranslationInput, params?: TranslationParams) => string
type FormatNumber = (value: number) => string

export type ReservationStatusVariant = 'secondary' | 'destructive' | 'outline'

export function isActiveReservationExecution(status: GraphExecutionRecord['status']) {
  return status === 'queued' || status === 'running'
}

/** Keep active scheduled runs visible even after their first output is created. */
export function mergeVisibleReservationExecutions(emptyExecutions: readonly GraphExecutionRecord[], executions: readonly GraphExecutionRecord[]) {
  const visibleById = new Map(emptyExecutions.map((execution) => [execution.id, execution]))

  for (const execution of executions) {
    if (execution.schedule_id !== null && execution.schedule_id !== undefined && isActiveReservationExecution(execution.status)) {
      visibleById.set(execution.id, execution)
    }
  }

  return [...visibleById.values()].sort((left, right) => {
    const leftActive = isActiveReservationExecution(left.status) ? 1 : 0
    const rightActive = isActiveReservationExecution(right.status) ? 1 : 0
    return rightActive - leftActive || right.id - left.id
  })
}

export function formatReservationTimestamp(value: string | null | undefined, locale: string) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/** Status badge variant shared by the header widget and the autorun panel. */
export function getReservationStatusVariant(status: GraphWorkflowScheduleRecord['status']): ReservationStatusVariant {
  if (status === 'active') {
    return 'secondary'
  }

  if (status === 'error_stopped' || status === 'overlap_stopped') {
    return 'destructive'
  }

  return 'outline'
}

/** Type badge text; interval and daily reservations carry their real cadence. */
export function getReservationTypeLabel(
  schedule: Pick<GraphWorkflowScheduleRecord, 'schedule_type' | 'interval_minutes' | 'daily_time'>,
  t: Translate,
  formatNumber: FormatNumber,
) {
  if (schedule.schedule_type === 'once') {
    return t({ ko: '1회 실행', en: 'Run once' })
  }

  if (schedule.schedule_type === 'interval') {
    const minutes = schedule.interval_minutes
    return t({ ko: '{minutes}분마다', en: 'Every {minutes} min' }, { minutes: minutes === null || minutes === undefined ? '?' : formatNumber(minutes) })
  }

  return t({ ko: '매일 {time}', en: 'Daily at {time}' }, { time: schedule.daily_time ?? '--:--' })
}

/**
 * Run time for one-time reservations only; interval/daily cadence already sits in the type badge.
 * `formatTimestamp` lets each surface keep its own date density.
 */
export function getReservationRunAtLabel(
  schedule: Pick<GraphWorkflowScheduleRecord, 'schedule_type' | 'run_at'>,
  t: Translate,
  formatTimestamp: (value: string) => string | null,
) {
  if (schedule.schedule_type !== 'once') {
    return null
  }

  return (schedule.run_at ? formatTimestamp(schedule.run_at) : null) ?? t({ ko: '시각 미설정', en: 'Time not set' })
}

/** Completed runs plus the run limit, spelled out ("3회 실행 · 제한 없음" / "3 runs · No limit"). */
export function getReservationRunSummaryLabel(
  schedule: Pick<GraphWorkflowScheduleRecord, 'completed_run_count' | 'max_run_count'>,
  t: Translate,
  formatNumber: FormatNumber,
) {
  const completedCount = schedule.completed_run_count ?? 0
  const maxRunCount = schedule.max_run_count
  const completedLabel = t(
    completedCount === 1 ? { ko: '{count}회 실행', en: '{count} run' } : { ko: '{count}회 실행', en: '{count} runs' },
    { count: formatNumber(completedCount) },
  )
  const limitLabel = maxRunCount !== null && maxRunCount !== undefined && maxRunCount > 0
    ? t({ ko: '최대 {count}회', en: 'Max {count}' }, { count: formatNumber(maxRunCount) })
    : t({ ko: '제한 없음', en: 'No limit' })
  return `${completedLabel} · ${limitLabel}`
}

export function sortWorkflowReservationSchedules(schedules: readonly GraphWorkflowScheduleRecord[]) {
  return [...schedules].sort((left, right) => {
    const leftActive = left.status === 'active' ? 1 : 0
    const rightActive = right.status === 'active' ? 1 : 0
    if (leftActive !== rightActive) {
      return rightActive - leftActive
    }

    const leftTime = left.next_run_at ?? left.updated_date
    const rightTime = right.next_run_at ?? right.updated_date
    return rightTime.localeCompare(leftTime)
  })
}

export function getActiveWorkflowReservationScheduleCount(schedules: readonly GraphWorkflowScheduleRecord[]) {
  return schedules.filter((schedule) => schedule.status === 'active').length
}
