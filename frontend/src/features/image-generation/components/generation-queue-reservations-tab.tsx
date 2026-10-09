import { useI18n } from '@/i18n'
import type { GraphWorkflowScheduleRecord } from '@/lib/api-module-graph'
import { useWorkflowCovers } from '@/features/module-graph/components/workflow-picker'
import { WorkflowScheduleRow } from '@/features/module-graph/components/workflow-schedule-row'
import { getErrorMessage } from '../image-generation-shared'
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

/** Render the header queue popup's reservations tab: short read-only schedule rows. The widget owns the queries. */
export function GenerationQueueReservationsTab({
  schedules,
  workflowNameById,
  isPending,
  isError,
  error,
  listClassName,
}: GenerationQueueReservationsTabProps) {
  const { t } = useI18n()
  const covers = useWorkflowCovers()

  return (
    <div className={listClassName}>
      {isError ? (
        <ErrorState size="compact" title={getErrorMessage(error, t('image-generation.components.generation.queue.header.widget.could.not.load.reservations'))} />
      ) : null}

      {!isError && isPending ? <LoadingState variant="inline" label={t('image-generation.components.generation.queue.header.widget.loading.reservations')} /> : null}

      {!isPending && !isError && schedules.length === 0 ? (
        <EmptyState size="compact" title={t({ ko: '등록된 예약작업이 아직 없어.', en: 'No reservations have been registered yet.' })} />
      ) : null}

      {schedules.length > 0 ? (
        <div>
          {schedules.map((schedule) => (
            <WorkflowScheduleRow
              key={schedule.id}
              compact
              schedule={schedule}
              cover={covers[schedule.graph_workflow_id]}
              workflowName={workflowNameById.get(schedule.graph_workflow_id) ?? t('image-generation.components.generation.queue.header.widget.workflow.value', { id: schedule.graph_workflow_id })}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
