import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pause, Play, Plus, Rocket, SquarePen, Trash2 } from 'lucide-react'
import { FieldTabs, FramedField } from '@/components/common/field-tabs'
import { ScheduleField, toDateTimeLocal, type ScheduleValue } from '@/components/common/schedule-field'
import { EditorFooter } from '@/components/ui/editor-footer'
import { EditorGroup } from '@/components/ui/editor-group'
import { Input } from '@/components/ui/input'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Modal } from '@/components/ui/modal'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { useI18n } from '@/i18n'
import { getGraphWorkflow } from '@/lib/api-module-graph'
import type {
  GraphWorkflowNameRecord,
  GraphWorkflowScheduleFailurePolicy,
  GraphWorkflowScheduleRecord,
  GraphWorkflowScheduleType,
} from '@/lib/api-module-graph'
import { WorkflowInputFields } from './workflow-input-fields'
import { toWorkflowImageValue } from '../module-graph-image-values'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { EmptyState } from '@/components/ui/empty-state'
import { WorkflowPicker } from './workflow-picker'
import { WorkflowScheduleRow } from './workflow-schedule-row'

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

type Draft = {
  workflowId: string
  name: string
  schedule: ScheduleValue
  active: boolean
  failurePolicy: GraphWorkflowScheduleFailurePolicy
  enqueueCount: number
  inputValues: Record<string, unknown>
}

const ENQUEUE_MAX = 100

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

function newDraft(workflowId: string): Draft {
  return {
    workflowId,
    name: '',
    schedule: { type: 'once', runAt: toDateTimeLocal(null), intervalMinutes: 60, dailyTime: '09:00', maxRuns: null },
    active: true,
    failurePolicy: 'stop',
    enqueueCount: 1,
    inputValues: {},
  }
}

function draftOf(schedule: GraphWorkflowScheduleRecord): Draft {
  return {
    workflowId: String(schedule.graph_workflow_id),
    name: schedule.name,
    schedule: {
      type: schedule.schedule_type,
      runAt: schedule.run_at ? toDateTimeLocal(schedule.run_at) : '',
      intervalMinutes: schedule.interval_minutes ?? 60,
      dailyTime: schedule.daily_time || '09:00',
      // -1 and an unset limit both run without end.
      maxRuns: schedule.max_run_count && schedule.max_run_count > 0 ? schedule.max_run_count : null,
    },
    active: schedule.status === 'active',
    failurePolicy: schedule.failure_policy === 'continue' ? 'continue' : 'stop',
    enqueueCount: schedule.run_enqueue_count ?? 1,
    inputValues: parseStoredInputValues(schedule.input_values),
  }
}

/** The payload a draft saves, or null while it is missing something. */
function payloadOf(draft: Draft): ScheduleMutationPayload | null {
  const name = draft.name.trim()
  const { schedule } = draft
  const runAt = schedule.type === 'once' && schedule.runAt ? new Date(schedule.runAt) : null
  if (!name || !Number.isFinite(Number(draft.workflowId)) || !draft.workflowId) return null
  if (schedule.type === 'once' && (!runAt || Number.isNaN(runAt.getTime()))) return null
  if (schedule.type === 'interval' && !(schedule.intervalMinutes > 0)) return null
  if (schedule.type === 'daily' && !/^\d{2}:\d{2}$/.test(schedule.dailyTime)) return null
  if (draft.enqueueCount < 1 || draft.enqueueCount > ENQUEUE_MAX) return null
  return {
    name,
    schedule_type: schedule.type,
    status: draft.active ? 'active' : 'paused',
    run_at: runAt ? runAt.toISOString() : null,
    interval_minutes: schedule.type === 'interval' ? schedule.intervalMinutes : null,
    daily_time: schedule.type === 'daily' ? schedule.dailyTime : null,
    max_run_count: schedule.maxRuns ?? -1,
    run_enqueue_count: Math.floor(draft.enqueueCount),
    failure_policy: draft.failurePolicy,
    input_values: Object.keys(draft.inputValues).length > 0 ? draft.inputValues : null,
  }
}

/**
 * Render the workflow autorun list and its editor inside the reservations page. `toolbar` (the page's view tabs and
 * refresh) leads the header row; the add button ends it.
 */
export function ModuleWorkflowSchedulesPanel({
  toolbar,
  covers,
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
  toolbar?: ReactNode
  /** Workflow id → its newest library image. */
  covers: Record<string, string>
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
  const { t, formatNumber } = useI18n()
  const [editorMode, setEditorMode] = useState<'create' | 'edit' | null>(null)
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft>(() => newDraft(''))
  /** The draft as the editor opened, to tell unsaved edits (null until the opened values have rendered). */
  const [openedSnapshot, setOpenedSnapshot] = useState<string | null>(null)
  const draftSnapshot = JSON.stringify(draft)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }))

  // WF-1: 예약 목록 응답에는 그래프 문서가 없다. 편집기를 열 때 선택한 워크플로우만 by-id 로 받아
  // 노출 입력 정의를 구성한다(모듈그래프 페이지 상세 쿼리와 키가 같아 캐시를 함께 쓴다).
  const draftWorkflowNumericId = Number(draft.workflowId)
  const hasDraftWorkflowId = Number.isInteger(draftWorkflowNumericId) && draftWorkflowNumericId > 0
  const selectedWorkflowDetailQuery = useQuery({
    queryKey: ['module-graph-workflow-detail', hasDraftWorkflowId ? draftWorkflowNumericId : null],
    queryFn: () => getGraphWorkflow(draftWorkflowNumericId),
    enabled: editorMode !== null && hasDraftWorkflowId,
    staleTime: 30_000,
  })
  const selectedInputDefinitions = selectedWorkflowDetailQuery.data?.graph.metadata?.exposed_inputs ?? []

  // How many autoruns each workflow already has (a line under it in the picker).
  const scheduleCountByWorkflow = useMemo(() => {
    const counts = new Map<number, number>()
    for (const schedule of schedules) counts.set(schedule.graph_workflow_id, (counts.get(schedule.graph_workflow_id) ?? 0) + 1)
    return counts
  }, [schedules])
  const workflowDetail = (workflowId: number) => {
    const count = scheduleCountByWorkflow.get(workflowId) ?? 0
    return count > 0 ? t({ ko: '자동 실행 {count}개', en: '{count} autoruns' }, { count: formatNumber(count) }) : undefined
  }

  const closeEditor = () => {
    setEditorMode(null)
    setEditingScheduleId(null)
    setOpenedSnapshot(null)
  }

  useEffect(() => {
    if (editorMode !== null && openedSnapshot === null) {
      setOpenedSnapshot(draftSnapshot)
    }
  }, [draftSnapshot, editorMode, openedSnapshot])

  const openCreateEditor = () => {
    setDraft(newDraft(workflows[0] ? String(workflows[0].id) : ''))
    setEditingScheduleId(null)
    setOpenedSnapshot(null)
    setEditorMode('create')
  }

  const openEditEditor = (schedule: GraphWorkflowScheduleRecord) => {
    setDraft(draftOf(schedule))
    setEditingScheduleId(schedule.id)
    setOpenedSnapshot(null)
    setEditorMode('edit')
  }

  const payload = useMemo(() => payloadOf(draft), [draft])

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (!payload) {
      return
    }

    if (editorMode === 'edit' && editingScheduleId !== null) {
      await onUpdateSchedule(editingScheduleId, payload)
    } else {
      await onCreateSchedule({
        graph_workflow_id: Number(draft.workflowId),
        ...payload,
      })
    }

    closeEditor()
  }

  const draftDirty = editorMode !== null && openedSnapshot !== null && draftSnapshot !== openedSnapshot
  const canManage = canExecuteGeneration && canUpdateWorkflows
  const canSaveDraft = canManage && !isMutating && payload !== null && (draftDirty || editorMode === 'create')

  return (
    <>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          <span className="flex-1" />
          <IconButton size="icon-sm" variant="secondary" onClick={openCreateEditor} disabled={!canManage || workflows.length === 0 || isMutating} label={t({ ko: '자동 실행 추가', en: 'Add autorun' })}>
            <Plus />
          </IconButton>
        </div>
        {schedules.length === 0 ? (
          <EmptyState title={t({ ko: '자동 실행 없음', en: 'No autoruns' })} />
        ) : (
          <div className="border-t border-line">
            {schedules.map((schedule) => (
              <WorkflowScheduleRow
                key={schedule.id}
                schedule={schedule}
                workflowName={workflowNameById.get(schedule.graph_workflow_id) ?? t({ ko: '워크플로우 #{id}', en: 'Workflow #{id}' }, { id: schedule.graph_workflow_id })}
                cover={covers[schedule.graph_workflow_id]}
                actions={<>
                  <IconButton size="icon-sm" variant="ghost" onClick={() => openEditEditor(schedule)} disabled={!canManage || isMutating} label={t({ ko: '자동 실행 수정', en: 'Edit autorun' })}>
                    <SquarePen />
                  </IconButton>
                  {schedule.status === 'active' ? (
                    <IconButton size="icon-sm" variant="ghost" onClick={() => void onPauseSchedule(schedule.id)} disabled={!canExecuteGeneration || isMutating} label={t({ ko: '자동 실행 일시정지', en: 'Pause autorun' })}>
                      <Pause />
                    </IconButton>
                  ) : (
                    <IconButton size="icon-sm" variant="ghost" onClick={() => void onResumeSchedule(schedule.id)} disabled={!canExecuteGeneration || isMutating} label={t({ ko: '자동 실행 재개', en: 'Resume autorun' })}>
                      <Play />
                    </IconButton>
                  )}
                  <IconButton size="icon-sm" variant="ghost" onClick={() => void onRunNow(schedule.id)} disabled={!canExecuteGeneration || isMutating} label={t({ ko: '지금 1회 실행', en: 'Run once now' })}>
                    <Rocket />
                  </IconButton>
                  <IconButton size="icon-sm" variant="ghost" onClick={() => void onDeleteSchedule(schedule.id)} disabled={!canUpdateWorkflows || isMutating} label={t({ ko: '자동 실행 삭제', en: 'Delete autorun' })}>
                    <Trash2 />
                  </IconButton>
                </>}
              />
            ))}
          </div>
        )}
      </div>

      <Modal
        open={editorMode !== null}
        onClose={closeEditor}
        title={editorMode === 'edit' ? t({ ko: '자동 실행 수정', en: 'Edit autorun' }) : t({ ko: '자동 실행 추가', en: 'Add autorun' })}
        size="normal"
        height="tall"
        dirty={draftDirty}
        onSave={canSaveDraft ? () => void handleSubmit() : undefined}
      >
        <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
          <Field label={t({ ko: '이름', en: 'Name' })}>
            <Input variant="settings" value={draft.name} onChange={(event) => set('name', event.target.value)} disabled={isMutating} />
          </Field>
          <FramedField label={t({ ko: '워크플로우', en: 'Workflow' })}>
            <WorkflowPicker
              workflows={workflows}
              covers={covers}
              value={draft.workflowId}
              onChange={(workflowId) => setDraft((current) => ({ ...current, workflowId, inputValues: {} }))}
              disabled={editorMode === 'edit' || isMutating}
              detailOf={workflowDetail}
            />
          </FramedField>
          <ScheduleField
            value={draft.schedule}
            disabled={isMutating}
            onChange={(patch) => setDraft((current) => ({ ...current, schedule: { ...current.schedule, ...patch } }))}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t({ ko: '한 번에 큐 등록', en: 'Queued per run' })}>
              <NumberStepperInput variant="settings" min={1} max={ENQUEUE_MAX} value={draft.enqueueCount} onValueCommit={(value) => set('enqueueCount', Math.max(1, Math.floor(Number(value)) || 1))} disabled={isMutating} />
            </Field>
            <FramedField label={t({ ko: '실패하면', en: 'On failure' })}>
              <FieldTabs
                bare
                value={draft.failurePolicy}
                onChange={(value) => set('failurePolicy', value)}
                disabled={isMutating}
                ariaLabel={t({ ko: '실패 처리', en: 'Failure handling' })}
                items={[
                  { value: 'stop', label: t({ ko: '멈추기', en: 'Stop' }) },
                  { value: 'continue', label: t({ ko: '계속', en: 'Continue' }) },
                ]}
              />
            </FramedField>
          </div>

          <div className="border-t border-line">
            <SettingsSwitchRow
              label={t({ ko: '활성', en: 'Active' })}
              checked={draft.active}
              disabled={isMutating}
              onCheckedChange={(checked) => set('active', checked)}
            />
          </div>

          {selectedInputDefinitions.length > 0 ? (
            <EditorGroup label={t({ ko: '저장 입력값', en: 'Saved inputs' })}>
              <WorkflowInputFields
                inputDefinitions={selectedInputDefinitions}
                inputValues={draft.inputValues}
                onInputValueChange={(inputId, value) => setDraft((current) => ({ ...current, inputValues: { ...current.inputValues, [inputId]: value } }))}
                onInputValueClear={(inputId) => setDraft((current) => {
                  const next = { ...current.inputValues }
                  delete next[inputId]
                  return { ...current, inputValues: next }
                })}
                onInputImageChange={async (inputId: string, image?: SelectedImageDraft) => {
                  // A library ref when the image can go into the library; the inline image still works if it cannot.
                  const value = image ? await toWorkflowImageValue(image).catch(() => image.dataUrl) : undefined
                  setDraft((current) => {
                    const next = { ...current.inputValues }
                    if (value === undefined) {
                      delete next[inputId]
                    } else {
                      next[inputId] = value
                    }
                    return { ...current, inputValues: next }
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
