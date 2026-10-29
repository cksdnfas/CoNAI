import type { TranslationInput, TranslationParams } from '@/i18n'
import type { GraphExecutionRecord, GraphWorkflowScheduleRecord } from '@/lib/api-module-graph'

type Translate = (input: TranslationInput, params?: TranslationParams) => string
type FormatNumber = (value: number) => string

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
