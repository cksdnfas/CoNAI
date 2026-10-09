import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pause, Play, Plus, Rocket, SquarePen, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EditorFooter } from '@/components/ui/editor-footer'
import { EditorGroup } from '@/components/ui/editor-group'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Modal } from '@/components/ui/modal'
import { SettingRow } from '@/components/ui/setting-row'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { Section } from '@/components/ui/section'
import { useI18n, type TranslationInput } from '@/i18n'
import { getGraphWorkflow } from '@/lib/api-module-graph'
import type {
  GraphWorkflowNameRecord,
  GraphWorkflowScheduleFailurePolicy,
  GraphWorkflowScheduleRecord,
  GraphWorkflowScheduleType,
} from '@/lib/api-module-graph'
import {
  getReservationRunAtLabel,
  getReservationRunSummaryLabel,
  getReservationStatusVariant,
  getReservationTypeLabel,
} from '@/features/image-generation/components/workflow-reservations-ui'
import { getGraphWorkflowScheduleStatusLabel, getGraphWorkflowStopReasonLabel } from '../module-graph-shared'
import { WorkflowInputFields } from './workflow-input-fields'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { EmptyState } from '@/components/ui/empty-state'

type ScheduleMutationPayload = {
  name: string
  schedule_type: GraphWorkflowScheduleType
  status?: 'active' | 'paused'
  run_at?: string | null
  interval_minutes?: number | null
  daily_time?: string | null
  max_run_count?: number | null
  run_enqueue_count?: number | null
  failure_policy?: GraphWorkflowScheduleFailurePolicy | null
  input_values?: Record<string, unknown> | null
}

function parseStoredInputValues(value?: string | null) {
  if (!value) {
    return {}
  }

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function formatDateTimeLocalInput(value?: string | null) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function parseDateTimeLocalInput(value: string) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function getScheduleFailurePolicyLabel(failurePolicy: GraphWorkflowScheduleFailurePolicy | null | undefined, t: (input: TranslationInput) => string) {
  return failurePolicy === 'continue' ? t({ ko: '실패 시 계속', en: 'Continue on failure' }) : t({ ko: '실패 시 중지', en: 'Stop on failure' })
}

/** Render workflow autorun list and inline create/edit controls inside the queue tab. */
export function ModuleWorkflowSchedulesPanel({
  schedules,
  workflows,
  workflowNameById,
  isMutating,
  onCreateSchedule,
  onUpdateSchedule,
  onPauseSchedule,
  onResumeSchedule,
  onDeleteSchedule,
  onRunNow,
}: {
  schedules: GraphWorkflowScheduleRecord[]
  workflows: GraphWorkflowNameRecord[]
  workflowNameById: Map<number, string>
  isMutating: boolean
  onCreateSchedule: (payload: { graph_workflow_id: number } & ScheduleMutationPayload) => Promise<void> | void
  onUpdateSchedule: (scheduleId: number, payload: ScheduleMutationPayload) => Promise<void> | void
  onPauseSchedule: (scheduleId: number) => Promise<void> | void
  onResumeSchedule: (scheduleId: number) => Promise<void> | void
  onDeleteSchedule: (scheduleId: number) => Promise<void> | void
  onRunNow: (scheduleId: number) => Promise<void> | void
}) {
  const { canExecuteGeneration, canUpdateWorkflows } = useFeaturePermissions()
  const { t, formatNumber, formatDateTime } = useI18n()
  const [editorMode, setEditorMode] = useState<'create' | 'edit' | null>(null)
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null)
  const [draftWorkflowId, setDraftWorkflowId] = useState('')
  const [draftName, setDraftName] = useState('')
  const [draftScheduleType, setDraftScheduleType] = useState<GraphWorkflowScheduleType>('once')
  const [draftEnabled, setDraftEnabled] = useState<'active' | 'paused'>('active')
  const [draftRunAt, setDraftRunAt] = useState('')
  const [draftIntervalMinutes, setDraftIntervalMinutes] = useState('60')
  const [draftDailyTime, setDraftDailyTime] = useState('09:00')
  const [draftMaxRunCount, setDraftMaxRunCount] = useState('-1')
  const [draftFailurePolicy, setDraftFailurePolicy] = useState<GraphWorkflowScheduleFailurePolicy>('stop')
  const [draftEnqueueCount, setDraftEnqueueCount] = useState('1')
  const [draftInputValues, setDraftInputValues] = useState<Record<string, unknown>>({})
  /** The draft as the editor opened, to tell unsaved edits (null until the opened values have rendered). */
  const [openedSnapshot, setOpenedSnapshot] = useState<string | null>(null)
  const draftSnapshot = JSON.stringify([draftWorkflowId, draftName, draftScheduleType, draftEnabled, draftRunAt, draftIntervalMinutes, draftDailyTime, draftMaxRunCount, draftFailurePolicy, draftEnqueueCount, draftInputValues])

  // WF-1: 예약 목록 응답에는 그래프 문서가 없다. 편집기를 열 때 선택한 워크플로우만 by-id 로 받아
  // 노출 입력 정의를 구성한다(모듈그래프 페이지 상세 쿼리와 키가 같아 캐시를 함께 쓴다).
  const draftWorkflowNumericId = Number(draftWorkflowId)
  const hasDraftWorkflowId = Number.isInteger(draftWorkflowNumericId) && draftWorkflowNumericId > 0
  const selectedWorkflowDetailQuery = useQuery({
    queryKey: ['module-graph-workflow-detail', hasDraftWorkflowId ? draftWorkflowNumericId : null],
    queryFn: () => getGraphWorkflow(draftWorkflowNumericId),
    enabled: editorMode !== null && hasDraftWorkflowId,
    staleTime: 30_000,
  })
  const selectedInputDefinitions = selectedWorkflowDetailQuery.data?.graph.metadata?.exposed_inputs ?? []

  const resetDraft = () => {
    setEditorMode(null)
    setEditingScheduleId(null)
    setDraftWorkflowId(workflows[0] ? String(workflows[0].id) : '')
    setDraftName('')
    setDraftScheduleType('once')
    setDraftEnabled('active')
    setDraftRunAt('')
    setDraftIntervalMinutes('60')
    setDraftDailyTime('09:00')
    setDraftMaxRunCount('-1')
    setDraftFailurePolicy('stop')
    setDraftEnqueueCount('1')
    setDraftInputValues({})
    setOpenedSnapshot(null)
  }

  useEffect(() => {
    if (editorMode !== null && openedSnapshot === null) {
      setOpenedSnapshot(draftSnapshot)
    }
  }, [draftSnapshot, editorMode, openedSnapshot])

  useEffect(() => {
    if (!editorMode && !editingScheduleId && !draftWorkflowId && workflows[0]) {
      setDraftWorkflowId(String(workflows[0].id))
    }
  }, [draftWorkflowId, editingScheduleId, editorMode, workflows])

  const openCreateEditor = () => {
    resetDraft()
    setEditorMode('create')
  }

  const openEditEditor = (schedule: GraphWorkflowScheduleRecord) => {
    setEditorMode('edit')
    setEditingScheduleId(schedule.id)
    setDraftWorkflowId(String(schedule.graph_workflow_id))
    setDraftName(schedule.name)
    setDraftScheduleType(schedule.schedule_type)
    setDraftEnabled(schedule.status === 'active' ? 'active' : 'paused')
    setDraftRunAt(formatDateTimeLocalInput(schedule.run_at))
    setDraftIntervalMinutes(schedule.interval_minutes ? String(schedule.interval_minutes) : '60')
    setDraftDailyTime(schedule.daily_time || '09:00')
    setDraftMaxRunCount(schedule.max_run_count ? String(schedule.max_run_count) : '-1')
    setDraftFailurePolicy(schedule.failure_policy === 'continue' ? 'continue' : 'stop')
    setDraftEnqueueCount(String(schedule.run_enqueue_count ?? 1))
    setDraftInputValues(parseStoredInputValues(schedule.input_values))
  }

  const buildPayload = useCallback((): ScheduleMutationPayload | null => {
    const name = draftName.trim()
    const workflowId = Number(draftWorkflowId)
    if (!name || !Number.isFinite(workflowId)) {
      return null
    }

    const runAt = draftScheduleType === 'once' ? parseDateTimeLocalInput(draftRunAt) : null
    const intervalMinutes = draftScheduleType === 'interval'
      ? (draftIntervalMinutes.trim() ? Number(draftIntervalMinutes) : null)
      : null
    const dailyTime = draftScheduleType === 'daily' ? draftDailyTime.trim() || null : null
    const normalizedMaxRunCountText = draftMaxRunCount.trim()
    const maxRunCount = normalizedMaxRunCountText ? Number(normalizedMaxRunCountText) : null
    const normalizedEnqueueCountText = draftEnqueueCount.trim()
    const enqueueCount = normalizedEnqueueCountText ? Number(normalizedEnqueueCountText) : 1

    return {
      name,
      schedule_type: draftScheduleType,
      status: draftEnabled,
      run_at: runAt,
      interval_minutes: intervalMinutes && intervalMinutes > 0 ? intervalMinutes : null,
      daily_time: dailyTime,
      max_run_count: maxRunCount === -1 ? -1 : maxRunCount && maxRunCount > 0 ? maxRunCount : null,
      run_enqueue_count: Number.isFinite(enqueueCount) ? Math.floor(enqueueCount) : 1,
      failure_policy: draftFailurePolicy,
      input_values: Object.keys(draftInputValues).length > 0 ? draftInputValues : null,
    }
  }, [draftDailyTime, draftEnabled, draftEnqueueCount, draftFailurePolicy, draftInputValues, draftIntervalMinutes, draftMaxRunCount, draftName, draftRunAt, draftScheduleType, draftWorkflowId])

  const submitDisabled = useMemo(() => {
    const payload = buildPayload()
    const workflowId = Number(draftWorkflowId)
    if (!payload || !Number.isFinite(workflowId)) {
      return true
    }
    if (payload.schedule_type === 'once' && !payload.run_at) {
      return true
    }
    if (payload.schedule_type === 'interval' && !payload.interval_minutes) {
      return true
    }
    if (payload.schedule_type === 'daily' && !payload.daily_time) {
      return true
    }
    if ((payload.run_enqueue_count ?? 1) < 1 || (payload.run_enqueue_count ?? 1) > 100) {
      return true
    }
    return false
  }, [buildPayload, draftWorkflowId])

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()

    const payload = buildPayload()
    const workflowId = Number(draftWorkflowId)
    if (!payload || !Number.isFinite(workflowId)) {
      return
    }

    if (payload.schedule_type === 'once' && !payload.run_at) {
      return
    }
    if (payload.schedule_type === 'interval' && !payload.interval_minutes) {
      return
    }
    if (payload.schedule_type === 'daily' && !payload.daily_time) {
      return
    }

    if (editorMode === 'edit' && editingScheduleId !== null) {
      await onUpdateSchedule(editingScheduleId, payload)
    } else {
      await onCreateSchedule({
        graph_workflow_id: workflowId,
        ...payload,
      })
    }

    resetDraft()
  }

  const draftDirty = editorMode !== null && openedSnapshot !== null && draftSnapshot !== openedSnapshot
  const canSaveDraft = canExecuteGeneration && canUpdateWorkflows && !isMutating && !submitDisabled && (draftDirty || editorMode === 'create')

  return (
    <>
      <Section
        variant="settings"
        heading={t({ ko: '자동 실행', en: 'Autorun' })}
        actions={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <IconButton size="icon-sm" variant="secondary" onClick={openCreateEditor} disabled={!(canExecuteGeneration && canUpdateWorkflows) || (workflows.length === 0 || isMutating)} label={t({ ko: '자동 실행 추가', en: 'Add autorun' })}>
              <Plus />
            </IconButton>
          </div>
        )}
      >
        {schedules.length === 0 ? (
          <EmptyState title={t({ ko: '자동 실행 없음', en: 'No autoruns' })} />
        ) : (
          <div>
            {schedules.map((schedule) => {
              const workflowName = workflowNameById.get(schedule.graph_workflow_id) ?? t({ ko: '워크플로우 #{id}', en: 'Workflow #{id}' }, { id: schedule.graph_workflow_id })
              const runEnqueueCountLabel = t({ ko: '1회 {count}개', en: '{count} per run' }, { count: formatNumber(schedule.run_enqueue_count ?? 1) })
              const runSummaryLabel = getReservationRunSummaryLabel(schedule, t, formatNumber)
              const failurePolicyLabel = getScheduleFailurePolicyLabel(schedule.failure_policy, t)
              const runAtLabel = getReservationRunAtLabel(schedule, t, (value) => formatDateTime(value))
              const stopReasonLabel = getGraphWorkflowStopReasonLabel(schedule.stop_reason_code, schedule.stop_reason_message, t)

              return (
                <div key={schedule.id} className="border-b border-line py-2.5 last:border-b-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-medium text-foreground">{schedule.name}</div>
                        <Badge variant={getReservationStatusVariant(schedule.status)}>{getGraphWorkflowScheduleStatusLabel(schedule.status, t)}</Badge>
                        <Badge variant="outline">{getReservationTypeLabel(schedule, t, formatNumber)}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {[workflowName, runAtLabel, runEnqueueCountLabel, failurePolicyLabel].filter(Boolean).join(' · ')}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                        <span>{runSummaryLabel}</span>
                        {(schedule.running_run_count ?? 0) > 0 ? <Badge variant="secondary">{t({ ko: '실행 중 {count}', en: 'Running {count}' }, { count: formatNumber(schedule.running_run_count ?? 0) })}</Badge> : null}
                        {(schedule.queued_run_count ?? 0) > 0 ? <Badge variant="outline">{t({ ko: '대기 {count}', en: 'Queued {count}' }, { count: formatNumber(schedule.queued_run_count ?? 0) })}</Badge> : null}
                        {schedule.next_run_at ? <span>{t({ ko: '· 다음 {time}', en: '· Next {time}' }, { time: formatDateTime(schedule.next_run_at) })}</span> : null}
                        {schedule.last_enqueued_at ? <span>{t({ ko: '· 최근 {time}', en: '· Last {time}' }, { time: formatDateTime(schedule.last_enqueued_at) })}</span> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <IconButton size="icon-sm" variant="ghost" onClick={() => openEditEditor(schedule)} disabled={!(canExecuteGeneration && canUpdateWorkflows) || (isMutating)} label={t({ ko: '자동 실행 수정', en: 'Edit autorun' })}>
                        <SquarePen className="h-4 w-4" />
                      </IconButton>
                      {schedule.status === 'active' ? (
                        <IconButton size="icon-sm" variant="ghost" onClick={() => void onPauseSchedule(schedule.id)} disabled={!canExecuteGeneration || isMutating} label={t({ ko: '자동 실행 일시정지', en: 'Pause autorun' })}>
                          <Pause className="h-4 w-4" />
                        </IconButton>
                      ) : (
                        <IconButton size="icon-sm" variant="ghost" onClick={() => void onResumeSchedule(schedule.id)} disabled={!canExecuteGeneration || isMutating} label={t({ ko: '자동 실행 재개', en: 'Resume autorun' })}>
                          <Play className="h-4 w-4" />
                        </IconButton>
                      )}
                      <IconButton size="icon-sm" variant="ghost" onClick={() => void onRunNow(schedule.id)} disabled={!canExecuteGeneration || isMutating} label={t({ ko: '지금 1회 실행', en: 'Run once now' })}>
                        <Rocket className="h-4 w-4" />
                      </IconButton>
                      <IconButton size="icon-sm" variant="ghost" onClick={() => void onDeleteSchedule(schedule.id)} disabled={!canUpdateWorkflows || isMutating} label={t({ ko: '자동 실행 삭제', en: 'Delete autorun' })}>
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </div>
                  {stopReasonLabel ? (
                    <div role="status" className="mt-3 rounded-sm bg-warning-soft/45 px-3 py-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{t({ ko: '중지/정지 사유', en: 'Stop reason' })}</span>
                      <span className="ml-2">{stopReasonLabel}</span>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <Modal
        open={editorMode !== null}
        onClose={resetDraft}
        title={editorMode === 'edit' ? t({ ko: '자동 실행 수정', en: 'Edit autorun' }) : t({ ko: '자동 실행 추가', en: 'Add autorun' })}
        size="normal"
        height="tall"
        dirty={draftDirty}
        onSave={canSaveDraft ? () => void handleSubmit() : undefined}
      >
        <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t({ ko: '대상 워크플로우', en: 'Target workflow' })}>
              <Select variant="settings" value={draftWorkflowId} onChange={(event) => setDraftWorkflowId(event.target.value)} disabled={editorMode === 'edit' || isMutating}>
                {workflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
                ))}
              </Select>
            </Field>
            <Field label={t({ ko: '이름', en: 'Name' })}>
              <Input variant="settings" value={draftName} onChange={(event) => setDraftName(event.target.value)} disabled={isMutating} />
            </Field>
            <Field label={t({ ko: '일정 방식', en: 'Schedule type' })}>
              <Select variant="settings" value={draftScheduleType} onChange={(event) => setDraftScheduleType(event.target.value as GraphWorkflowScheduleType)} disabled={isMutating}>
                <option value="once">{t({ ko: '1회 실행', en: 'Run once' })}</option>
                <option value="interval">{t({ ko: 'N분마다', en: 'Every N minutes' })}</option>
                <option value="daily">{t({ ko: '매일', en: 'Daily' })}</option>
              </Select>
            </Field>
            {draftScheduleType === 'once' ? (
              <Field label={t({ ko: '실행 시각', en: 'Run time' })}>
                <Input variant="settings" type="datetime-local" value={draftRunAt} onChange={(event) => setDraftRunAt(event.target.value)} disabled={isMutating} />
              </Field>
            ) : null}
            {draftScheduleType === 'interval' ? (
              <Field label={t({ ko: '반복 간격(분)', en: 'Repeat interval (min)' })}>
                <NumberStepperInput variant="settings" min={1} value={draftIntervalMinutes} onValueCommit={(nextValue) => setDraftIntervalMinutes(nextValue)} disabled={isMutating} />
              </Field>
            ) : null}
            {draftScheduleType === 'daily' ? (
              <Field label={t({ ko: '실행 시각', en: 'Run time' })}>
                <Input variant="settings" type="time" value={draftDailyTime} onChange={(event) => setDraftDailyTime(event.target.value)} disabled={isMutating} />
              </Field>
            ) : null}
            <Field label={t({ ko: '최대 예약 횟수', en: 'Max runs' })}>
              <NumberStepperInput variant="settings" min={-1} value={draftMaxRunCount} onValueCommit={(nextValue) => setDraftMaxRunCount(nextValue)} disabled={isMutating} />
            </Field>
            <Field label={t({ ko: '1회 큐 등록수', en: 'Queue count per run' })}>
              <NumberStepperInput variant="settings" min={1} max={100} value={draftEnqueueCount} onValueCommit={(nextValue) => setDraftEnqueueCount(nextValue)} disabled={isMutating} />
            </Field>
          </div>

          <div className="border-y border-line">
            <SettingsSwitchRow
              label={t({ ko: '활성', en: 'Active' })}
              checked={draftEnabled === 'active'}
              disabled={isMutating}
              onCheckedChange={(checked) => setDraftEnabled(checked ? 'active' : 'paused')}
            />
            <SettingRow label={t({ ko: '실패 처리', en: 'Failure handling' })}>
              <Select variant="settings" className="w-44" aria-label={t({ ko: '실패 처리', en: 'Failure handling' })} value={draftFailurePolicy} onChange={(event) => setDraftFailurePolicy(event.target.value as GraphWorkflowScheduleFailurePolicy)} disabled={isMutating}>
                <option value="stop">{t({ ko: '실패 시 중지', en: 'Stop on failure' })}</option>
                <option value="continue">{t({ ko: '실패해도 계속', en: 'Continue on failure' })}</option>
              </Select>
            </SettingRow>
          </div>

          {selectedInputDefinitions.length > 0 ? (
            <EditorGroup label={t({ ko: '저장 입력값', en: 'Saved inputs' })}>
              <WorkflowInputFields
                inputDefinitions={selectedInputDefinitions}
                inputValues={draftInputValues}
                onInputValueChange={(inputId, value) => setDraftInputValues((current) => ({ ...current, [inputId]: value }))}
                onInputValueClear={(inputId) => setDraftInputValues((current) => {
                  const next = { ...current }
                  delete next[inputId]
                  return next
                })}
                onInputImageChange={async (inputId: string, image?: SelectedImageDraft) => {
                  setDraftInputValues((current) => {
                    const next = { ...current }
                    if (!image) {
                      delete next[inputId]
                      return next
                    }
                    next[inputId] = image.dataUrl
                    return next
                  })
                }}
              />
            </EditorGroup>
          ) : null}

          <EditorFooter
            saveSubmit
            canSave={canSaveDraft}
            saving={isMutating}
            saveLabel={editorMode === 'edit' ? t({ ko: '저장', en: 'Save' }) : t({ ko: '추가', en: 'Add' })}
          />
        </form>
      </Modal>
    </>
  )
}
