import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Pause, Play, Plus, Rocket, Save, SquarePen, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { SettingsField, SettingsInsetBlock, SettingsSection } from '@/features/settings/components/settings-primitives'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { useI18n, type TranslationInput } from '@/i18n'
import type {
  GraphWorkflowRecord,
  GraphWorkflowScheduleFailurePolicy,
  GraphWorkflowScheduleRecord,
  GraphWorkflowScheduleStatus,
  GraphWorkflowScheduleType,
} from '@/lib/api-module-graph'
import { getGraphWorkflowScheduleStatusLabel, getGraphWorkflowStopReasonLabel } from '../module-graph-shared'
import { WorkflowInputFields } from './workflow-input-fields'

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

function getScheduleStatusVariant(status: GraphWorkflowScheduleStatus) {
  if (status === 'active') {
    return 'secondary' as const
  }
  if (status === 'error_stopped' || status === 'overlap_stopped') {
    return 'destructive' as const
  }
  return 'outline' as const
}

function getScheduleTypeLabel(scheduleType: GraphWorkflowScheduleType, t: (input: TranslationInput) => string) {
  if (scheduleType === 'once') {
    return t({ ko: '1회 실행', en: 'Run once' })
  }
  if (scheduleType === 'interval') {
    return t({ ko: 'N분마다', en: 'Every N minutes' })
  }
  return t({ ko: '매일', en: 'Daily' })
}

function getScheduleRunSummaryLabel(schedule: GraphWorkflowScheduleRecord, formatNumber: (value: number) => string) {
  const completedCount = schedule.completed_run_count ?? 0
  const maxRunCount = schedule.max_run_count
  return `${formatNumber(completedCount)}/${maxRunCount === null || maxRunCount === undefined ? '-' : formatNumber(maxRunCount)}`
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
  workflows: GraphWorkflowRecord[]
  workflowNameById: Map<number, string>
  isMutating: boolean
  onCreateSchedule: (payload: { graph_workflow_id: number } & ScheduleMutationPayload) => Promise<void> | void
  onUpdateSchedule: (scheduleId: number, payload: ScheduleMutationPayload) => Promise<void> | void
  onPauseSchedule: (scheduleId: number) => Promise<void> | void
  onResumeSchedule: (scheduleId: number) => Promise<void> | void
  onDeleteSchedule: (scheduleId: number) => Promise<void> | void
  onRunNow: (scheduleId: number) => Promise<void> | void
}) {
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

  const selectedWorkflowRecord = useMemo(
    () => workflows.find((workflow) => String(workflow.id) === draftWorkflowId) ?? null,
    [draftWorkflowId, workflows],
  )
  const selectedInputDefinitions = selectedWorkflowRecord?.graph.metadata?.exposed_inputs ?? []

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
  }

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

  return (
    <>
      <SettingsSection
        heading={t({ ko: '자동 실행', en: 'Autorun' })}
        actions={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant="outline">{schedules.length}</Badge>
            <Button type="button" size="sm" variant="outline" onClick={openCreateEditor} disabled={workflows.length === 0 || isMutating}>
              <Plus className="h-4 w-4" />
              {t({ ko: '자동 실행 추가', en: 'Add autorun' })}
            </Button>
          </div>
        )}
      >
        {schedules.length === 0 ? (
          <SettingsInsetBlock className="border-dashed py-8 text-sm text-muted-foreground">
            {t({ ko: '자동 실행 없음', en: 'No autoruns' })}
          </SettingsInsetBlock>
        ) : (
          <div className="space-y-3">
            {schedules.map((schedule) => {
              const workflowName = workflowNameById.get(schedule.graph_workflow_id) ?? t({ ko: '워크플로우 #{id}', en: 'Workflow #{id}' }, { id: schedule.graph_workflow_id })
              const reservedCountLabel = t({ ko: '최대 {count}회', en: 'Max {count}' }, { count: formatNumber(schedule.max_run_count ?? -1) })
              const runEnqueueCountLabel = t({ ko: '1회 {count}개', en: '{count} per run' }, { count: formatNumber(schedule.run_enqueue_count ?? 1) })
              const runSummaryLabel = getScheduleRunSummaryLabel(schedule, formatNumber)
              const failurePolicyLabel = getScheduleFailurePolicyLabel(schedule.failure_policy, t)
              const scheduleTimingLabel = schedule.schedule_type === 'once'
                ? (schedule.run_at ? formatDateTime(schedule.run_at) : t({ ko: '시각 미설정', en: 'Time not set' }))
                : schedule.schedule_type === 'interval'
                  ? t({ ko: '{minutes}분마다', en: 'Every {minutes} min' }, { minutes: schedule.interval_minutes === null || schedule.interval_minutes === undefined ? '?' : formatNumber(schedule.interval_minutes) })
                  : t({ ko: '{time} 매일', en: 'Daily at {time}' }, { time: schedule.daily_time ?? '--:--' })

              return (
                <SettingsInsetBlock key={schedule.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-medium text-foreground">{schedule.name}</div>
                        <Badge variant={getScheduleStatusVariant(schedule.status)}>{getGraphWorkflowScheduleStatusLabel(schedule.status)}</Badge>
                        <Badge variant="outline">{getScheduleTypeLabel(schedule.schedule_type, t)}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {workflowName} · {scheduleTimingLabel} · {runEnqueueCountLabel} · {reservedCountLabel} · {failurePolicyLabel}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{runSummaryLabel}</span>
                        {schedule.next_run_at ? <span>{t({ ko: '· 다음 등록 시도 {time}', en: '· Next enqueue attempt {time}' }, { time: formatDateTime(schedule.next_run_at) })}</span> : null}
                        {schedule.last_enqueued_at ? <span>{t({ ko: '· 최근 큐 등록 {time}', en: '· Last queued {time}' }, { time: formatDateTime(schedule.last_enqueued_at) })}</span> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" size="icon-sm" variant="outline" onClick={() => openEditEditor(schedule)} disabled={isMutating} aria-label={t({ ko: '자동 실행 수정', en: 'Edit autorun' })} title={t({ ko: '자동 실행 수정', en: 'Edit autorun' })}>
                        <SquarePen className="h-4 w-4" />
                      </Button>
                      {schedule.status === 'active' ? (
                        <Button type="button" size="icon-sm" variant="outline" onClick={() => void onPauseSchedule(schedule.id)} disabled={isMutating} aria-label={t({ ko: '자동 실행 일시정지', en: 'Pause autorun' })} title={t({ ko: '자동 실행 일시정지', en: 'Pause autorun' })}>
                          <Pause className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button type="button" size="icon-sm" variant="outline" onClick={() => void onResumeSchedule(schedule.id)} disabled={isMutating} aria-label={t({ ko: '자동 실행 재개', en: 'Resume autorun' })} title={t({ ko: '자동 실행 재개', en: 'Resume autorun' })}>
                          <Play className="h-4 w-4" />
                        </Button>
                      )}
                      <Button type="button" size="icon-sm" variant="outline" onClick={() => void onRunNow(schedule.id)} disabled={isMutating} aria-label={t({ ko: '지금 1회 실행', en: 'Run once now' })} title={t({ ko: '지금 1회 실행', en: 'Run once now' })}>
                        <Rocket className="h-4 w-4" />
                      </Button>
                      <Button type="button" size="icon-sm" variant="outline" onClick={() => void onDeleteSchedule(schedule.id)} disabled={isMutating} aria-label={t({ ko: '자동 실행 삭제', en: 'Delete autorun' })} title={t({ ko: '자동 실행 삭제', en: 'Delete autorun' })}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {getGraphWorkflowStopReasonLabel(schedule.stop_reason_code, schedule.stop_reason_message) ? (
                    <SettingsInsetBlock className="mt-3 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{t({ ko: '중지/정지 사유', en: 'Stop reason' })}</span>
                      <span className="ml-2">{getGraphWorkflowStopReasonLabel(schedule.stop_reason_code, schedule.stop_reason_message)}</span>
                    </SettingsInsetBlock>
                  ) : null}
                </SettingsInsetBlock>
              )
            })}
          </div>
        )}
      </SettingsSection>

      <SettingsModal
        open={editorMode !== null}
        onClose={resetDraft}
        title={editorMode === 'edit' ? t({ ko: '자동 실행 수정', en: 'Edit autorun' }) : t({ ko: '자동 실행 추가', en: 'Add autorun' })}
        widthClassName="max-w-5xl"
      >
        <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SettingsField label={t({ ko: '대상 워크플로우', en: 'Target workflow' })} className="xl:col-span-2">
              <Select value={draftWorkflowId} onChange={(event) => setDraftWorkflowId(event.target.value)} disabled={editorMode === 'edit' || isMutating}>
                {workflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
                ))}
              </Select>
            </SettingsField>
            <SettingsField label={t({ ko: '일정 방식', en: 'Schedule type' })}>
              <Select value={draftScheduleType} onChange={(event) => setDraftScheduleType(event.target.value as GraphWorkflowScheduleType)} disabled={isMutating}>
                <option value="once">{t({ ko: '1회 실행', en: 'Run once' })}</option>
                <option value="interval">{t({ ko: 'N분마다', en: 'Every N minutes' })}</option>
                <option value="daily">{t({ ko: '매일', en: 'Daily' })}</option>
              </Select>
            </SettingsField>
            <SettingsField label={t({ ko: '시작 상태', en: 'Initial status' })}>
              <Select value={draftEnabled} onChange={(event) => setDraftEnabled(event.target.value as 'active' | 'paused')} disabled={isMutating}>
                <option value="active">{t({ ko: '활성', en: 'Active' })}</option>
                <option value="paused">{t({ ko: '일시정지', en: 'Paused' })}</option>
              </Select>
            </SettingsField>
            <SettingsField label={t({ ko: '이름', en: 'Name' })} className="xl:col-span-2">
              <Input value={draftName} onChange={(event) => setDraftName(event.target.value)} disabled={isMutating} />
            </SettingsField>
            <SettingsField label={t({ ko: '최대 예약 횟수', en: 'Max runs' })}>
              <Input type="number" min={-1} value={draftMaxRunCount} onChange={(event) => setDraftMaxRunCount(event.target.value)} disabled={isMutating} />
            </SettingsField>
            <SettingsField label={t({ ko: '1회 큐 등록수', en: 'Queue count per run' })}>
              <Input type="number" min={1} max={100} value={draftEnqueueCount} onChange={(event) => setDraftEnqueueCount(event.target.value)} disabled={isMutating} />
            </SettingsField>
            <SettingsField label={t({ ko: '실패 처리', en: 'Failure handling' })}>
              <Select value={draftFailurePolicy} onChange={(event) => setDraftFailurePolicy(event.target.value as GraphWorkflowScheduleFailurePolicy)} disabled={isMutating}>
                <option value="stop">{t({ ko: '실패 시 중지', en: 'Stop on failure' })}</option>
                <option value="continue">{t({ ko: '실패해도 계속', en: 'Continue on failure' })}</option>
              </Select>
            </SettingsField>
            {draftScheduleType === 'once' ? (
              <SettingsField label={t({ ko: '실행 시각', en: 'Run time' })}>
                <Input type="datetime-local" value={draftRunAt} onChange={(event) => setDraftRunAt(event.target.value)} disabled={isMutating} />
              </SettingsField>
            ) : null}
            {draftScheduleType === 'interval' ? (
              <SettingsField label={t({ ko: '반복 간격(분)', en: 'Repeat interval (min)' })}>
                <Input type="number" min={1} value={draftIntervalMinutes} onChange={(event) => setDraftIntervalMinutes(event.target.value)} disabled={isMutating} />
              </SettingsField>
            ) : null}
            {draftScheduleType === 'daily' ? (
              <SettingsField label={t({ ko: '실행 시각', en: 'Run time' })}>
                <Input type="time" value={draftDailyTime} onChange={(event) => setDraftDailyTime(event.target.value)} disabled={isMutating} />
              </SettingsField>
            ) : null}
          </div>

          {selectedInputDefinitions.length > 0 ? (
            <div className="space-y-3">
              <div className="text-sm font-medium text-foreground">{t({ ko: '저장 입력값', en: 'Saved inputs' })}</div>
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
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 pt-4">
            <Button type="button" variant="secondary" onClick={resetDraft} disabled={isMutating}>
              {t({ ko: '취소', en: 'Cancel' })}
            </Button>
            <Button type="submit" disabled={isMutating || submitDisabled}>
              {editorMode === 'edit' ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editorMode === 'edit' ? t({ ko: '저장', en: 'Save' }) : t({ ko: '추가', en: 'Add' })}
            </Button>
          </div>
        </form>
      </SettingsModal>
    </>
  )
}
