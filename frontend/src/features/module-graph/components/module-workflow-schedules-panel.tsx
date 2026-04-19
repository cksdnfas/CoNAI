import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Pause, Play, Plus, Rocket, Save, SquarePen, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { SettingsField } from '@/features/settings/components/settings-primitives'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import type { GraphWorkflowRecord, GraphWorkflowScheduleRecord, GraphWorkflowScheduleStatus, GraphWorkflowScheduleType } from '@/lib/api'
import { formatDateTime } from '../module-graph-shared'
import { WorkflowInputFields } from './workflow-input-fields'

type ScheduleMutationPayload = {
  name: string
  schedule_type: GraphWorkflowScheduleType
  status?: 'active' | 'paused'
  run_at?: string | null
  interval_minutes?: number | null
  daily_time?: string | null
  max_run_count?: number | null
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

function getScheduleTypeLabel(scheduleType: GraphWorkflowScheduleType) {
  if (scheduleType === 'once') {
    return '1회 실행'
  }
  if (scheduleType === 'interval') {
    return 'N분마다'
  }
  return '매일'
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
  const [editorMode, setEditorMode] = useState<'create' | 'edit' | null>(null)
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null)
  const [draftWorkflowId, setDraftWorkflowId] = useState('')
  const [draftName, setDraftName] = useState('')
  const [draftScheduleType, setDraftScheduleType] = useState<GraphWorkflowScheduleType>('once')
  const [draftEnabled, setDraftEnabled] = useState<'active' | 'paused'>('active')
  const [draftRunAt, setDraftRunAt] = useState('')
  const [draftIntervalMinutes, setDraftIntervalMinutes] = useState('60')
  const [draftDailyTime, setDraftDailyTime] = useState('09:00')
  const [draftMaxRunCount, setDraftMaxRunCount] = useState('')
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
    setDraftMaxRunCount('')
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
    setDraftMaxRunCount(schedule.max_run_count ? String(schedule.max_run_count) : '')
    setDraftInputValues(parseStoredInputValues(schedule.input_values))
  }

  const buildPayload = (): ScheduleMutationPayload | null => {
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
    const maxRunCount = draftMaxRunCount.trim() ? Number(draftMaxRunCount) : null

    return {
      name,
      schedule_type: draftScheduleType,
      status: draftEnabled,
      run_at: runAt,
      interval_minutes: intervalMinutes && intervalMinutes > 0 ? intervalMinutes : null,
      daily_time: dailyTime,
      max_run_count: maxRunCount && maxRunCount > 0 ? maxRunCount : null,
      input_values: Object.keys(draftInputValues).length > 0 ? draftInputValues : null,
    }
  }

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
    return false
  }, [draftDailyTime, draftEnabled, draftInputValues, draftIntervalMinutes, draftMaxRunCount, draftName, draftRunAt, draftScheduleType, draftWorkflowId])

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
      <Card>
        <CardHeader className="space-y-0 border-b border-border/70 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="min-w-0 flex-1 text-base">자동 실행</CardTitle>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Badge variant="outline">{schedules.length}</Badge>
              <Button type="button" size="sm" variant="outline" onClick={openCreateEditor} disabled={workflows.length === 0 || isMutating}>
                <Plus className="h-4 w-4" />
                자동 실행 추가
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {schedules.length === 0 ? (
            <div className="rounded-sm border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
              자동 실행 없음
            </div>
          ) : (
            <div className="space-y-3">
              {schedules.map((schedule) => {
                const workflowName = workflowNameById.get(schedule.graph_workflow_id) ?? `Workflow #${schedule.graph_workflow_id}`
                const reservedCountLabel = schedule.max_run_count ? `최대 ${schedule.max_run_count}회` : '무제한'
                const scheduleTimingLabel = schedule.schedule_type === 'once'
                  ? (schedule.run_at ? formatDateTime(schedule.run_at) : '시각 미설정')
                  : schedule.schedule_type === 'interval'
                    ? `${schedule.interval_minutes ?? '?'}분마다`
                    : `${schedule.daily_time ?? '--:--'} 매일`

                return (
                  <div key={schedule.id} className="rounded-sm border border-border bg-surface-low px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-sm font-medium text-foreground">{schedule.name}</div>
                          <Badge variant={getScheduleStatusVariant(schedule.status)}>{schedule.status}</Badge>
                          <Badge variant="outline">{getScheduleTypeLabel(schedule.schedule_type)}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {workflowName} · {scheduleTimingLabel} · {reservedCountLabel}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          {schedule.next_run_at ? <span>다음 등록 시도 {formatDateTime(schedule.next_run_at)}</span> : null}
                          {schedule.last_enqueued_at ? <span>최근 큐 등록 {formatDateTime(schedule.last_enqueued_at)}</span> : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" size="icon-sm" variant="outline" onClick={() => openEditEditor(schedule)} disabled={isMutating} aria-label="자동 실행 수정" title="자동 실행 수정">
                          <SquarePen className="h-4 w-4" />
                        </Button>
                        {schedule.status === 'active' ? (
                          <Button type="button" size="icon-sm" variant="outline" onClick={() => void onPauseSchedule(schedule.id)} disabled={isMutating} aria-label="자동 실행 일시정지" title="자동 실행 일시정지">
                            <Pause className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button type="button" size="icon-sm" variant="outline" onClick={() => void onResumeSchedule(schedule.id)} disabled={isMutating} aria-label="자동 실행 재개" title="자동 실행 재개">
                            <Play className="h-4 w-4" />
                          </Button>
                        )}
                        <Button type="button" size="icon-sm" variant="outline" onClick={() => void onRunNow(schedule.id)} disabled={isMutating} aria-label="지금 1회 실행" title="지금 1회 실행">
                          <Rocket className="h-4 w-4" />
                        </Button>
                        <Button type="button" size="icon-sm" variant="outline" onClick={() => void onDeleteSchedule(schedule.id)} disabled={isMutating} aria-label="자동 실행 삭제" title="자동 실행 삭제">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {schedule.stop_reason_message ? (
                      <div className="mt-3 rounded-sm border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">중지/정지 사유</span>
                        <span className="ml-2">{schedule.stop_reason_message}</span>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <SettingsModal
        open={editorMode !== null}
        onClose={resetDraft}
        title={editorMode === 'edit' ? '자동 실행 수정' : '자동 실행 추가'}
        widthClassName="max-w-5xl"
        closeOnBack={false}
      >
        <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SettingsField label="대상 워크플로우" className="xl:col-span-2">
              <Select value={draftWorkflowId} onChange={(event) => setDraftWorkflowId(event.target.value)} disabled={editorMode === 'edit' || isMutating}>
                {workflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
                ))}
              </Select>
            </SettingsField>
            <SettingsField label="일정 방식">
              <Select value={draftScheduleType} onChange={(event) => setDraftScheduleType(event.target.value as GraphWorkflowScheduleType)} disabled={isMutating}>
                <option value="once">1회 실행</option>
                <option value="interval">N분마다</option>
                <option value="daily">매일</option>
              </Select>
            </SettingsField>
            <SettingsField label="시작 상태">
              <Select value={draftEnabled} onChange={(event) => setDraftEnabled(event.target.value as 'active' | 'paused')} disabled={isMutating}>
                <option value="active">활성</option>
                <option value="paused">일시정지</option>
              </Select>
            </SettingsField>
            <SettingsField label="이름" className="xl:col-span-2">
              <Input value={draftName} onChange={(event) => setDraftName(event.target.value)} disabled={isMutating} />
            </SettingsField>
            <SettingsField label="최대 예약 횟수">
              <Input type="number" min={1} value={draftMaxRunCount} onChange={(event) => setDraftMaxRunCount(event.target.value)} placeholder="무제한" disabled={isMutating} />
            </SettingsField>
            {draftScheduleType === 'once' ? (
              <SettingsField label="실행 시각">
                <Input type="datetime-local" value={draftRunAt} onChange={(event) => setDraftRunAt(event.target.value)} disabled={isMutating} />
              </SettingsField>
            ) : null}
            {draftScheduleType === 'interval' ? (
              <SettingsField label="반복 간격(분)">
                <Input type="number" min={1} value={draftIntervalMinutes} onChange={(event) => setDraftIntervalMinutes(event.target.value)} disabled={isMutating} />
              </SettingsField>
            ) : null}
            {draftScheduleType === 'daily' ? (
              <SettingsField label="실행 시각">
                <Input type="time" value={draftDailyTime} onChange={(event) => setDraftDailyTime(event.target.value)} disabled={isMutating} />
              </SettingsField>
            ) : null}
          </div>

          {selectedInputDefinitions.length > 0 ? (
            <div className="space-y-3">
              <div className="text-sm font-medium text-foreground">저장 입력값</div>
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
              취소
            </Button>
            <Button type="submit" disabled={isMutating || submitDisabled}>
              {editorMode === 'edit' ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editorMode === 'edit' ? '저장' : '추가'}
            </Button>
          </div>
        </form>
      </SettingsModal>
    </>
  )
}
