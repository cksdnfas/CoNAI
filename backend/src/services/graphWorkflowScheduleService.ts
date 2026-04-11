import { GraphExecutionModel } from '../models/GraphExecution'
import { GraphWorkflowScheduleModel } from '../models/GraphWorkflowSchedule'
import { GraphWorkflowModel } from '../models/GraphWorkflow'
import type {
  GraphExecutionRecord,
  GraphWorkflowScheduleRecord,
  GraphWorkflowScheduleStatus,
} from '../types/moduleGraph'
import { GraphWorkflowExecutionQueue } from './graphWorkflowExecutionQueue'
import { buildRuntimeInputSignature } from './graph-workflow-executor/shared'

const DEFAULT_POLL_INTERVAL_MS = 15_000
const DEFAULT_SCHEDULE_TIMEZONE = 'Asia/Seoul'

function parseInputValues(schedule: GraphWorkflowScheduleRecord) {
  if (!schedule.input_values) {
    return undefined
  }

  return JSON.parse(schedule.input_values) as Record<string, unknown>
}

/** Parse one HH:mm daily schedule string into numeric hour and minute parts. */
function parseDailyTime(dailyTime?: string | null) {
  if (!dailyTime || !/^\d{2}:\d{2}$/.test(dailyTime)) {
    return null
  }

  const [hourText, minuteText] = dailyTime.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null
  }

  return { hour, minute }
}

/** Build the next due timestamp for one schedule after a trigger is consumed. */
function buildNextRunAt(schedule: GraphWorkflowScheduleRecord, now: Date) {
  if (schedule.schedule_type === 'once') {
    return null
  }

  if (schedule.schedule_type === 'interval') {
    const intervalMinutes = schedule.interval_minutes ?? null
    if (!intervalMinutes || intervalMinutes <= 0) {
      return null
    }

    const baseTime = schedule.next_run_at ? new Date(schedule.next_run_at) : now
    return new Date(baseTime.getTime() + intervalMinutes * 60_000).toISOString()
  }

  const parsedDailyTime = parseDailyTime(schedule.daily_time)
  if (!parsedDailyTime) {
    return null
  }

  const next = new Date(now)
  next.setHours(parsedDailyTime.hour, parsedDailyTime.minute, 0, 0)
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1)
  }

  return next.toISOString()
}

/** Count completed, queued, and running executions reserved by one schedule. */
function summarizeScheduleExecutions(executions: GraphExecutionRecord[]) {
  return executions.reduce((acc, execution) => {
    if (execution.status === 'completed') {
      acc.completed += 1
    }
    if (execution.status === 'queued') {
      acc.queued += 1
    }
    if (execution.status === 'running') {
      acc.running += 1
    }
    if (execution.status === 'failed') {
      acc.failed += 1
    }
    return acc
  }, {
    completed: 0,
    queued: 0,
    running: 0,
    failed: 0,
  })
}

/** Manage persisted workflow autorun schedules and feed due work into the existing execution queue. */
export class GraphWorkflowScheduleService {
  private static pollTimer: NodeJS.Timeout | null = null
  private static isPolling = false

  /** Build one stable signature for stored schedule input values. */
  static buildInputSignature(inputValues?: Record<string, unknown> | null) {
    return buildRuntimeInputSignature(inputValues ?? {})
  }

  /** Calculate the first due timestamp for one new or resumed schedule. */
  static buildInitialNextRunAt(params: {
    scheduleType: GraphWorkflowScheduleRecord['schedule_type']
    runAt?: string | null
    intervalMinutes?: number | null
    dailyTime?: string | null
    now?: Date
  }) {
    const now = params.now ?? new Date()

    if (params.scheduleType === 'once') {
      return params.runAt ?? null
    }

    if (params.scheduleType === 'interval') {
      if (!params.intervalMinutes || params.intervalMinutes <= 0) {
        return null
      }
      return new Date(now.getTime() + params.intervalMinutes * 60_000).toISOString()
    }

    const parsedDailyTime = parseDailyTime(params.dailyTime)
    if (!parsedDailyTime) {
      return null
    }

    const next = new Date(now)
    next.setHours(parsedDailyTime.hour, parsedDailyTime.minute, 0, 0)
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1)
    }

    return next.toISOString()
  }

  /** Start the schedule polling loop once per process. */
  static start() {
    if (this.pollTimer) {
      return false
    }

    void this.pollDueSchedules()
    this.pollTimer = setInterval(() => {
      void this.pollDueSchedules()
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

  /** Pause schedules after their workflow changed and clear queued schedule jobs. */
  static pauseSchedulesForWorkflowChange(workflowId: number) {
    const schedules = GraphWorkflowScheduleModel.findByWorkflowId(workflowId)
    const scheduleIds = schedules.map((schedule) => schedule.id)
    for (const schedule of schedules) {
      GraphWorkflowScheduleModel.update(schedule.id, {
        status: 'paused',
        stop_reason_code: 'workflow_changed',
        stop_reason_message: 'Workflow changed and schedule review is required before restart.',
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

  /** Validate one due schedule and enqueue exactly one next execution when allowed. */
  private static async handleDueSchedule(schedule: GraphWorkflowScheduleRecord, now: Date) {
    const workflow = GraphWorkflowModel.findById(schedule.graph_workflow_id)
    if (!workflow) {
      GraphWorkflowScheduleModel.update(schedule.id, {
        status: 'paused',
        stop_reason_code: 'workflow_missing',
        stop_reason_message: 'Linked workflow no longer exists.',
        next_run_at: null,
      })
      return
    }

    if (schedule.confirmed_graph_version !== null && schedule.confirmed_graph_version !== undefined && workflow.version !== schedule.confirmed_graph_version) {
      GraphWorkflowScheduleModel.update(schedule.id, {
        status: 'paused',
        stop_reason_code: 'workflow_changed',
        stop_reason_message: 'Workflow changed and schedule review is required before restart.',
      })
      GraphWorkflowExecutionQueue.cancelQueuedByScheduleIds([schedule.id])
      return
    }

    const existingExecutions = GraphExecutionModel.findByScheduleIds([schedule.id], 500)
    const executionSummary = summarizeScheduleExecutions(existingExecutions)
    const activeOverlapCount = executionSummary.queued + executionSummary.running
    const lastExecution = schedule.last_execution_id ? GraphExecutionModel.findById(schedule.last_execution_id) : null

    if (lastExecution?.status === 'failed') {
      GraphWorkflowScheduleModel.update(schedule.id, {
        status: 'error_stopped',
        stop_reason_code: 'execution_failed',
        stop_reason_message: lastExecution.error_message || 'Scheduled execution failed.',
        next_run_at: null,
      })
      return
    }

    if ((schedule.max_run_count === null || schedule.max_run_count === undefined) && activeOverlapCount > 0) {
      GraphWorkflowScheduleModel.update(schedule.id, {
        status: 'overlap_stopped',
        stop_reason_code: 'overlap_detected',
        stop_reason_message: 'The next scheduled run arrived while a prior run was still queued or running.',
        next_run_at: null,
      })
      return
    }

    const reservedRunCount = executionSummary.completed + executionSummary.queued + executionSummary.running
    if (schedule.max_run_count !== null && schedule.max_run_count !== undefined && reservedRunCount >= schedule.max_run_count) {
      GraphWorkflowScheduleModel.update(schedule.id, {
        status: 'completed',
        stop_reason_code: 'max_run_count_reached',
        stop_reason_message: 'Maximum scheduled run count has been reserved or completed.',
        next_run_at: null,
      })
      return
    }

    const nextRunAt = buildNextRunAt(schedule, now)
    const enqueueResult = GraphWorkflowExecutionQueue.enqueue(
      schedule.graph_workflow_id,
      parseInputValues(schedule),
      undefined,
      false,
      {
        triggerType: 'schedule',
        scheduleId: schedule.id,
      },
    )

    const nextStatus: GraphWorkflowScheduleStatus = schedule.schedule_type === 'once'
      ? 'completed'
      : schedule.max_run_count !== null && schedule.max_run_count !== undefined && reservedRunCount + 1 >= schedule.max_run_count
        ? 'completed'
        : 'active'
    const completionReasonCode = schedule.schedule_type === 'once'
      ? 'one_time_consumed'
      : nextStatus === 'completed'
        ? 'max_run_count_reached'
        : null
    const completionReasonMessage = schedule.schedule_type === 'once'
      ? 'One-time schedule has been consumed.'
      : nextStatus === 'completed'
        ? 'Maximum scheduled run count has been reserved or completed.'
        : null

    GraphWorkflowScheduleModel.update(schedule.id, {
      status: nextStatus,
      timezone: schedule.timezone ?? DEFAULT_SCHEDULE_TIMEZONE,
      last_execution_id: enqueueResult.executionId,
      last_enqueued_at: now.toISOString(),
      next_run_at: nextStatus === 'completed' ? null : nextRunAt,
      stop_reason_code: completionReasonCode,
      stop_reason_message: completionReasonMessage,
    })
  }
}
