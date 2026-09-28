import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import type { GraphWorkflowScheduleRecord } from '@/lib/api-module-graph'
import { getGraphWorkflowScheduleStatusLabel, getGraphWorkflowStopReasonLabel } from '@/features/module-graph/module-graph-shared'
import { getErrorMessage } from '../image-generation-shared'
import {
  formatReservationTimestamp,
  getActiveWorkflowReservationScheduleCount,
  getReservationRunAtLabel,
  getReservationRunSummaryLabel,
  getReservationStatusVariant,
  getReservationTypeLabel,
} from './workflow-reservations-ui'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadingState } from '@/components/ui/loading-state'
import { ErrorState } from '@/components/ui/error-state'

type GenerationQueueReservationsTabProps = {
  /** Already sorted with `sortWorkflowReservationSchedules`. */
  schedules: GraphWorkflowScheduleRecord[]
  workflowNameById: ReadonlyMap<number, string>
  isPending: boolean
  isError: boolean
  error: unknown
  /** Scroll-area classes shared with the jobs tab so both tabs size the popup the same way. */
  listClassName: string
}

/** Render the header queue popup's reservations tab: a summary strip and the schedule list. The widget owns the queries. */
export function GenerationQueueReservationsTab({
  schedules,
  workflowNameById,
  isPending,
  isError,
  error,
  listClassName,
}: GenerationQueueReservationsTabProps) {
  const { t, locale, formatNumber } = useI18n()
  const activeReservationCount = useMemo(() => getActiveWorkflowReservationScheduleCount(schedules), [schedules])

  return (
    <>
      <div className="space-y-3 px-3 py-3 sm:px-4">
        <div className="flex items-center justify-between gap-3">
          <Text as="div" variant="overline" className="font-semibold">{t('image-generation.components.generation.queue.header.widget.summary')}</Text>
          <Badge variant={schedules.length > 0 ? 'secondary' : 'outline'} className="w-fit max-w-full">{t({ ko: '예약작업 · {count}', en: 'Reservations · {count}' }, { count: formatNumber(schedules.length) })}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={activeReservationCount > 0 ? 'secondary' : 'outline'}>{t({ ko: '활성 {count}', en: 'Active {count}' }, { count: formatNumber(activeReservationCount) })}</Badge>
        </div>
      </div>

      <div className={listClassName}>
        {isError ? (
          <ErrorState size="compact" title={getErrorMessage(error, t('image-generation.components.generation.queue.header.widget.could.not.load.reservations'))} />
        ) : null}

        {!isError && isPending ? <LoadingState variant="inline" label={t('image-generation.components.generation.queue.header.widget.loading.reservations')} /> : null}

        {!isPending && !isError && schedules.length === 0 ? (
          <EmptyState size="compact" title={t({ ko: '등록된 예약작업이 아직 없어.', en: 'No reservations have been registered yet.' })} />
        ) : null}

        {schedules.length > 0 ? (
          <div className="space-y-2">
            {schedules.map((schedule) => {
              const nextRunAt = formatReservationTimestamp(schedule.next_run_at, locale)
              const lastEnqueuedAt = formatReservationTimestamp(schedule.last_enqueued_at, locale)
              const runSummaryLabel = getReservationRunSummaryLabel(schedule, t, formatNumber)
              const runAtLabel = getReservationRunAtLabel(schedule, t, (value) => formatReservationTimestamp(value, locale))
              const stopReasonLabel = getGraphWorkflowStopReasonLabel(schedule.stop_reason_code, schedule.stop_reason_message, t)
              return (
                <div key={schedule.id} className="ui-tone-plinth rounded-sm px-3 py-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Text as="div" variant="label" className="truncate">{schedule.name}</Text>
                      <Badge variant={getReservationStatusVariant(schedule.status)}>{getGraphWorkflowScheduleStatusLabel(schedule.status, t)}</Badge>
                      <Badge variant="outline">{getReservationTypeLabel(schedule, t, formatNumber)}</Badge>
                    </div>
                    <div className="text-2xs text-muted-foreground">
                      {workflowNameById.get(schedule.graph_workflow_id) ?? t('image-generation.components.generation.queue.header.widget.workflow.value', { id: schedule.graph_workflow_id })}{runAtLabel ? ` · ${runAtLabel}` : ''}
                    </div>
                    <div className="flex flex-wrap gap-3 text-2xs text-muted-foreground">
                      <span>{runSummaryLabel}</span>
                      {nextRunAt ? <span>{t('image-generation.components.generation.queue.header.widget.next.enqueue.attempt.value', { nextRunAt })}</span> : null}
                      {lastEnqueuedAt ? <span>{t('image-generation.components.generation.queue.header.widget.last.queued.value', { lastEnqueuedAt })}</span> : null}
                    </div>
                    {stopReasonLabel ? (
                      <div className="rounded-sm bg-foreground/4 px-2.5 py-2 text-2xs text-muted-foreground">
                        {stopReasonLabel}
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </>
  )
}
