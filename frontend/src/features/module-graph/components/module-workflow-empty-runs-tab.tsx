import { Square, SquareCheckBig, Trash2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SettingsInsetBlock, SettingsSection } from '@/features/settings/components/settings-primitives'
import { useI18n } from '@/i18n'
import type { GraphExecutionRecord, GraphWorkflowRecord, GraphWorkflowScheduleRecord } from '@/lib/api-module-graph'
import { getGraphExecutionStatusLabel, localizeGraphWorkflowErrorMessage } from '../module-graph-shared'
import { ModuleWorkflowSchedulesPanel } from './module-workflow-schedules-panel'

/** Render workflow reservations plus empty-run management content. */
export function ModuleWorkflowEmptyRunsTab({
  schedules,
  workflows,
  queueExecutions,
  selectedQueueExecutionIds,
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
  schedules: GraphWorkflowScheduleRecord[]
  workflows: GraphWorkflowRecord[]
  queueExecutions: GraphExecutionRecord[]
  selectedQueueExecutionIds: number[]
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
      <ModuleWorkflowSchedulesPanel
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
      />

      <SettingsSection
        heading={t({ ko: '예약작업 · 빈 실행', en: 'Reservations · Empty runs' })}
        actions={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant="outline">{formatNumber(queueExecutions.length)}</Badge>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onToggleVisibleSelection}
              disabled={queueExecutions.length === 0}
            >
              {allQueueSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
              {allQueueSelected ? t({ ko: '선택 해제', en: 'Clear selection' }) : t({ ko: '보이는 항목 선택', en: 'Select visible items' })}
            </Button>
          </div>
        )}
      >
        {queueExecutions.length === 0 ? (
          <SettingsInsetBlock className="border-dashed py-10 text-sm text-muted-foreground">
            {t({ ko: '이 범위에는 빈 실행이나 출력 없는 실행이 없어.', en: 'No empty or outputless runs in this scope.' })}
          </SettingsInsetBlock>
        ) : (
          <div className="space-y-3">
            {queueExecutions.map((execution) => {
              const isSelected = selectedQueueExecutionIds.includes(execution.id)
              const isCancelable = execution.status === 'queued' || execution.status === 'running'

              return (
                <SettingsInsetBlock key={execution.id} className={isSelected ? 'border-primary bg-primary/8' : undefined}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" className="text-sm font-medium text-foreground" onClick={() => onToggleQueueSelection(execution.id)}>
                          {workflowNameById.get(execution.graph_workflow_id) ?? t({ ko: '워크플로우 #{id}', en: 'Workflow #{id}' }, { id: execution.graph_workflow_id })}
                        </button>
                        <Badge variant={isSelected ? 'secondary' : 'outline'}>{isSelected ? t({ ko: '선택됨', en: 'Selected' }) : t({ ko: '선택', en: 'Select' })}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t({ ko: '실행 #{id} · 생성 {time}', en: 'Run #{id} · Created {time}' }, { id: execution.id, time: formatDateTime(execution.created_date) })}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={execution.status === 'failed' ? 'destructive' : 'outline'}>{getGraphExecutionStatusLabel(execution.status)}</Badge>
                      {execution.queue_position !== null && execution.queue_position !== undefined ? <Badge variant="outline">{t({ ko: '대기열 {position}', en: 'Queue {position}' }, { position: formatNumber(execution.queue_position) })}</Badge> : null}
                      <Button type="button" size="sm" variant="ghost" onClick={() => onToggleQueueSelection(execution.id)}>
                        {isSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                      </Button>
                      {isCancelable ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => onCancelSingle(execution.id)} disabled={isCleaningQueue}>
                          <XCircle className="h-4 w-4" />
                          {t({ ko: '취소', en: 'Cancel' })}
                        </Button>
                      ) : (
                        <Button type="button" size="sm" onClick={() => onDeleteSingle(execution.id)} disabled={isCleaningQueue}>
                          <Trash2 className="h-4 w-4" />
                          {t({ ko: '삭제', en: 'Delete' })}
                        </Button>
                      )}
                    </div>
                  </div>
                  {localizeGraphWorkflowErrorMessage(execution.error_message, t({ ko: '예약 실행 중 오류가 발생했어.', en: 'A reservation run failed.' })) ? (
                    <SettingsInsetBlock className="mt-3 bg-background/50 px-3 py-2 text-xs text-muted-foreground">
                      {localizeGraphWorkflowErrorMessage(execution.error_message, t({ ko: '예약 실행 중 오류가 발생했어.', en: 'A reservation run failed.' }))}
                    </SettingsInsetBlock>
                  ) : null}
                </SettingsInsetBlock>
              )
            })}
          </div>
        )}
      </SettingsSection>
    </div>
  )
}
