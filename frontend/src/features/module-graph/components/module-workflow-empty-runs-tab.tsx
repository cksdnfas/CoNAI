import { Square, SquareCheckBig, Trash2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { GraphExecutionRecord, GraphWorkflowNameRecord, GraphWorkflowScheduleRecord } from '@/lib/api-module-graph'
import { getGraphExecutionStatusLabel, localizeGraphWorkflowErrorMessage } from '../module-graph-shared'
import { ModuleWorkflowSchedulesPanel } from './module-workflow-schedules-panel'
import { EmptyState } from '@/components/ui/empty-state'

/** Render workflow reservations plus empty-run management content. */
export function ModuleWorkflowEmptyRunsTab({
  view,
  schedules,
  workflows,
  queueExecutions,
  selectedQueueExecutionIdSet,
  allQueueSelected,
  workflowNameById,
  isCleaningQueue,
  isMutatingSchedules,
  onToggleVisibleSelection,
  onToggleQueueSelection,
  onCancelSingle,
  onDeleteSingle,
  onCreateSchedule,
  onUpdateSchedule,
  onPauseSchedule,
  onResumeSchedule,
  onDeleteSchedule,
  onRunScheduleNow,
}: {
  view: 'schedules' | 'executions'
  schedules: GraphWorkflowScheduleRecord[]
  workflows: GraphWorkflowNameRecord[]
  queueExecutions: GraphExecutionRecord[]
  selectedQueueExecutionIdSet: ReadonlySet<number>
  allQueueSelected: boolean
  workflowNameById: Map<number, string>
  isCleaningQueue: boolean
  isMutatingSchedules: boolean
  onToggleVisibleSelection: () => void
  onToggleQueueSelection: (executionId: number) => void
  onCancelSingle: (executionId: number) => void
  onDeleteSingle: (executionId: number) => void
  onCreateSchedule: (payload: {
    graph_workflow_id: number
    name: string
    schedule_type: 'once' | 'interval' | 'daily'
    status?: 'active' | 'paused'
    run_at?: string | null
    interval_minutes?: number | null
    daily_time?: string | null
    max_run_count?: number | null
    run_enqueue_count?: number | null
    input_values?: Record<string, unknown> | null
  }) => Promise<void> | void
  onUpdateSchedule: (scheduleId: number, payload: {
    name: string
    schedule_type: 'once' | 'interval' | 'daily'
    status?: 'active' | 'paused'
    run_at?: string | null
    interval_minutes?: number | null
    daily_time?: string | null
    max_run_count?: number | null
    run_enqueue_count?: number | null
    input_values?: Record<string, unknown> | null
  }) => Promise<void> | void
  onPauseSchedule: (scheduleId: number) => Promise<void> | void
  onResumeSchedule: (scheduleId: number) => Promise<void> | void
  onDeleteSchedule: (scheduleId: number) => Promise<void> | void
  onRunScheduleNow: (scheduleId: number) => Promise<void> | void
}) {
  const { t, formatNumber, formatDateTime } = useI18n()

  return (
    <div className="space-y-4">
      {view === 'schedules' ? <ModuleWorkflowSchedulesPanel
        schedules={schedules}
        workflows={workflows}
        workflowNameById={workflowNameById}
        isMutating={isMutatingSchedules}
        onCreateSchedule={onCreateSchedule}
        onUpdateSchedule={onUpdateSchedule}
        onPauseSchedule={onPauseSchedule}
        onResumeSchedule={onResumeSchedule}
        onDeleteSchedule={onDeleteSchedule}
        onRunNow={onRunScheduleNow}
      /> : null}

      {view === 'executions' ? <Section
        variant="settings"
        heading={t({ ko: '예약 실행 현황', en: 'Reservation run status' })}
        actions={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <IconButton
              size="icon-sm"
              variant="ghost"
              onClick={onToggleVisibleSelection}
              disabled={queueExecutions.length === 0}
              label={allQueueSelected ? t({ ko: '선택 해제', en: 'Clear selection' }) : t({ ko: '보이는 항목 선택', en: 'Select visible items' })}
            >
              {allQueueSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            </IconButton>
          </div>
        )}
      >
        {queueExecutions.length === 0 ? (
          <EmptyState title={t({ ko: '이 범위에는 빈 실행이나 출력 없는 실행이 없어.', en: 'No empty or outputless runs in this scope.' })} />
        ) : (
          <div>
            {queueExecutions.map((execution) => {
              const isSelected = selectedQueueExecutionIdSet.has(execution.id)
              const isCancelable = execution.status === 'queued' || execution.status === 'running'

              return (
                <div key={execution.id} data-selected={isSelected} className={cn('border-b border-line py-2.5 last:border-b-0 px-2', isSelected && 'bg-primary/8')}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <Text as="div" variant="label">
                        {workflowNameById.get(execution.graph_workflow_id) ?? t({ ko: '워크플로우 #{id}', en: 'Workflow #{id}' }, { id: execution.graph_workflow_id })}
                      </Text>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t({ ko: '실행 #{id} · 생성 {time}', en: 'Run #{id} · Created {time}' }, { id: execution.id, time: formatDateTime(execution.created_date) })}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={execution.status === 'failed' ? 'destructive' : 'outline'}>{getGraphExecutionStatusLabel(execution.status, t)}</Badge>
                      {execution.queue_position !== null && execution.queue_position !== undefined ? <Badge variant="outline">{t({ ko: '대기열 {position}', en: 'Queue {position}' }, { position: formatNumber(execution.queue_position) })}</Badge> : null}
                      <IconButton
                        size="icon-sm"
                        variant="ghost"
                        aria-pressed={isSelected}
                        onClick={() => onToggleQueueSelection(execution.id)}
                        label={isSelected ? t({ ko: '선택 해제', en: 'Deselect' }) : t({ ko: '선택', en: 'Select' })}
                      >
                        {isSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                      </IconButton>
                      {isCancelable ? (
                        <IconButton size="icon-sm" variant="ghost" onClick={() => onCancelSingle(execution.id)} disabled={isCleaningQueue} label={t({ ko: '취소', en: 'Cancel' })}>
                          <XCircle className="h-4 w-4" />
                        </IconButton>
                      ) : (
                        <IconButton size="icon-sm" variant="ghost" onClick={() => onDeleteSingle(execution.id)} disabled={isCleaningQueue} label={t({ ko: '삭제', en: 'Delete' })}>
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      )}
                    </div>
                  </div>
                  {localizeGraphWorkflowErrorMessage(execution.error_message, t, t({ ko: '예약 실행 중 오류가 발생했어.', en: 'A reservation run failed.' })) ? (
                    <div role="alert" className="mt-3 rounded-sm bg-destructive-soft/45 px-3 py-2 text-xs text-foreground">
                      {localizeGraphWorkflowErrorMessage(execution.error_message, t, t({ ko: '예약 실행 중 오류가 발생했어.', en: 'A reservation run failed.' }))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </Section> : null}
    </div>
  )
}
