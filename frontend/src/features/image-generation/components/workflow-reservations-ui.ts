import type { TranslationInput, TranslationParams } from '@/i18n'
import type { GraphExecutionRecord, GraphWorkflowScheduleRecord } from '@/lib/api-module-graph'

type Translate = (input: TranslationInput, params?: TranslationParams) => string

export type ReservationStatusVariant = 'secondary' | 'destructive' | 'outline'

export function isActiveReservationExecution(status: GraphExecutionRecord['status']) {
  return status === 'queued' || status === 'running'
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

export function getReservationStatusVariant(status: GraphWorkflowScheduleRecord['status']): ReservationStatusVariant {
  if (status === 'active') {
    return 'secondary'
  }

  if (status === 'error_stopped' || status === 'overlap_stopped') {
    return 'destructive'
  }

  return 'outline'
}

export function getReservationTypeLabel(scheduleType: GraphWorkflowScheduleRecord['schedule_type'], t: Translate) {
  if (scheduleType === 'once') {
    return t('image-generation.components.generation.queue.header.widget.run.once')
  }
  if (scheduleType === 'interval') {
    return t('image-generation.components.generation.queue.header.widget.every.n.minutes')
  }
  return t('image-generation.components.generation.queue.header.widget.daily')
}

export function getReservationTimingLabel(schedule: GraphWorkflowScheduleRecord, t: Translate, locale: string) {
  if (schedule.schedule_type === 'once') {
    return formatReservationTimestamp(schedule.run_at, locale) ?? t('image-generation.components.generation.queue.header.widget.time.not.set')
  }

  if (schedule.schedule_type === 'interval') {
    return t('image-generation.components.generation.queue.header.widget.value.min', { minutes: schedule.interval_minutes ?? '?' })
  }

  return t('image-generation.components.generation.queue.header.widget.value.daily', { time: schedule.daily_time ?? '--:--' })
}

export function getReservationRunSummaryLabel(schedule: GraphWorkflowScheduleRecord) {
  const completedCount = schedule.completed_run_count ?? 0
  return `${completedCount}/${schedule.max_run_count ?? '-'}`
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
