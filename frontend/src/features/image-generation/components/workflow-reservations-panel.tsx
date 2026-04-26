import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Trash2, XCircle } from 'lucide-react'
import { SelectionActionBar } from '@/components/common/selection-action-bar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { SettingsSection, SettingsValueTile } from '@/features/settings/components/settings-primitives'
import {
  cleanupGraphWorkflowEmptyExecutions,
  createGraphWorkflowSchedule,
  deleteGraphWorkflowSchedule,
  getGraphWorkflowBrowseContent,
  pauseGraphWorkflowSchedule,
  resumeGraphWorkflowSchedule,
  runGraphWorkflowScheduleNow,
  updateGraphWorkflowSchedule,
  cancelGraphExecution,
} from '@/lib/api-module-graph'
import type { GraphExecutionRecord, GraphWorkflowRecord } from '@/lib/api'
import { getErrorMessage } from '../image-generation-shared'
import { ModuleWorkflowEmptyRunsTab } from '@/features/module-graph/components/module-workflow-empty-runs-tab'

function isActiveReservationExecution(status: GraphExecutionRecord['status']) {
  return status === 'queued' || status === 'running'
}

/** Render the dedicated workflow reservation page inside image generation. */
export function WorkflowReservationsPanel() {
  const { showSnackbar } = useSnackbar()
  const [selectedReservationExecutionIds, setSelectedReservationExecutionIds] = useState<number[]>([])
  const [isCleaningReservations, setIsCleaningReservations] = useState(false)
  const [isMutatingSchedules, setIsMutatingSchedules] = useState(false)

  const reservationsQuery = useQuery({
    queryKey: ['module-graph-browse-content', 'generation-reservations', 'root'],
    queryFn: () => getGraphWorkflowBrowseContent(null),
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) {
        return false
      }

      const hasActiveExecutions = data.empty_executions.some((execution) => isActiveReservationExecution(execution.status))
      const hasActiveSchedules = data.schedules.some((schedule) => schedule.status === 'active')
      return hasActiveExecutions || hasActiveSchedules ? 4000 : false
    },
  })

  const reservationContent = reservationsQuery.data
  const workflows = reservationContent?.workflows ?? []
  const schedules = reservationContent?.schedules ?? []
  const reservationExecutions = reservationContent?.empty_executions ?? []

  const workflowNameById = useMemo(
    () => new Map<number, string>(workflows.map((workflow: GraphWorkflowRecord) => [workflow.id, workflow.name])),
    [workflows],
  )

  const selectedReservationExecutions = useMemo(
    () => reservationExecutions.filter((execution) => selectedReservationExecutionIds.includes(execution.id)),
    [reservationExecutions, selectedReservationExecutionIds],
  )
  const cancelableReservationExecutions = useMemo(
    () => selectedReservationExecutions.filter((execution) => isActiveReservationExecution(execution.status)),
    [selectedReservationExecutions],
  )
  const deletableReservationExecutions = useMemo(
    () => selectedReservationExecutions.filter((execution) => !isActiveReservationExecution(execution.status)),
    [selectedReservationExecutions],
  )
  const allVisibleSelected = reservationExecutions.length > 0 && selectedReservationExecutionIds.length === reservationExecutions.length

  useEffect(() => {
    setSelectedReservationExecutionIds((current) => current.filter((id) => reservationExecutions.some((execution) => execution.id === id)))
  }, [reservationExecutions])

  const handleRefresh = async () => {
    await reservationsQuery.refetch()
  }

  const handleCancelSelectedReservationExecutions = async (executionIds?: number[]) => {
    const cancelTargets = executionIds
      ? reservationExecutions.filter((execution) => executionIds.includes(execution.id) && isActiveReservationExecution(execution.status))
      : cancelableReservationExecutions

    if (cancelTargets.length === 0) {
      return
    }

    try {
      setIsCleaningReservations(true)
      const results = await Promise.allSettled(cancelTargets.map((execution) => cancelGraphExecution(execution.id)))
      const successCount = results.filter((result) => result.status === 'fulfilled').length
      showSnackbar({
        message: successCount === cancelTargets.length
          ? `${successCount}개 예약 실행 취소 요청 완료.`
          : `${successCount}개 예약 실행 취소 요청 완료, 일부는 실패했어.`,
        tone: successCount === cancelTargets.length ? 'info' : 'error',
      })
      setSelectedReservationExecutionIds([])
      await handleRefresh()
    } finally {
      setIsCleaningReservations(false)
    }
  }

  const handleCleanupSelectedReservations = async (executionIds?: number[]) => {
    const cleanupTargets = executionIds
      ? reservationExecutions.filter((execution) => executionIds.includes(execution.id) && !isActiveReservationExecution(execution.status))
      : deletableReservationExecutions

    if (cleanupTargets.length === 0) {
      return
    }

    try {
      setIsCleaningReservations(true)
      const result = await cleanupGraphWorkflowEmptyExecutions({
        execution_ids: cleanupTargets.map((execution) => execution.id),
      })
      showSnackbar({
        message: `예약 실행 정리 완료. ${result.deleted_count}개 삭제, ${result.skipped.length}개 건너뜀.`,
        tone: result.skipped.length > 0 ? 'error' : 'info',
      })
      setSelectedReservationExecutionIds([])
      await handleRefresh()
    } catch (error) {
      showSnackbar({
        message: error instanceof Error ? error.message : '예약 실행 정리에 실패했어.',
        tone: 'error',
      })
    } finally {
      setIsCleaningReservations(false)
    }
  }

  const handleCreateSchedule = async (payload: {
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
  }) => {
    try {
      setIsMutatingSchedules(true)
      const result = await createGraphWorkflowSchedule(payload)
      const enqueuedCount = result.enqueue?.enqueued_count ?? 0
      showSnackbar({ message: enqueuedCount > 0 ? `예약작업을 추가하고 ${enqueuedCount}개 실행을 큐에 등록했어.` : '예약작업을 추가했어.', tone: 'info' })
      await handleRefresh()
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '예약작업 생성에 실패했어.', tone: 'error' })
    } finally {
      setIsMutatingSchedules(false)
    }
  }

  const handleUpdateSchedule = async (scheduleId: number, payload: {
    name: string
    schedule_type: 'once' | 'interval' | 'daily'
    status?: 'active' | 'paused'
    run_at?: string | null
    interval_minutes?: number | null
    daily_time?: string | null
    max_run_count?: number | null
    input_values?: Record<string, unknown> | null
    enqueue_count?: number
  }) => {
    try {
      setIsMutatingSchedules(true)
      const result = await updateGraphWorkflowSchedule(scheduleId, payload)
      const enqueuedCount = result.enqueue?.enqueued_count ?? 0
      showSnackbar({ message: enqueuedCount > 0 ? `예약작업을 업데이트하고 ${enqueuedCount}개 실행을 큐에 등록했어.` : '예약작업을 업데이트했어.', tone: 'info' })
      await handleRefresh()
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '예약작업 수정에 실패했어.', tone: 'error' })
    } finally {
      setIsMutatingSchedules(false)
    }
  }

  const handlePauseSchedule = async (scheduleId: number) => {
    try {
      setIsMutatingSchedules(true)
      await pauseGraphWorkflowSchedule(scheduleId)
      showSnackbar({ message: '예약작업을 일시정지했어.', tone: 'info' })
      await handleRefresh()
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '예약작업 일시정지에 실패했어.', tone: 'error' })
    } finally {
      setIsMutatingSchedules(false)
    }
  }

  const handleResumeSchedule = async (scheduleId: number) => {
    try {
      setIsMutatingSchedules(true)
      await resumeGraphWorkflowSchedule(scheduleId)
      showSnackbar({ message: '예약작업을 다시 켰어.', tone: 'info' })
      await handleRefresh()
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '예약작업 재개에 실패했어.', tone: 'error' })
    } finally {
      setIsMutatingSchedules(false)
    }
  }

  const handleRunScheduleNow = async (scheduleId: number) => {
    try {
      setIsMutatingSchedules(true)
      const result = await runGraphWorkflowScheduleNow(scheduleId)
      const enqueuedCount = result.enqueue?.enqueued_count ?? 1
      showSnackbar({ message: result.executionId ? `예약작업에서 즉시 실행 ${enqueuedCount}개를 등록했어. 첫 실행 #${result.executionId}` : result.message, tone: 'info' })
      await handleRefresh()
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '즉시 실행 요청에 실패했어.', tone: 'error' })
    } finally {
      setIsMutatingSchedules(false)
    }
  }

  const handleDeleteSchedule = async (scheduleId: number) => {
    if (!window.confirm('이 예약작업을 정말 삭제할까? 연결된 queued 예약 실행도 함께 정리될 수 있어.')) {
      return
    }

    try {
      setIsMutatingSchedules(true)
      await deleteGraphWorkflowSchedule(scheduleId)
      showSnackbar({ message: '예약작업을 삭제했어.', tone: 'info' })
      await handleRefresh()
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '예약작업 삭제에 실패했어.', tone: 'error' })
    } finally {
      setIsMutatingSchedules(false)
    }
  }

  return (
    <section className="space-y-4">
      <SettingsSection
        heading="예약작업"
        actions={(
          <>
            <Badge variant={schedules.length > 0 ? 'secondary' : 'outline'}>스케줄 {schedules.length}</Badge>
            <Badge variant={reservationExecutions.length > 0 ? 'secondary' : 'outline'}>예약 실행 {reservationExecutions.length}</Badge>
            <Button type="button" size="icon-sm" variant="outline" onClick={() => void handleRefresh()} title="예약작업 새로고침" aria-label="예약작업 새로고침">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </>
        )}
      >
        {reservationsQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>예약작업을 불러오지 못했어</AlertTitle>
            <AlertDescription>{getErrorMessage(reservationsQuery.error, '예약작업 조회 실패')}</AlertDescription>
          </Alert>
        ) : null}

        {!reservationsQuery.isError && reservationsQuery.isPending ? <div className="text-sm text-muted-foreground">예약작업 불러오는 중…</div> : null}

        {!reservationsQuery.isPending && !reservationsQuery.isError && reservationContent ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SettingsValueTile label="예약작업" value={reservationContent.scope.schedule_count} valueClassName="text-lg" />
            <SettingsValueTile label="예약 실행" value={reservationContent.scope.empty_execution_count} valueClassName="text-lg" />
            <SettingsValueTile label="워크플로우" value={reservationContent.scope.workflow_count} valueClassName="text-lg" />
            <SettingsValueTile label="실행" value={reservationContent.scope.execution_count} valueClassName="text-lg" />
          </div>
        ) : null}
      </SettingsSection>

      {reservationContent ? (
        <ModuleWorkflowEmptyRunsTab
          schedules={schedules}
          workflows={workflows}
          queueExecutions={reservationExecutions}
          selectedQueueExecutionIds={selectedReservationExecutionIds}
          allQueueSelected={allVisibleSelected}
          workflowNameById={workflowNameById}
          isCleaningQueue={isCleaningReservations}
          isMutatingSchedules={isMutatingSchedules}
          onToggleVisibleSelection={() => setSelectedReservationExecutionIds(allVisibleSelected ? [] : reservationExecutions.map((execution) => execution.id))}
          onToggleQueueSelection={(executionId) => {
            setSelectedReservationExecutionIds((current) => (
              current.includes(executionId)
                ? current.filter((id) => id !== executionId)
                : [...current, executionId]
            ))
          }}
          onCancelSingle={(executionId) => {
            setSelectedReservationExecutionIds([executionId])
            void handleCancelSelectedReservationExecutions([executionId])
          }}
          onDeleteSingle={(executionId) => {
            setSelectedReservationExecutionIds([executionId])
            void handleCleanupSelectedReservations([executionId])
          }}
          onCreateSchedule={(payload) => void handleCreateSchedule(payload)}
          onUpdateSchedule={(scheduleId, payload) => void handleUpdateSchedule(scheduleId, payload)}
          onPauseSchedule={(scheduleId) => void handlePauseSchedule(scheduleId)}
          onResumeSchedule={(scheduleId) => void handleResumeSchedule(scheduleId)}
          onDeleteSchedule={(scheduleId) => void handleDeleteSchedule(scheduleId)}
          onRunScheduleNow={(scheduleId) => void handleRunScheduleNow(scheduleId)}
        />
      ) : null}

      <SelectionActionBar
        selectedCount={selectedReservationExecutions.length}
        summary={`${selectedReservationExecutions.length.toLocaleString('ko-KR')}개 예약 실행 선택됨`}
        description={`${cancelableReservationExecutions.length.toLocaleString('ko-KR')}개 취소 가능 · ${deletableReservationExecutions.length.toLocaleString('ko-KR')}개 삭제 가능`}
        onClear={() => setSelectedReservationExecutionIds([])}
        actions={(
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleCancelSelectedReservationExecutions()}
              disabled={isCleaningReservations || cancelableReservationExecutions.length === 0}
              data-no-select-drag="true"
            >
              <XCircle className="h-4 w-4" />
              활성 취소 ({cancelableReservationExecutions.length})
            </Button>
            <Button
              size="sm"
              onClick={() => void handleCleanupSelectedReservations()}
              disabled={isCleaningReservations || deletableReservationExecutions.length === 0}
              data-no-select-drag="true"
            >
              <Trash2 className="h-4 w-4" />
              빈 실행 삭제 ({deletableReservationExecutions.length})
            </Button>
          </>
        )}
      />
    </section>
  )
}
