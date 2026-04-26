import { Square, SquareCheckBig, Trash2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SettingsInsetBlock, SettingsSection } from '@/features/settings/components/settings-primitives'
import type { GraphExecutionRecord, GraphWorkflowRecord, GraphWorkflowScheduleRecord } from '@/lib/api'
import { formatDateTime, getGraphExecutionStatusLabel, localizeGraphWorkflowErrorMessage } from '../module-graph-shared'
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
    input_values?: Record<string, unknown> | null
    enqueue_count?: number
  }) => Promise<void> | void
  onUpdateSchedule: (scheduleId: number, payload: {
    name: string
    schedule_type: 'once' | 'interval' | 'daily'
    status?: 'active' | 'paused'
    run_at?: string | null
    interval_minutes?: number | null
    daily_time?: string | null
    max_run_count?: number | null
    input_values?: Record<string, unknown> | null
    enqueue_count?: number
  }) => Promise<void> | void
  onPauseSchedule: (scheduleId: number) => Promise<void> | void
  onResumeSchedule: (scheduleId: number) => Promise<void> | void
  onDeleteSchedule: (scheduleId: number) => Promise<void> | void
  onRunScheduleNow: (scheduleId: number) => Promise<void> | void
}) {
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
        heading="예약작업 · 빈 실행"
        actions={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant="outline">{queueExecutions.length}</Badge>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onToggleVisibleSelection}
              disabled={queueExecutions.length === 0}
            >
              {allQueueSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
              {allQueueSelected ? '선택 해제' : '보이는 항목 선택'}
            </Button>
          </div>
        )}
      >
        {queueExecutions.length === 0 ? (
          <SettingsInsetBlock className="border-dashed py-10 text-sm text-muted-foreground">
            이 범위에는 빈 실행이나 출력 없는 실행이 없어.
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
                          {workflowNameById.get(execution.graph_workflow_id) ?? `워크플로우 #${execution.graph_workflow_id}`}
                        </button>
                        <Badge variant={isSelected ? 'secondary' : 'outline'}>{isSelected ? '선택됨' : '선택'}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        실행 #{execution.id} · 생성 {formatDateTime(execution.created_date)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={execution.status === 'failed' ? 'destructive' : 'outline'}>{getGraphExecutionStatusLabel(execution.status)}</Badge>
                      {execution.queue_position !== null && execution.queue_position !== undefined ? <Badge variant="outline">대기열 {execution.queue_position}</Badge> : null}
                      <Button type="button" size="sm" variant="ghost" onClick={() => onToggleQueueSelection(execution.id)}>
                        {isSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                      </Button>
                      {isCancelable ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => onCancelSingle(execution.id)} disabled={isCleaningQueue}>
                          <XCircle className="h-4 w-4" />
                          취소
                        </Button>
                      ) : (
                        <Button type="button" size="sm" onClick={() => onDeleteSingle(execution.id)} disabled={isCleaningQueue}>
                          <Trash2 className="h-4 w-4" />
                          삭제
                        </Button>
                      )}
                    </div>
                  </div>
                  {localizeGraphWorkflowErrorMessage(execution.error_message, '예약 실행 중 오류가 발생했어.') ? (
                    <SettingsInsetBlock className="mt-3 bg-background/50 px-3 py-2 text-xs text-muted-foreground">
                      {localizeGraphWorkflowErrorMessage(execution.error_message, '예약 실행 중 오류가 발생했어.')}
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
