import { getUserSettingsDb } from '../database/userSettingsDb'
import { GenerationQueueModel } from '../models/GenerationQueue'
import { GraphExecutionModel } from '../models/GraphExecution'
import { GraphWorkflowModel } from '../models/GraphWorkflow'
import { GraphWorkflowExecutor } from './graphWorkflowExecutor'
import { settingsService } from './settingsService'
import { writeExecutionLog } from './graph-workflow-executor/shared'

type QueuedExecutionJob = {
  executionId: number
  workflowId: number
  inputValues?: Record<string, unknown>
  targetNodeId?: string
  forceRerun?: boolean
  triggerType: 'manual' | 'schedule'
  scheduleId?: number | null
}

type EnqueueExecutionMetadata = {
  triggerType?: 'manual' | 'schedule'
  scheduleId?: number | null
}

type CancelExecutionResult = {
  success: boolean
  status?: 'draft' | 'queued' | 'running' | 'cancelled' | 'completed' | 'failed' | 'not_found'
  message: string
}

type InterruptedExecutionRecoverySummary = {
  failedQueued: number
  failedRunning: number
}

const QUEUED_EXECUTION_RESTART_MESSAGE = 'Backend restarted before this queued graph execution could begin. Re-run is required.'
const RUNNING_EXECUTION_RESTART_MESSAGE = 'Backend restarted while this graph execution was running. Re-run is required.'
const STRANDED_RUNNING_EXECUTION_MESSAGE = 'Execution process is no longer active. Re-run is required.'
const QUEUE_RECHECK_INTERVAL_MS = 5000

function formatExecutionError(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown execution error'
}

/** Manage graph workflow executions through an in-memory background queue. */
export class GraphWorkflowExecutionQueue {
  private static initialized = false
  private static queue: QueuedExecutionJob[] = []
  private static runningJobs = new Map<number, QueuedExecutionJob>()
  private static cancelRequestedExecutionIds = new Set<number>()
  private static processRetryTimer: NodeJS.Timeout | null = null

  /** Apply one conservative startup recovery pass before new executions are queued. */
  static start() {
    if (this.initialized) {
      return false
    }

    const recovery = this.recoverInterruptedExecutions()
    this.initialized = true
    console.log(`🧩 Graph workflow execution queue ready (failed_queued=${recovery.failedQueued}, failed_running=${recovery.failedRunning})`)
    return true
  }

  /** Fail stale queued/running executions after backend restart instead of leaving them stranded. */
  static recoverInterruptedExecutions(): InterruptedExecutionRecoverySummary {
    const db = getUserSettingsDb()

    const recoverTransaction = db.transaction(() => {
      const failedQueued = db.prepare(`
        UPDATE graph_executions
        SET status = 'failed',
            error_message = COALESCE(error_message, ?),
            updated_date = CURRENT_TIMESTAMP,
            completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
        WHERE status = 'queued'
      `).run(QUEUED_EXECUTION_RESTART_MESSAGE).changes

      const failedRunning = db.prepare(`
        UPDATE graph_executions
        SET status = 'failed',
            error_message = COALESCE(error_message, ?),
            updated_date = CURRENT_TIMESTAMP,
            completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
        WHERE status = 'running'
      `).run(RUNNING_EXECUTION_RESTART_MESSAGE).changes

      return {
        failedQueued,
        failedRunning,
      }
    })

    return recoverTransaction()
  }

  /** Create one queued workflow execution row and in-memory queue job. */
  private static createQueuedJob(
    workflow: ReturnType<typeof GraphWorkflowModel.findById> extends infer Workflow ? NonNullable<Workflow> : never,
    inputValues?: Record<string, unknown>,
    targetNodeId?: string,
    forceRerun = false,
    executionMeta?: EnqueueExecutionMetadata,
  ) {
    const triggerType = executionMeta?.triggerType ?? 'manual'
    const executionId = GraphExecutionModel.create({
      graph_workflow_id: workflow.id,
      graph_version: workflow.version,
      status: 'queued',
      trigger_type: triggerType,
      schedule_id: executionMeta?.scheduleId ?? null,
      execution_plan: null,
      started_at: null,
    })

    writeExecutionLog({
      executionId,
      eventType: 'execution_queued',
      message: targetNodeId ? `Node execution queued: ${workflow.name} -> ${targetNodeId}` : `Graph execution queued: ${workflow.name}`,
      details: {
        workflowId: workflow.id,
        version: workflow.version,
        targetNodeId: targetNodeId ?? null,
        forceRerun,
        inputKeys: Object.keys(inputValues ?? {}),
        triggerType,
        scheduleId: executionMeta?.scheduleId ?? null,
      },
    })

    const job = { executionId, workflowId: workflow.id, inputValues, targetNodeId, forceRerun, triggerType, scheduleId: executionMeta?.scheduleId ?? null }
    this.queue.push(job)
    return job
  }

  /** Enqueue a workflow execution and start workers when capacity allows. */
  static enqueue(
    workflowId: number,
    inputValues?: Record<string, unknown>,
    targetNodeId?: string,
    forceRerun = false,
    executionMeta?: EnqueueExecutionMetadata,
  ) {
    const workflow = GraphWorkflowModel.findById(workflowId)
    if (!workflow) {
      throw new Error('Graph workflow not found')
    }

    const job = this.createQueuedJob(workflow, inputValues, targetNodeId, forceRerun, executionMeta)
    this.processQueue()

    return {
      executionId: job.executionId,
      status: 'queued' as const,
    }
  }

  /** Enqueue multiple identical workflow executions and process the queue once. */
  static enqueueMany(
    workflowId: number,
    count: number,
    inputValues?: Record<string, unknown>,
    targetNodeId?: string,
    forceRerun = false,
    executionMeta?: EnqueueExecutionMetadata,
  ) {
    const workflow = GraphWorkflowModel.findById(workflowId)
    if (!workflow) {
      throw new Error('Graph workflow not found')
    }

    const executionIds: number[] = []
    const safeCount = Math.max(0, Math.floor(count))
    for (let index = 0; index < safeCount; index += 1) {
      const job = this.createQueuedJob(workflow, inputValues, targetNodeId, forceRerun, executionMeta)
      executionIds.push(job.executionId)
    }

    if (executionIds.length > 0) {
      this.processQueue()
    }

    return executionIds.map((executionId) => ({ executionId, status: 'queued' as const }))
  }

  /** Request cancellation for a queued or running execution. */
  static cancel(executionId: number): CancelExecutionResult {
    const execution = GraphExecutionModel.findById(executionId)
    if (!execution) {
      return {
        success: false,
        status: 'not_found',
        message: 'Execution not found',
      }
    }

    if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'cancelled') {
      return {
        success: false,
        status: execution.status,
        message: `Execution is already ${execution.status}`,
      }
    }

    const queuedIndex = this.queue.findIndex((job) => job.executionId === executionId)
    if (queuedIndex !== -1) {
      this.queue.splice(queuedIndex, 1)
      GraphExecutionModel.updateStatus(executionId, 'cancelled')
      writeExecutionLog({
        executionId,
        eventType: 'execution_cancelled',
        message: 'Queued execution cancelled before start',
      })
      return {
        success: true,
        status: 'cancelled',
        message: 'Queued execution cancelled',
      }
    }

    if (this.runningJobs.has(executionId)) {
      this.cancelRequestedExecutionIds.add(executionId)
      writeExecutionLog({
        executionId,
        level: 'warn',
        eventType: 'execution_cancel_requested',
        message: 'Cancellation requested for running execution',
      })
      return {
        success: true,
        status: 'running',
        message: 'Cancellation requested',
      }
    }

    if (execution.status === 'running') {
      GraphExecutionModel.updateStatus(executionId, 'failed', STRANDED_RUNNING_EXECUTION_MESSAGE)
      writeExecutionLog({
        executionId,
        level: 'error',
        eventType: 'execution_failed',
        message: STRANDED_RUNNING_EXECUTION_MESSAGE,
      })
      return {
        success: true,
        status: 'failed',
        message: STRANDED_RUNNING_EXECUTION_MESSAGE,
      }
    }

    return {
      success: false,
      status: execution.status,
      message: `Execution is already ${execution.status}`,
    }
  }

  /** Cancel queued executions that belong to one schedule id set. */
  static cancelQueuedByScheduleIds(scheduleIds: number[]) {
    if (scheduleIds.length === 0) {
      return { cancelled: 0, runningCancellationRequested: 0 }
    }

    const scheduleIdSet = new Set(scheduleIds)
    const queuedExecutionIds = this.queue
      .filter((job) => job.scheduleId !== null && job.scheduleId !== undefined && scheduleIdSet.has(job.scheduleId))
      .map((job) => job.executionId)

    let cancelled = 0
    for (const executionId of queuedExecutionIds) {
      const result = this.cancel(executionId)
      if (result.success) {
        cancelled += 1
      }
    }

    let runningCancellationRequested = 0
    for (const runningJob of this.runningJobs.values()) {
      if (runningJob.scheduleId !== null && runningJob.scheduleId !== undefined && scheduleIdSet.has(runningJob.scheduleId)) {
        const result = this.cancel(runningJob.executionId)
        if (result.success) {
          runningCancellationRequested += 1
        }
      }
    }

    return { cancelled, runningCancellationRequested }
  }

  /** Read runtime queue metadata for an execution row. */
  static getExecutionRuntimeState(executionId: number) {
    return this.getExecutionRuntimeStateMap([executionId]).get(executionId) ?? {
      queue_position: null,
      cancel_requested: this.cancelRequestedExecutionIds.has(executionId),
    }
  }

  /** Read runtime queue metadata for an execution set in one queue pass. */
  static getExecutionRuntimeStateMap(executionIds: number[]) {
    const targetIds = new Set(executionIds)
    const runtimeStateById = new Map<number, { queue_position: number | null; cancel_requested: boolean }>()

    for (const executionId of targetIds) {
      runtimeStateById.set(executionId, {
        queue_position: null,
        cancel_requested: this.cancelRequestedExecutionIds.has(executionId),
      })
    }

    if (targetIds.size === 0) {
      return runtimeStateById
    }

    for (let index = 0; index < this.queue.length; index += 1) {
      const job = this.queue[index]
      if (job && targetIds.has(job.executionId)) {
        runtimeStateById.set(job.executionId, {
          queue_position: index + 1,
          cancel_requested: this.cancelRequestedExecutionIds.has(job.executionId),
        })
      }
    }

    return runtimeStateById
  }

  /** Check whether an execution has a pending cancellation request. */
  static isCancellationRequested(executionId: number) {
    return this.cancelRequestedExecutionIds.has(executionId)
  }

  /** Start queued executions while manual and reservation policies allow it. */
  private static processQueue() {
    this.clearProcessRetry()

    let startedAny = false
    while (this.tryStartNextJob()) {
      startedAny = true
    }

    if (!startedAny && this.queue.length > 0) {
      this.scheduleProcessRetry()
    }
  }

  /** Start one dispatchable job, prioritizing manual work over reservation work. */
  private static tryStartNextJob() {
    const manualRunning = this.countRunningJobs('manual')
    if (manualRunning === 0) {
      const manualIndex = this.queue.findIndex((job) => job.triggerType === 'manual')
      if (manualIndex !== -1) {
        const [manualJob] = this.queue.splice(manualIndex, 1)
        if (manualJob) {
          this.startJob(manualJob)
          return true
        }
      }
    }

    const scheduleLimit = this.resolveScheduleConcurrencyLimit()
    if (this.countRunningJobs('schedule') >= scheduleLimit) {
      return false
    }

    const scheduleIndex = this.queue.findIndex((job) => job.triggerType === 'schedule')
    if (scheduleIndex === -1) {
      return false
    }

    const [scheduleJob] = this.queue.splice(scheduleIndex, 1)
    if (!scheduleJob) {
      return false
    }

    this.startJob(scheduleJob)
    return true
  }

  /** Resolve the current reservation concurrency cap without stopping already-running work. */
  private static resolveScheduleConcurrencyLimit() {
    const reservationSettings = settingsService.loadSettings().generationThrottle.reservations
    const configuredLimit = Math.max(1, Math.min(12, Number(reservationSettings.maxConcurrentJobs) || 1))
    const userWorkPresent = this.hasManualGraphWorkPendingOrRunning() || GenerationQueueModel.hasActiveUserSubmittedJobs()

    if (!userWorkPresent) {
      return configuredLimit
    }

    if (reservationSettings.userQueuePolicy === 'hold_until_empty') {
      return 0
    }

    return 1
  }

  /** Treat manual graph executions and user-submitted generation queue jobs as foreground work. */
  private static hasManualGraphWorkPendingOrRunning() {
    if (this.queue.some((job) => job.triggerType === 'manual')) {
      return true
    }

    for (const runningJob of this.runningJobs.values()) {
      if (runningJob.triggerType === 'manual') {
        return true
      }
    }

    return false
  }

  /** Count currently running graph executions by trigger type. */
  private static countRunningJobs(triggerType: QueuedExecutionJob['triggerType']) {
    let count = 0
    for (const runningJob of this.runningJobs.values()) {
      if (runningJob.triggerType === triggerType) {
        count += 1
      }
    }
    return count
  }

  /** Run one claimed execution in the background. */
  private static startJob(job: QueuedExecutionJob) {
    this.runningJobs.set(job.executionId, job)

    void this.runJob(job)
      .catch((error) => {
        console.error('Background graph execution failed:', error)
      })
      .finally(() => {
        this.cancelRequestedExecutionIds.delete(job.executionId)
        this.runningJobs.delete(job.executionId)
        this.processQueue()
      })
  }

  /** Execute one claimed job after moving it to running. */
  private static async runJob(job: QueuedExecutionJob) {
    GraphExecutionModel.updateStatus(job.executionId, 'running')
    try {
      await GraphWorkflowExecutor.execute(job.workflowId, {
        executionId: job.executionId,
        runtimeInputValues: job.inputValues,
        targetNodeId: job.targetNodeId,
        forceRerun: job.forceRerun,
        shouldCancel: () => this.cancelRequestedExecutionIds.has(job.executionId),
      })
    } catch (error) {
      const execution = GraphExecutionModel.findById(job.executionId)
      if (execution?.status === 'queued' || execution?.status === 'running') {
        const errorMessage = formatExecutionError(error)
        GraphExecutionModel.updateStatus(job.executionId, 'failed', errorMessage)
        writeExecutionLog({
          executionId: job.executionId,
          level: 'error',
          eventType: 'execution_failed',
          message: errorMessage,
        })
      }
      throw error
    }
  }

  /** Retry held queued work so reservations resume after foreground queue pressure clears. */
  private static scheduleProcessRetry() {
    if (this.processRetryTimer || this.queue.length === 0) {
      return
    }

    this.processRetryTimer = setTimeout(() => {
      this.processRetryTimer = null
      this.processQueue()
    }, QUEUE_RECHECK_INTERVAL_MS)
  }

  /** Clear the retry timer before an immediate processing pass. */
  private static clearProcessRetry() {
    if (!this.processRetryTimer) {
      return
    }

    clearTimeout(this.processRetryTimer)
    this.processRetryTimer = null
  }
}
