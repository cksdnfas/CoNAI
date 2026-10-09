import { GraphExecutionModel } from '../models/GraphExecution'
import { GraphWorkflowScheduleModel } from '../models/GraphWorkflowSchedule'
import { GraphWorkflowModel } from '../models/GraphWorkflow'
import type {
  GraphWorkflowScheduleRecord,
  GraphWorkflowScheduleStatus,
} from '../types/moduleGraph'
import { GraphWorkflowExecutionQueue, RUNNING_EXECUTION_RESTART_MESSAGE } from './graphWorkflowExecutionQueue'
import { buildRuntimeInputSignature } from './graph-workflow-executor/shared'
import { resolveAutomationRunAs } from './automationRunAs'
import { AutomationSwitch } from './automationSwitch'
import { DEFAULT_SCHEDULE_TIMEZONE, followingRunAt, initialRunAt } from './scheduleTiming'

const DEFAULT_POLL_INTERVAL_MS = 15_000

/** Keys a schedule's account must still hold when it runs (the same ones it needed to save the schedule). */
const SCHEDULE_RUN_PERMISSIONS = ['generation.execute']

function parseInputValues(schedule: GraphWorkflowScheduleRecord) {
  if (!schedule.input_values) {
    return undefined
  }

  return JSON.parse(schedule.input_values) as Record<string, unknown>
}

function timingOf(schedule: GraphWorkflowScheduleRecord) {
  return {
    scheduleType: schedule.schedule_type,
    runAt: schedule.run_at,
    intervalMinutes: schedule.interval_minutes,
    dailyTime: schedule.daily_time,
    timezone: schedule.timezone,
  }
}

function normalizeRunEnqueueCount(value?: number | null) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    return 1
  }

  return Math.min(Math.max(parsed, 1), 100)
}

/** Manage persisted workflow autorun schedules and feed due work into the existing execution queue. */
export class GraphWorkflowScheduleService {
  private static pollTimer: NodeJS.Timeout | null = null
  private static isPolling = false
  private static activePoll: Promise<void> | null = null

  /** Build one stable signature for stored schedule input values. */
  static buildInputSignature(inputValues?: Record<string, unknown> | null) {
    return buildRuntimeInputSignature(inputValues ?? {})
  }

  /** Calculate the first due timestamp for one new or resumed schedule (daily times read in its time zone). */
  static buildInitialNextRunAt(params: {
    scheduleType: GraphWorkflowScheduleRecord['schedule_type']
    runAt?: string | null
    intervalMinutes?: number | null
    dailyTime?: string | null
    timezone?: string | null
    now?: Date
  }) {
    return initialRunAt(params, params.now ?? new Date())
  }

  /** Start the schedule polling loop once per process. */
  static start() {
    if (this.pollTimer) {
      return false
    }

    this.requestPoll()
    this.pollTimer = setInterval(() => {
      this.requestPoll()
    }, DEFAULT_POLL_INTERVAL_MS)

    console.log(`⏰ Graph workflow schedule service ready (${DEFAULT_POLL_INTERVAL_MS}ms)`)
    return true
  }

  /** Stop the schedule polling loop. */
  static stop() {
    if (!this.pollTimer) {
      return false
    }

    clearInterval(this.pollTimer)
    this.pollTimer = null
    return true
  }

  /** Stop future polling and wait for the current reservation pass to finish. */
  static async stopAndDrain() {
    const stopped = this.stop()
    await this.activePoll
    return stopped
  }

  private static requestPoll() {
    if (this.activePoll) {
      return
    }

    const poll = this.pollDueSchedules().finally(() => {
      if (this.activePoll === poll) {
        this.activePoll = null
      }
    })
    this.activePoll = poll
  }

  /** Pause schedules after their workflow changed and clear queued schedule jobs. */
  static pauseSchedulesForWorkflowChange(workflowId: number) {
    const schedules = GraphWorkflowScheduleModel.findByWorkflowId(workflowId)
    const scheduleIds = schedules.map((schedule) => schedule.id)
    for (const schedule of schedules) {
      GraphWorkflowScheduleModel.update(schedule.id, {
        status: 'paused',
        stop_reason_code: 'workflow_changed',
        stop_reason_message: '워크플로우가 바뀌어서 다시 시작 전에 검토가 필요해.',
      })
    }

    const queueCleanup = GraphWorkflowExecutionQueue.cancelQueuedByScheduleIds(scheduleIds)
    return {
      pausedScheduleCount: schedules.length,
      ...queueCleanup,
    }
  }

  /** Delete schedules before workflow removal and clear queued schedule jobs. */
  static deleteSchedulesForWorkflowDeletion(workflowId: number) {
    const schedules = GraphWorkflowScheduleModel.findByWorkflowId(workflowId)
    const scheduleIds = schedules.map((schedule) => schedule.id)
    const queueCleanup = GraphWorkflowExecutionQueue.cancelQueuedByScheduleIds(scheduleIds)
    const deletedCount = GraphWorkflowScheduleModel.deleteByWorkflowIds([workflowId])

    return {
      deletedScheduleCount: deletedCount,
      ...queueCleanup,
    }
  }

  /** Poll due schedules and enqueue the work that is now safe to reserve. */
  private static async pollDueSchedules() {
    if (this.isPolling) {
      return
    }

    this.isPolling = true
    try {
      // The stop-everything switch: due schedules wait until it is off again.
      if (AutomationSwitch.isPaused()) return
      const now = new Date()
      const dueSchedules = GraphWorkflowScheduleModel.findDueSchedules(now.toISOString())
      for (const schedule of dueSchedules) {
        await this.handleDueSchedule(schedule, now)
      }
    } catch (error) {
      console.error('Graph workflow schedule polling failed:', error)
    } finally {
      this.isPolling = false
    }
  }

  /** Validate one due schedule and enqueue the configured number of next executions when allowed. */
  private static async handleDueSchedule(schedule: GraphWorkflowScheduleRecord, now: Date) {
    const workflow = GraphWorkflowModel.findById(schedule.graph_workflow_id)
    if (!workflow) {
      GraphWorkflowScheduleModel.update(schedule.id, {
        status: 'paused',
        stop_reason_code: 'workflow_missing',
        stop_reason_message: '연결된 워크플로우가 더 이상 없어.',
        next_run_at: null,
      })
      return
    }

    if (schedule.confirmed_graph_version !== null && schedule.confirmed_graph_version !== undefined && workflow.version !== schedule.confirmed_graph_version) {
      GraphWorkflowScheduleModel.update(schedule.id, {
        status: 'paused',
        stop_reason_code: 'workflow_changed',
        stop_reason_message: '워크플로우가 바뀌어서 다시 시작 전에 검토가 필요해.',
      })
      GraphWorkflowExecutionQueue.cancelQueuedByScheduleIds([schedule.id])
      return
    }

    const executionSummary = GraphExecutionModel.countStatusesByScheduleIds([schedule.id]).get(schedule.id) ?? {
      completed: 0,
      queued: 0,
      running: 0,
      failed: 0,
      cancelled: 0,
    }
    const activeOverlapCount = executionSummary.queued + executionSummary.running
    const reservedRunCount = executionSummary.completed + executionSummary.queued + executionSummary.running
    const lastExecution = schedule.last_execution_id ? GraphExecutionModel.findById(schedule.last_execution_id) : null

    // A run cut off by a server restart is not the workflow failing; the schedule goes on.
    const lastRunFailed = lastExecution?.status === 'failed' && lastExecution.error_message !== RUNNING_EXECUTION_RESTART_MESSAGE
    if (lastRunFailed && (schedule.failure_policy ?? 'stop') !== 'continue') {
      GraphWorkflowScheduleModel.update(schedule.id, {
        status: 'error_stopped',
        stop_reason_code: 'execution_failed',
        stop_reason_message: lastExecution?.error_message || '예약 실행에 실패했어.',
        next_run_at: null,
      })
      return
    }

    if (schedule.max_run_count !== null && schedule.max_run_count !== undefined && reservedRunCount >= schedule.max_run_count) {
      GraphWorkflowScheduleModel.update(schedule.id, {
        status: 'completed',
        stop_reason_code: 'max_run_count_reached',
        stop_reason_message: '최대 예약 횟수에 도달했어.',
        next_run_at: null,
      })
      return
    }

    // Saved before accounts were recorded: keeps running without one, as it always did.
    const runAs = schedule.run_as_account_id === null || schedule.run_as_account_id === undefined
      ? null
      : resolveAutomationRunAs(schedule.run_as_account_id, SCHEDULE_RUN_PERMISSIONS)
    if (runAs && !runAs.ok) {
      GraphWorkflowScheduleModel.update(schedule.id, {
        status: 'paused',
        stop_reason_code: runAs.code,
        stop_reason_message: runAs.message,
        next_run_at: null,
      })
      return
    }

    if (schedule.schedule_type !== 'once' && activeOverlapCount > 0) {
      const deferredNextRunAt = GraphWorkflowScheduleService.buildInitialNextRunAt({ ...timingOf(schedule), now })

      GraphWorkflowScheduleModel.update(schedule.id, {
        status: 'active',
        next_run_at: deferredNextRunAt,
        stop_reason_code: null,
        stop_reason_message: null,
      })
      return
    }

    const nextRunAt = followingRunAt(timingOf(schedule), schedule.next_run_at, now)
    const requestedEnqueueCount = normalizeRunEnqueueCount(schedule.run_enqueue_count)
    const remainingRunCount = schedule.max_run_count !== null && schedule.max_run_count !== undefined
      ? Math.max(0, schedule.max_run_count - reservedRunCount)
      : requestedEnqueueCount
    const allowedEnqueueCount = Math.min(requestedEnqueueCount, remainingRunCount)
    const inputValues = parseInputValues(schedule)
    const executionIds = GraphWorkflowExecutionQueue.enqueueMany(
      schedule.graph_workflow_id,
      allowedEnqueueCount,
      inputValues,
      undefined,
      false,
      {
        triggerType: 'schedule',
        scheduleId: schedule.id,
        requestedByAccountId: runAs?.ok ? runAs.requester.accountId : null,
      },
    ).map((enqueueResult) => enqueueResult.executionId)

    const nextStatus: GraphWorkflowScheduleStatus = schedule.schedule_type === 'once'
      ? 'completed'
      : schedule.max_run_count !== null && schedule.max_run_count !== undefined && reservedRunCount + executionIds.length >= schedule.max_run_count
        ? 'completed'
        : 'active'
    const completionReasonCode = schedule.schedule_type === 'once'
      ? 'one_time_consumed'
      : nextStatus === 'completed'
        ? 'max_run_count_reached'
        : null
    const completionReasonMessage = schedule.schedule_type === 'once'
      ? '1회 실행 예약이 이미 사용됐어.'
      : nextStatus === 'completed'
        ? '최대 예약 횟수에 도달했어.'
        : null

    GraphWorkflowScheduleModel.update(schedule.id, {
      status: nextStatus,
      timezone: schedule.timezone ?? DEFAULT_SCHEDULE_TIMEZONE,
      last_execution_id: executionIds.at(-1) ?? schedule.last_execution_id ?? null,
      last_enqueued_at: executionIds.length > 0 ? now.toISOString() : schedule.last_enqueued_at ?? null,
      next_run_at: nextStatus === 'completed' ? null : nextRunAt,
      stop_reason_code: completionReasonCode,
      stop_reason_message: completionReasonMessage,
    })
  }
}
