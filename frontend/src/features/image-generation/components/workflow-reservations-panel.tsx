import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Trash2, XCircle } from 'lucide-react'
import { SelectionActionBar } from '@/components/common/selection-action-bar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { SettingsSection, SettingsValueTile } from '@/features/settings/components/settings-primitives'
import { useI18n } from '@/i18n'
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
import type { GraphWorkflowRecord } from '@/lib/api-module-graph'
import { getErrorMessage } from '../image-generation-shared'
import { ModuleWorkflowEmptyRunsTab } from '@/features/module-graph/components/module-workflow-empty-runs-tab'
import { isActiveReservationExecution } from './workflow-reservations-ui'

/** Render the dedicated workflow reservation page inside image generation. */
export function WorkflowReservationsPanel() {
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber } = useI18n()
  const [selectedReservationExecutionIds, setSelectedReservationExecutionIds] = useState<number[]>([])
  const [isCleaningReservations, setIsCleaningReservations] = useState(false)
  const [isMutatingSchedules, setIsMutatingSchedules] = useState(false)

  const reservationsQuery = useQuery({
    queryKey: ['module-graph-browse-content', 'generation-reservations', 'root'],
    queryFn: () => getGraphWorkflowBrowseContent(null, { includeOutputs: false }),
  })

  const reservationContent = reservationsQuery.data
  const workflows = useMemo(() => reservationContent?.workflows ?? [], [reservationContent?.workflows])
  const schedules = reservationContent?.schedules ?? []
  const reservationExecutions = useMemo(() => reservationContent?.empty_executions ?? [], [reservationContent?.empty_executions])

  const workflowNameById = useMemo(
    () => new Map<number, string>(workflows.map((workflow: GraphWorkflowRecord) => [workflow.id, workflow.name])),
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
    if (!window.confirm(t({ ko: '이 예약작업을 정말 삭제할까? 연결된 queued 예약 실행도 함께 정리될 수 있어.', en: 'Delete this reservation job? Linked queued reservation runs may be cleaned up too.' }))) {
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
    <section className="space-y-4">
      <SettingsSection
        heading={t({ ko: '예약작업', en: 'Reservation jobs' })}
        actions={(
          <>
            <Badge variant={schedules.length > 0 ? 'secondary' : 'outline'}>{t({ ko: '스케줄 {count}', en: 'Schedules {count}' }, { count: formatNumber(schedules.length) })}</Badge>
            <Badge variant={reservationExecutions.length > 0 ? 'secondary' : 'outline'}>{t({ ko: '예약 실행 {count}', en: 'Reservation runs {count}' }, { count: formatNumber(reservationExecutions.length) })}</Badge>
            <Button type="button" size="icon-sm" variant="outline" onClick={() => void handleRefresh()} title={t({ ko: '예약작업 새로고침', en: 'Refresh reservation jobs' })} aria-label={t({ ko: '예약작업 새로고침', en: 'Refresh reservation jobs' })}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </>
        )}
      >
        {reservationsQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t({ ko: '예약작업을 불러오지 못했어', en: 'Could not load reservation jobs' })}</AlertTitle>
            <AlertDescription>{getErrorMessage(reservationsQuery.error, t({ ko: '예약작업 조회 실패', en: 'Failed to load reservation jobs' }))}</AlertDescription>
          </Alert>
        ) : null}

        {!reservationsQuery.isError && reservationsQuery.isPending ? <div className="text-sm text-muted-foreground">{t({ ko: '예약작업 불러오는 중…', en: 'Loading reservation jobs…' })}</div> : null}

        {!reservationsQuery.isPending && !reservationsQuery.isError && reservationContent ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SettingsValueTile label={t({ ko: '예약작업', en: 'Reservation jobs' })} value={reservationContent.scope.schedule_count} valueClassName="text-lg" />
            <SettingsValueTile label={t({ ko: '예약 실행', en: 'Reservation runs' })} value={reservationContent.scope.empty_execution_count} valueClassName="text-lg" />
            <SettingsValueTile label={t({ ko: '워크플로우', en: 'Workflows' })} value={reservationContent.scope.workflow_count} valueClassName="text-lg" />
            <SettingsValueTile label={t({ ko: '실행', en: 'Executions' })} value={reservationContent.scope.execution_count} valueClassName="text-lg" />
          </div>
        ) : null}
      </SettingsSection>

      {reservationContent ? (
        <ModuleWorkflowEmptyRunsTab
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

      <SelectionActionBar
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
              variant="outline"
              onClick={() => void handleCancelSelectedReservationExecutions()}
              disabled={isCleaningReservations || cancelableReservationExecutions.length === 0}
              data-no-select-drag="true"
            >
              <XCircle className="h-4 w-4" />
              {t({ ko: '활성 취소 ({count})', en: 'Cancel active ({count})' }, { count: formatNumber(cancelableReservationExecutions.length) })}
            </Button>
            <Button
              size="sm"
              onClick={() => void handleCleanupSelectedReservations()}
              disabled={isCleaningReservations || deletableReservationExecutions.length === 0}
              data-no-select-drag="true"
            >
              <Trash2 className="h-4 w-4" />
              {t({ ko: '빈 실행 삭제 ({count})', en: 'Delete empty runs ({count})' }, { count: formatNumber(deletableReservationExecutions.length) })}
            </Button>
          </>
        )}
      />
    </section>
  )
}
