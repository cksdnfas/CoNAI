import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Trash2, XCircle } from 'lucide-react'
import { SelectionActionBar } from '@/components/common/selection-action-bar'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { resolveStreamFallbackInterval } from '@/features/runtime-events/runtime-event-fallback'
import { useRuntimeEventStream } from '@/features/runtime-events/use-runtime-event-stream'
import { StatTile } from '@/components/ui/stat-tile'
import { Section } from '@/components/ui/section'
import { useI18n } from '@/i18n'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  cleanupGraphWorkflowEmptyExecutions,
  createGraphWorkflowSchedule,
  deleteGraphWorkflowSchedule,
  getGraphWorkflowReservations,
  pauseGraphWorkflowSchedule,
  resumeGraphWorkflowSchedule,
  runGraphWorkflowScheduleNow,
  updateGraphWorkflowSchedule,
  cancelGraphExecution,
} from '@/lib/api-module-graph'
import type { GraphWorkflowNameRecord } from '@/lib/api-module-graph'
import { getErrorMessage } from '../image-generation-shared'
import { ModuleWorkflowEmptyRunsTab } from '@/features/module-graph/components/module-workflow-empty-runs-tab'
import { getActiveWorkflowReservationScheduleCount, isActiveReservationExecution, mergeVisibleReservationExecutions, sortWorkflowReservationSchedules } from './workflow-reservations-ui'
import { LoadingState } from '@/components/ui/loading-state'
import { ErrorState } from '@/components/ui/error-state'

type ReservationView = 'schedules' | 'executions'

/** Render the dedicated workflow reservation page inside image generation. */
export function WorkflowReservationsPanel() {
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber } = useI18n()
  const confirm = useConfirm()
  const [selectedReservationExecutionIds, setSelectedReservationExecutionIds] = useState<number[]>([])
  const [isCleaningReservations, setIsCleaningReservations] = useState(false)
  const [isMutatingSchedules, setIsMutatingSchedules] = useState(false)
  const [activeView, setActiveView] = useState<ReservationView>('schedules')
  // SSE 가 살아 있으면 폴링을 끄고, 끊기면 아래 2초 폴링이 그대로 되살아난다.
  const { status: runtimeStreamStatus } = useRuntimeEventStream()

  // WF-2: 예약 탭은 browse-content 전체 덤프 대신 예약 전용 경량 스냅샷을 폴링한다.
  const reservationsQuery = useQuery({
    queryKey: ['graph-workflow-reservations', 'generation-reservations'],
    queryFn: () => getGraphWorkflowReservations(),
    refetchInterval: (query) => {
      const content = query.state.data
      const executions = mergeVisibleReservationExecutions(content?.empty_executions ?? [], content?.executions ?? [])
      const legacyInterval = executions.some((execution) => isActiveReservationExecution(execution.status)) ? 2_000 : false
      return resolveStreamFallbackInterval(runtimeStreamStatus, legacyInterval)
    },
  })

  const reservationContent = reservationsQuery.data
  const workflows = useMemo(() => reservationContent?.workflows ?? [], [reservationContent?.workflows])
  const schedules = useMemo(() => sortWorkflowReservationSchedules(reservationContent?.schedules ?? []), [reservationContent?.schedules])
  const reservationExecutions = useMemo(
    () => mergeVisibleReservationExecutions(reservationContent?.empty_executions ?? [], reservationContent?.executions ?? []),
    [reservationContent?.empty_executions, reservationContent?.executions],
  )
  const activeScheduleCount = useMemo(() => getActiveWorkflowReservationScheduleCount(schedules), [schedules])
  const runningExecutionCount = useMemo(() => reservationExecutions.filter((execution) => execution.status === 'running').length, [reservationExecutions])
  const queuedExecutionCount = useMemo(() => reservationExecutions.filter((execution) => execution.status === 'queued').length, [reservationExecutions])

  const workflowNameById = useMemo(
    () => new Map<number, string>(workflows.map((workflow: GraphWorkflowNameRecord) => [workflow.id, workflow.name])),
    [workflows],
  )
  const reservationExecutionIdSet = useMemo(() => new Set(reservationExecutions.map((execution) => execution.id)), [reservationExecutions])
  const selectedReservationExecutionIdSet = useMemo(() => new Set(selectedReservationExecutionIds), [selectedReservationExecutionIds])

  const selectedReservationExecutions = useMemo(
    () => reservationExecutions.filter((execution) => selectedReservationExecutionIdSet.has(execution.id)),
    [reservationExecutions, selectedReservationExecutionIdSet],
  )
  const cancelableReservationExecutions = useMemo(
    () => selectedReservationExecutions.filter((execution) => isActiveReservationExecution(execution.status)),
    [selectedReservationExecutions],
  )
  const deletableReservationExecutions = useMemo(
    () => selectedReservationExecutions.filter((execution) => !isActiveReservationExecution(execution.status)),
    [selectedReservationExecutions],
  )
  const allVisibleSelected = reservationExecutions.length > 0 && selectedReservationExecutions.length === reservationExecutions.length

  useEffect(() => {
    setSelectedReservationExecutionIds((current) => current.filter((id) => reservationExecutionIdSet.has(id)))
  }, [reservationExecutionIdSet])

  const handleRefresh = async () => {
    await reservationsQuery.refetch()
  }

  const handleCancelSelectedReservationExecutions = async (executionIds?: number[]) => {
    const targetExecutionIdSet = new Set(executionIds ?? [])
    const cancelTargets = executionIds
      ? reservationExecutions.filter((execution) => targetExecutionIdSet.has(execution.id) && isActiveReservationExecution(execution.status))
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
          ? t({ ko: '{count}개 예약 실행 취소 요청 완료.', en: 'Submitted cancellation for {count} reservation runs.' }, { count: formatNumber(successCount) })
          : t({ ko: '{count}개 예약 실행 취소 요청 완료, 일부는 실패했어.', en: 'Submitted cancellation for {count} reservation runs, but some failed.' }, { count: formatNumber(successCount) }),
        tone: successCount === cancelTargets.length ? 'info' : 'error',
      })
      setSelectedReservationExecutionIds([])
      await handleRefresh()
    } finally {
      setIsCleaningReservations(false)
    }
  }

  const handleCleanupSelectedReservations = async (executionIds?: number[]) => {
    const targetExecutionIdSet = new Set(executionIds ?? [])
    const cleanupTargets = executionIds
      ? reservationExecutions.filter((execution) => targetExecutionIdSet.has(execution.id) && !isActiveReservationExecution(execution.status))
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
        message: t({ ko: '예약 실행 정리 완료. {deleted}개 삭제, {skipped}개 건너뜀.', en: 'Reservation run cleanup finished. Deleted {deleted}, skipped {skipped}.' }, { deleted: formatNumber(result.deleted_count), skipped: formatNumber(result.skipped.length) }),
        tone: result.skipped.length > 0 ? 'error' : 'info',
      })
      setSelectedReservationExecutionIds([])
      await handleRefresh()
    } catch (error) {
      showSnackbar({
        message: error instanceof Error ? error.message : t({ ko: '예약 실행 정리에 실패했어.', en: 'Failed to clean up reservation runs.' }),
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
    run_enqueue_count?: number | null
    input_values?: Record<string, unknown> | null
  }) => {
    try {
      setIsMutatingSchedules(true)
      await createGraphWorkflowSchedule(payload)
      showSnackbar({ message: t({ ko: '예약작업을 추가했어.', en: 'Added the reservation job.' }), tone: 'info' })
      await handleRefresh()
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '예약작업 생성에 실패했어.', en: 'Failed to create the reservation job.' }), tone: 'error' })
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
    run_enqueue_count?: number | null
    input_values?: Record<string, unknown> | null
  }) => {
    try {
      setIsMutatingSchedules(true)
      await updateGraphWorkflowSchedule(scheduleId, payload)
      showSnackbar({ message: t({ ko: '예약작업을 업데이트했어.', en: 'Updated the reservation job.' }), tone: 'info' })
      await handleRefresh()
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '예약작업 수정에 실패했어.', en: 'Failed to update the reservation job.' }), tone: 'error' })
    } finally {
      setIsMutatingSchedules(false)
    }
  }

  const handlePauseSchedule = async (scheduleId: number) => {
    try {
      setIsMutatingSchedules(true)
      await pauseGraphWorkflowSchedule(scheduleId)
      showSnackbar({ message: t({ ko: '예약작업을 일시정지했어.', en: 'Paused the reservation job.' }), tone: 'info' })
      await handleRefresh()
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '예약작업 일시정지에 실패했어.', en: 'Failed to pause the reservation job.' }), tone: 'error' })
    } finally {
      setIsMutatingSchedules(false)
    }
  }

  const handleResumeSchedule = async (scheduleId: number) => {
    try {
      setIsMutatingSchedules(true)
      await resumeGraphWorkflowSchedule(scheduleId)
      showSnackbar({ message: t({ ko: '예약작업을 다시 켰어.', en: 'Resumed the reservation job.' }), tone: 'info' })
      await handleRefresh()
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '예약작업 재개에 실패했어.', en: 'Failed to resume the reservation job.' }), tone: 'error' })
    } finally {
      setIsMutatingSchedules(false)
    }
  }

  const handleRunScheduleNow = async (scheduleId: number) => {
    try {
      setIsMutatingSchedules(true)
      const result = await runGraphWorkflowScheduleNow(scheduleId)
      const enqueuedCount = result.enqueue?.enqueued_count ?? 1
      showSnackbar({ message: result.executionId ? t({ ko: '예약작업에서 즉시 실행 {count}개를 등록했어. 첫 실행 #{executionId}', en: 'Queued {count} immediate runs from the reservation job. First run #{executionId}.' }, { count: formatNumber(enqueuedCount), executionId: result.executionId }) : result.message, tone: 'info' })
      await handleRefresh()
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '즉시 실행 요청에 실패했어.', en: 'Failed to request an immediate run.' }), tone: 'error' })
    } finally {
      setIsMutatingSchedules(false)
    }
  }

  const handleDeleteSchedule = async (scheduleId: number) => {
    const confirmed = await confirm({
      title: t({ ko: '예약작업 삭제', en: 'Delete reservation job' }),
      description: t({ ko: '이 예약작업을 정말 삭제할까? 연결된 queued 예약 실행도 함께 정리될 수 있어.', en: 'Delete this reservation job? Linked queued reservation runs may be cleaned up too.' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!confirmed) {
      return
    }

    try {
      setIsMutatingSchedules(true)
      await deleteGraphWorkflowSchedule(scheduleId)
      showSnackbar({ message: t({ ko: '예약작업을 삭제했어.', en: 'Deleted the reservation job.' }), tone: 'info' })
      await handleRefresh()
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '예약작업 삭제에 실패했어.', en: 'Failed to delete the reservation job.' }), tone: 'error' })
    } finally {
      setIsMutatingSchedules(false)
    }
  }

  return (
    <section className="space-y-6">
      <Section
        variant="settings"
        heading={t({ ko: '예약작업', en: 'Reservation jobs' })}
        actions={(
          <IconButton size="icon-sm" variant="ghost" onClick={() => void handleRefresh()} label={t({ ko: '예약작업 새로고침', en: 'Refresh reservation jobs' })}>
            <RefreshCw />
          </IconButton>
        )}
      >
        {reservationsQuery.isError ? (
          <ErrorState
            title={t({ ko: '예약작업을 불러오지 못했어', en: 'Could not load reservation jobs' })}
            description={getErrorMessage(reservationsQuery.error, t({ ko: '예약작업 조회 실패', en: 'Failed to load reservation jobs' }))}
          />
        ) : null}

        {!reservationsQuery.isError && reservationsQuery.isPending ? <LoadingState variant="inline" label={t({ ko: '예약작업 불러오는 중…', en: 'Loading reservation jobs…' })} /> : null}

        {!reservationsQuery.isPending && !reservationsQuery.isError && reservationContent ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label={t({ ko: '활성 일정', en: 'Active schedules' })} value={activeScheduleCount} valueClassName="text-lg" />
            <StatTile label={t({ ko: '실행 중', en: 'Running' })} value={runningExecutionCount} valueClassName="text-lg" />
            <StatTile label={t({ ko: '대기 중', en: 'Queued' })} value={queuedExecutionCount} valueClassName="text-lg" />
          </div>
        ) : null}
      </Section>

      <SegmentedTabBar
        value={activeView}
        onChange={(value) => setActiveView(value as ReservationView)}
        items={[
          { value: 'schedules', label: t({ ko: '일정 {count}', en: 'Schedules {count}' }, { count: formatNumber(schedules.length) }) },
          { value: 'executions', label: t({ ko: '실행 현황 {count}', en: 'Run status {count}' }, { count: formatNumber(reservationExecutions.length) }) },
        ]}
      />

      {reservationContent ? (
        <ModuleWorkflowEmptyRunsTab
          view={activeView}
          schedules={schedules}
          workflows={workflows}
          queueExecutions={reservationExecutions}
          selectedQueueExecutionIdSet={selectedReservationExecutionIdSet}
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

      {activeView === 'executions' ? <SelectionActionBar
        selectedCount={selectedReservationExecutions.length}
        summary={t('image-generation.components.workflow.reservations.panel.value.reservation.executions.selected', { count: formatNumber(selectedReservationExecutions.length) })}
        description={t('image-generation.components.workflow.reservations.panel.value.cancelable.value.deletable', {
          cancelable: formatNumber(cancelableReservationExecutions.length),
          deletable: formatNumber(deletableReservationExecutions.length),
        })}
        onClear={() => setSelectedReservationExecutionIds([])}
        actions={(
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void handleCancelSelectedReservationExecutions()}
              disabled={isCleaningReservations || cancelableReservationExecutions.length === 0}
              data-no-select-drag="true"
            >
              <XCircle className="h-4 w-4" />
              {t({ ko: '활성 취소 ({count})', en: 'Cancel active ({count})' }, { count: formatNumber(cancelableReservationExecutions.length) })}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void handleCleanupSelectedReservations()}
              disabled={isCleaningReservations || deletableReservationExecutions.length === 0}
              data-no-select-drag="true"
            >
              <Trash2 className="h-4 w-4" />
              {t({ ko: '빈 실행 삭제 ({count})', en: 'Delete empty runs ({count})' }, { count: formatNumber(deletableReservationExecutions.length) })}
            </Button>
          </>
        )}
      /> : null}
    </section>
  )
}
