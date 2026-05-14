import type { TranslationInput, TranslationParams } from '../i18n'
import type { GraphExecutionRecord, GraphWorkflowScheduleRecord } from '../lib/api-module-graph'
import { getImageGenerationTabs, parseImageGenerationTab } from '../features/image-generation/image-generation-tabs'
import {
  formatReservationTimestamp,
  getActiveWorkflowReservationScheduleCount,
  getReservationRunSummaryLabel,
  getReservationStatusVariant,
  getReservationTimingLabel,
  getReservationTypeLabel,
  isActiveReservationExecution,
  sortWorkflowReservationSchedules,
} from '../features/image-generation/components/workflow-reservations-ui'

const translationTemplates: Record<string, string> = {
  'image-generation.components.generation.queue.header.widget.run.once': 'Run once',
  'image-generation.components.generation.queue.header.widget.every.n.minutes': 'Every N minutes',
  'image-generation.components.generation.queue.header.widget.daily': 'Daily',
  'image-generation.components.generation.queue.header.widget.time.not.set': 'Time not set',
  'image-generation.components.generation.queue.header.widget.value.min': '{minutes} min',
  'image-generation.components.generation.queue.header.widget.value.daily': 'Daily {time}',
}

function translate(input: TranslationInput, params?: TranslationParams) {
  const template = typeof input === 'string'
    ? translationTemplates[input] ?? input
    : input.en ?? input.ko ?? ''

  return template.replace(/\{([^}]+)\}/g, (match, key: string) => {
    const value = params?.[key]
    return value === undefined || value === null ? match : String(value)
  })
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function makeSchedule(overrides: Partial<GraphWorkflowScheduleRecord> = {}): GraphWorkflowScheduleRecord {
  return {
    id: 1,
    graph_workflow_id: 10,
    name: 'Reservation schedule',
    schedule_type: 'once',
    status: 'active',
    run_at: '2026-05-14T03:00:00.000Z',
    interval_minutes: null,
    daily_time: null,
    max_run_count: null,
    run_enqueue_count: 1,
    failure_policy: 'stop',
    input_values: null,
    confirmed_graph_version: null,
    confirmed_input_signature: null,
    stop_reason_code: null,
    stop_reason_message: null,
    last_execution_id: null,
    next_run_at: null,
    last_enqueued_at: null,
    completed_run_count: 0,
    queued_run_count: 0,
    running_run_count: 0,
    failed_run_count: 0,
    reserved_run_count: 0,
    remaining_run_count: null,
    created_date: '2026-05-14T00:00:00.000Z',
    updated_date: '2026-05-14T00:00:00.000Z',
    ...overrides,
  }
}

function assertImageGenerationTabs() {
  const tabs = getImageGenerationTabs(translate)
  assertEqual(
    tabs.map((tab) => tab.value).join(','),
    'nai,codex,comfyui,workflows,reservations',
    'image generation tabs should keep the established order with reservations last',
  )
  assertEqual(tabs.find((tab) => tab.value === 'reservations')?.label, 'Reservations', 'reservation tab should use the shared translation helper')
  assertEqual(parseImageGenerationTab('nai'), 'nai', 'NAI tab should parse directly')
  assertEqual(parseImageGenerationTab('workflow'), 'workflows', 'legacy singular workflow tab should resolve to workflows')
  assertEqual(parseImageGenerationTab('workflows'), 'workflows', 'workflows tab should parse directly')
  assertEqual(parseImageGenerationTab('reservations'), 'reservations', 'reservation tab should parse directly')
  assertEqual(parseImageGenerationTab(null), 'nai', 'missing tab should fall back to NAI')
  assertEqual(parseImageGenerationTab('unknown'), 'nai', 'unknown tab should fall back to NAI')
}

function assertActiveExecutionDetection() {
  const expectedActiveStatuses: Array<GraphExecutionRecord['status']> = ['queued', 'running']
  const expectedInactiveStatuses: Array<GraphExecutionRecord['status']> = ['draft', 'completed', 'failed', 'cancelled']

  for (const status of expectedActiveStatuses) {
    assert(isActiveReservationExecution(status), `${status} reservation executions should be cancelable active runs`)
  }

  for (const status of expectedInactiveStatuses) {
    assert(!isActiveReservationExecution(status), `${status} reservation executions should be cleanup-only inactive runs`)
  }
}

function assertStatusVariants() {
  assertEqual(getReservationStatusVariant('active'), 'secondary', 'active reservation schedules should be highlighted')
  assertEqual(getReservationStatusVariant('error_stopped'), 'destructive', 'error-stopped reservation schedules should use destructive tone')
  assertEqual(getReservationStatusVariant('overlap_stopped'), 'destructive', 'overlap-stopped reservation schedules should use destructive tone')
  assertEqual(getReservationStatusVariant('paused'), 'outline', 'paused reservation schedules should use neutral outline tone')
  assertEqual(getReservationStatusVariant('completed'), 'outline', 'completed reservation schedules should use neutral outline tone')
}

function assertTypeAndTimingLabels() {
  assertEqual(getReservationTypeLabel('once', translate), 'Run once', 'once schedules should use the run-once label')
  assertEqual(getReservationTypeLabel('interval', translate), 'Every N minutes', 'interval schedules should use the interval label')
  assertEqual(getReservationTypeLabel('daily', translate), 'Daily', 'daily schedules should use the daily label')

  assertEqual(formatReservationTimestamp(null, 'en-US'), null, 'missing reservation timestamps should stay hidden')
  assertEqual(formatReservationTimestamp('not-a-date', 'en-US'), null, 'invalid reservation timestamps should stay hidden')

  const onceSchedule = makeSchedule({ schedule_type: 'once', run_at: '2026-01-02T03:04:00.000Z' })
  const onceTimeLabel = formatReservationTimestamp(onceSchedule.run_at, 'en-US')
  assert(onceTimeLabel !== null, 'valid once schedule run_at should format')
  assertEqual(getReservationTimingLabel(onceSchedule, translate, 'en-US'), onceTimeLabel, 'once schedules should show their run_at timestamp')
  assertEqual(getReservationTimingLabel(makeSchedule({ schedule_type: 'once', run_at: null }), translate, 'en-US'), 'Time not set', 'once schedules without run_at should show the unset label')
  assertEqual(getReservationTimingLabel(makeSchedule({ schedule_type: 'interval', interval_minutes: 15 }), translate, 'en-US'), '15 min', 'interval schedules should show configured minutes')
  assertEqual(getReservationTimingLabel(makeSchedule({ schedule_type: 'interval', interval_minutes: null }), translate, 'en-US'), '? min', 'interval schedules without minutes should keep an explicit placeholder')
  assertEqual(getReservationTimingLabel(makeSchedule({ schedule_type: 'daily', daily_time: '09:30' }), translate, 'en-US'), 'Daily 09:30', 'daily schedules should show configured time')
  assertEqual(getReservationTimingLabel(makeSchedule({ schedule_type: 'daily', daily_time: null }), translate, 'en-US'), 'Daily --:--', 'daily schedules without time should keep an explicit placeholder')
}

function assertRunSummariesAndSorting() {
  assertEqual(getReservationRunSummaryLabel(makeSchedule({ completed_run_count: 3, max_run_count: 10 })), '3/10', 'run summary should show completed and max run counts')
  assertEqual(getReservationRunSummaryLabel(makeSchedule({ completed_run_count: undefined, max_run_count: null })), '0/-', 'run summary should use placeholders for missing counts')

  const activeOld = makeSchedule({ id: 1, status: 'active', next_run_at: '2026-05-14T01:00:00.000Z', updated_date: '2026-05-14T09:00:00.000Z' })
  const activeNew = makeSchedule({ id: 2, status: 'active', next_run_at: '2026-05-14T03:00:00.000Z', updated_date: '2026-05-14T08:00:00.000Z' })
  const pausedNew = makeSchedule({ id: 3, status: 'paused', next_run_at: '2026-05-14T05:00:00.000Z', updated_date: '2026-05-14T07:00:00.000Z' })
  const completedNewestUpdate = makeSchedule({ id: 4, status: 'completed', next_run_at: null, updated_date: '2026-05-14T10:00:00.000Z' })
  const schedules = [pausedNew, activeOld, completedNewestUpdate, activeNew]

  const sortedSchedules = sortWorkflowReservationSchedules(schedules)
  assertEqual(sortedSchedules.map((schedule) => schedule.id).join(','), '2,1,4,3', 'reservation schedules should sort active first, then newest next/update time')
  assertEqual(schedules.map((schedule) => schedule.id).join(','), '3,1,4,2', 'reservation schedule sorting must not mutate callers')
  assertEqual(getActiveWorkflowReservationScheduleCount(sortedSchedules), 2, 'active reservation count should only include active schedules')
}

assertImageGenerationTabs()
assertActiveExecutionDetection()
assertStatusVariants()
assertTypeAndTimingLabels()
assertRunSummariesAndSorting()

console.log('Workflow reservations UI contracts verified.')
