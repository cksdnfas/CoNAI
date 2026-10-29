import { copyChatPageData, type ChatPageData } from '@conai/shared'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageChoice, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useI18n } from '@/i18n'
import {
  cancelGraphExecution,
  cleanupGraphWorkflowEmptyExecutions,
  createGraphWorkflowSchedule,
  deleteGraphWorkflowSchedule,
  pauseGraphWorkflowSchedule,
  resumeGraphWorkflowSchedule,
  runGraphWorkflowScheduleNow,
  updateGraphWorkflowSchedule,
  type GraphExecutionRecord,
  type GraphWorkflowNameRecord,
  type GraphWorkflowScheduleRecord,
} from '@/lib/api-module-graph'
import { isActiveReservationExecution } from './workflow-reservations-ui'

type ReservationsChat = {
  enabled: boolean
  view: 'schedules' | 'executions'
  automationPaused: boolean
  workflows: GraphWorkflowNameRecord[]
  schedules: GraphWorkflowScheduleRecord[]
  executions: GraphExecutionRecord[]
  refresh: () => Promise<unknown>
}

const TYPES = ['once', 'interval', 'daily'] as const
const ENQUEUE_MAX = 100
/** The screen is resent with every request of an API model: rows and ids beyond these stay on the page. */
const WORKFLOW_ROWS = 100
const SCHEDULE_ROWS = 50
const RUN_ROWS = 30
const INPUTS_SHOWN = 300

function storedInputs(value?: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

/** Short saved inputs as they are; longer ones as their keys (inputs that cannot be shown are left out). */
function shownInputs(value?: string | null): ChatPageData {
  try {
    const inputs = copyChatPageData(storedInputs(value))
    return JSON.stringify(inputs).length <= INPUTS_SHOWN ? inputs : { keys: Object.keys(storedInputs(value)).slice(0, 20) }
  } catch { return {} }
}

const text = (value: ChatPageData | undefined) => typeof value === 'string' ? value.trim() : undefined
const number = (value: ChatPageData | undefined) => typeof value === 'number' ? value : undefined

/** Save a reviewed reservation card through the same revision-checked API as the editor. */
export async function saveWorkflowReservationSchedule(args: Record<string, ChatPageData>, schedules: GraphWorkflowScheduleRecord[]) {
  const scheduleId = number(args.scheduleId)
  const existing = scheduleId === undefined ? null : schedules.find((schedule) => schedule.id === scheduleId)
  if (scheduleId !== undefined && !existing) throw new Error('그 자동 실행이 목록에 없어. 화면을 다시 읽어줘.')
  const type = (text(args.type) ?? existing?.schedule_type) as typeof TYPES[number] | undefined
  const name = text(args.name) ?? existing?.name ?? ''
  const workflowId = number(args.workflowId) ?? existing?.graph_workflow_id
  if (!name || !type || workflowId === undefined) throw new Error('새 자동 실행에는 workflowId, name, type이 필요해.')
  if (existing && number(args.workflowId) !== undefined && number(args.workflowId) !== existing.graph_workflow_id) throw new Error('저장된 자동 실행의 워크플로는 바꿀 수 없어. 새로 만들어줘.')
  const runAtText = text(args.runAt) ?? existing?.run_at ?? ''
  const runAt = type === 'once' ? new Date(runAtText) : null
  if (type === 'once' && (!runAtText || Number.isNaN(runAt!.getTime()))) throw new Error('1회 실행에는 runAt(YYYY-MM-DDTHH:mm)이 필요해.')
  const intervalMinutes = number(args.intervalMinutes) ?? existing?.interval_minutes ?? null
  if (type === 'interval' && !(intervalMinutes && intervalMinutes > 0)) throw new Error('반복 실행에는 intervalMinutes가 필요해.')
  const dailyTime = text(args.dailyTime) ?? existing?.daily_time ?? ''
  if (type === 'daily' && !/^\d{2}:\d{2}$/.test(dailyTime)) throw new Error('매일 실행에는 dailyTime(HH:mm)이 필요해.')
  const maxRuns = number(args.maxRuns) ?? (existing?.max_run_count && existing.max_run_count > 0 ? existing.max_run_count : 0)
  let inputValues: Record<string, unknown> | null = existing ? storedInputs(existing.input_values) : {}
  if (text(args.inputValuesJson) !== undefined) {
    try { inputValues = JSON.parse(text(args.inputValuesJson) || '{}') } catch { throw new Error('inputValuesJson은 JSON 객체여야 해.') }
    if (!inputValues || typeof inputValues !== 'object' || Array.isArray(inputValues)) throw new Error('inputValuesJson은 JSON 객체여야 해.')
  }
  const payload = {
    name,
    schedule_type: type,
    ...(typeof args.active === 'boolean'
      ? { status: args.active ? 'active' as const : 'paused' as const }
      : existing ? {} : { status: 'active' as const }),
    run_at: runAt ? runAt.toISOString() : null,
    interval_minutes: type === 'interval' ? intervalMinutes : null,
    daily_time: type === 'daily' ? dailyTime : null,
    max_run_count: maxRuns > 0 ? maxRuns : -1,
    run_enqueue_count: number(args.perRun) ?? existing?.run_enqueue_count ?? 1,
    failure_policy: (text(args.onFailure) ?? existing?.failure_policy ?? 'stop') as 'stop' | 'continue',
    input_values: inputValues && Object.keys(inputValues).length > 0 ? inputValues : null,
  }
  if (existing) {
    if (args.active === true && existing.workflow_version == null) throw new Error('워크플로를 새로 불러와줘.')
    await updateGraphWorkflowSchedule(existing.id, {
      ...payload,
      expected_revision: existing.revision,
      ...(existing.workflow_version != null ? { expected_graph_version: existing.workflow_version } : {}),
    })
  } else {
    await createGraphWorkflowSchedule({ graph_workflow_id: workflowId, ...payload })
  }
}

/**
 * The workflow reservations (예약) screen for a connected chat: the autoruns and their recent runs, with every change
 * (save, pause, resume, run now, delete, cancel or clear runs) as a commit card that calls the same route as its button.
 * The routes record the person who applies the card as the schedule's run-as account.
 */
export function useWorkflowReservationsChatPage({ enabled, view, automationPaused, workflows, schedules, executions, refresh }: ReservationsChat) {
  const { t } = useI18n()
  const workflowIds = workflows.slice(0, WORKFLOW_ROWS).map((workflow) => workflow.id)
  const scheduleIds = schedules.slice(0, SCHEDULE_ROWS).map((schedule) => schedule.id)
  const runIds = executions.slice(0, RUN_ROWS).map((execution) => execution.id)
  const workflowName = new Map(workflows.map((workflow) => [workflow.id, workflow.name]))
  const scheduleTarget = scheduleIds.length ? pageObject({ scheduleId: pageChoice(scheduleIds) }, ['scheduleId']) : null
  const runTargets = runIds.length ? pageObject({ executionIds: pageArray(pageChoice(runIds), 100, 1) }, ['executionIds']) : null

  const actions = [
    ...(workflowIds.length ? [pageAction('workflow.schedule_save', t({ ko: '자동 실행 저장', en: 'Save autorun' }), t({ ko: '새로 만들기: workflowId·name·type. 고치기: scheduleId+바꿀 항목. runAt YYYY-MM-DDTHH:mm, dailyTime HH:mm, maxRuns 0=무제한, inputValuesJson=입력 id별 JSON.', en: 'New: workflowId, name, type. Edit: scheduleId + changes. runAt YYYY-MM-DDTHH:mm, dailyTime HH:mm, maxRuns 0 = unlimited, inputValuesJson = JSON by input id.' }), pageObject({
      ...(scheduleIds.length ? { scheduleId: pageChoice(scheduleIds) } : {}),
      workflowId: pageChoice(workflowIds),
      name: pageText(120),
      type: pageChoice([...TYPES]),
      runAt: pageText(40),
      intervalMinutes: pageNumber(1, 525_600, true),
      dailyTime: pageText(5),
      maxRuns: pageNumber(0, 100_000, true),
      perRun: pageNumber(1, ENQUEUE_MAX, true),
      onFailure: pageChoice(['stop', 'continue']),
      active: { type: 'boolean' },
      inputValuesJson: pageText(8000),
    }), 'save')] : []),
    ...(scheduleTarget ? [
      pageAction('workflow.schedule_pause', t({ ko: '자동 실행 일시정지', en: 'Pause autorun' }), '', scheduleTarget, 'save'),
      pageAction('workflow.schedule_resume', t({ ko: '자동 실행 다시 켜기', en: 'Resume autorun' }), '', scheduleTarget, 'save'),
      pageAction('workflow.schedule_run_now', t({ ko: '자동 실행 바로 실행', en: 'Run autorun now' }), t({ ko: '실행 계정 본인이나 관리자만.', en: 'Run-as account or an administrator only.' }), scheduleTarget, 'save'),
      pageAction('workflow.schedule_delete', t({ ko: '자동 실행 삭제', en: 'Delete autorun' }), '', scheduleTarget, 'save'),
    ] : []),
    ...(runTargets ? [
      pageAction('workflow.run_cancel', t({ ko: '예약 실행 취소', en: 'Cancel reservation runs' }), '', runTargets, 'save'),
      pageAction('workflow.runs_cleanup', t({ ko: '빈 실행 삭제', en: 'Delete empty runs' }), '', runTargets, 'save'),
    ] : []),
  ]

  useChatPageRegistration(enabled ? {
    kind: 'workflow_runner', title: t({ ko: '워크플로 예약', en: 'Workflow reservations' }), resourceId: 'workflow-reservations', priority: 10, fields: [],
    data: {
      view,
      automationPaused,
      workflows: workflows.slice(0, WORKFLOW_ROWS).map((workflow) => ({ id: workflow.id, name: workflow.name })),
      schedules: schedules.slice(0, SCHEDULE_ROWS).map((schedule) => ({
        id: schedule.id, name: schedule.name, workflowId: schedule.graph_workflow_id, workflow: workflowName.get(schedule.graph_workflow_id) ?? null,
        type: schedule.schedule_type, status: schedule.status, revision: schedule.revision, workflowVersion: schedule.workflow_version ?? null,
        ...(schedule.run_at ? { runAt: schedule.run_at } : {}), ...(schedule.interval_minutes ? { intervalMinutes: schedule.interval_minutes } : {}), ...(schedule.daily_time ? { dailyTime: schedule.daily_time } : {}),
        ...(schedule.timezone ? { timezone: schedule.timezone } : {}),
        maxRuns: schedule.max_run_count && schedule.max_run_count > 0 ? schedule.max_run_count : 0, perRun: schedule.run_enqueue_count ?? 1, onFailure: schedule.failure_policy ?? 'stop',
        nextRun: schedule.next_run_at ?? null, runAs: schedule.run_as_account_name ?? (schedule.run_as_account_id === null || schedule.run_as_account_id === undefined ? null : `#${schedule.run_as_account_id}`),
        ...(schedule.stop_reason_message ? { stopReason: schedule.stop_reason_message.slice(0, 120) } : {}),
        runs: Object.fromEntries(Object.entries({ done: schedule.completed_run_count, queued: schedule.queued_run_count, running: schedule.running_run_count, failed: schedule.failed_run_count, remaining: schedule.remaining_run_count }).filter(([, count]) => typeof count === 'number' && count > 0)) as Record<string, number>,
        inputValues: shownInputs(schedule.input_values),
      })),
      runs: executions.slice(0, RUN_ROWS).map((execution) => ({
        id: execution.id, workflowId: execution.graph_workflow_id, status: execution.status, scheduleId: execution.schedule_id ?? null,
        ...(execution.queue_position ? { queuePosition: execution.queue_position } : {}), created: execution.created_date,
        ...(execution.error_message ? { error: execution.error_message.slice(0, 120) } : {}),
      })),
    },
    actions,
    apply: () => {},
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      const scheduleId = number(args.scheduleId)
      const ids = Array.isArray(args.executionIds) ? args.executionIds.filter((value): value is number => typeof value === 'number') : []
      if (id === 'workflow.schedule_save') await saveWorkflowReservationSchedule(args, schedules)
      else if (id === 'workflow.schedule_pause' || id === 'workflow.schedule_resume') {
        const schedule = schedules.find((item) => item.id === scheduleId)
        if (!schedule) throw new Error('그 자동 실행이 목록에 없어. 화면을 다시 읽어줘.')
        if (id === 'workflow.schedule_resume') {
          if (schedule.workflow_version == null) throw new Error('워크플로를 새로 불러와줘.')
          await resumeGraphWorkflowSchedule(schedule.id, { expected_revision: schedule.revision, expected_graph_version: schedule.workflow_version })
        } else {
          await pauseGraphWorkflowSchedule(schedule.id, { expected_revision: schedule.revision })
        }
      }
      else if (id === 'workflow.schedule_run_now') await runGraphWorkflowScheduleNow(scheduleId!)
      else if (id === 'workflow.schedule_delete') await deleteGraphWorkflowSchedule(scheduleId!)
      else if (id === 'workflow.run_cancel') {
        const targets = executions.filter((execution) => ids.includes(execution.id) && isActiveReservationExecution(execution.status))
        if (targets.length === 0) throw new Error('취소할 대기·실행 중 예약 실행이 없어.')
        await Promise.all(targets.map((execution) => cancelGraphExecution(execution.id)))
      } else if (id === 'workflow.runs_cleanup') {
        const targets = executions.filter((execution) => ids.includes(execution.id) && !isActiveReservationExecution(execution.status))
        if (targets.length === 0) throw new Error('지울 끝난 예약 실행이 없어.')
        await cleanupGraphWorkflowEmptyExecutions({ execution_ids: targets.map((execution) => execution.id) })
      } else throw new Error('등록되지 않은 예약 작업이야.')
      await refresh()
    },
  } : null)
}
