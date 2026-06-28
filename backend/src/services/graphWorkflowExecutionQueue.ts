import { getUserSettingsDb } from '../database/userSettingsDb'
import { ComfyUIServerModel } from '../models/ComfyUIServer'
import { GenerationQueueModel } from '../models/GenerationQueue'
import { GraphExecutionModel } from '../models/GraphExecution'
import { GraphWorkflowModel } from '../models/GraphWorkflow'
import { ModuleDefinitionModel } from '../models/ModuleDefinition'
import { GraphWorkflowExecutor } from './graphWorkflowExecutor'
import { settingsService } from './settingsService'
import { getGenerationQueueServerCapacity } from './generationQueueRouting'
import { parseGraphWorkflowRecord, parseModuleDefinition, writeExecutionLog, type ParsedModuleDefinition } from './graph-workflow-executor/shared'
import { encodeQueuedExecutionMetadata, parseQueuedExecutionMetadata } from './graphWorkflowExecutionQueueMetadata'

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
  queuedBacklog: number
  failedRunning: number
}

type StartupRecoverySnapshot = InterruptedExecutionRecoverySummary & {
  recoveredAt: string
}

type ReservationLane = 'novelai' | 'codex' | 'comfyui' | 'other'

const RUNNING_EXECUTION_RESTART_MESSAGE = 'Backend restarted while this graph execution was running. Re-run is required.'
const STRANDED_RUNNING_EXECUTION_MESSAGE = 'Execution process is no longer active. Re-run is required.'
const QUEUE_RECHECK_INTERVAL_MS = 5000
const SCHEDULE_DISPATCH_SCAN_LIMIT = 200

function formatExecutionError(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown execution error'
}

function buildQueuedJobFromExecution(execution: NonNullable<ReturnType<typeof GraphExecutionModel.findById>>): QueuedExecutionJob {
  const metadata = parseQueuedExecutionMetadata(execution.execution_plan)
  return {
    executionId: execution.id,
    workflowId: execution.graph_workflow_id,
    inputValues: metadata.inputValues,
    targetNodeId: metadata.targetNodeId,
    forceRerun: metadata.forceRerun,
    triggerType: execution.trigger_type === 'schedule' ? 'schedule' : 'manual',
    scheduleId: execution.schedule_id ?? null,
  }
}

function getSystemOperationKey(moduleDefinition: Pick<ParsedModuleDefinition, 'internal_fixed_values' | 'template_defaults'>) {
  if (typeof moduleDefinition.internal_fixed_values?.operation_key === 'string') {
    return moduleDefinition.internal_fixed_values.operation_key
  }

  if (typeof moduleDefinition.template_defaults?.operation_key === 'string') {
    return moduleDefinition.template_defaults.operation_key
  }

  return null
}

function addReservationLaneForModule(lanes: Set<ReservationLane>, moduleDefinition: ParsedModuleDefinition) {
  if (moduleDefinition.engine_type === 'nai') {
    lanes.add('novelai')
    return
  }

  if (moduleDefinition.engine_type === 'codex') {
    lanes.add('codex')
    return
  }

  if (moduleDefinition.engine_type === 'comfyui') {
    lanes.add('comfyui')
    return
  }

  if (moduleDefinition.engine_type !== 'system') {
    return
  }

  const operationKey = getSystemOperationKey(moduleDefinition)
  if (operationKey === 'system.generate_image_nai') {
    lanes.add('novelai')
  } else if (operationKey === 'system.generate_image_codex') {
    lanes.add('codex')
  }
}

function collectExecutionNodeIds(graph: ReturnType<typeof parseGraphWorkflowRecord>['graph'], targetNodeId?: string) {
  const enabledNodeIds = new Set(graph.nodes.filter((node) => node.disabled !== true).map((node) => node.id))
  if (!targetNodeId || !enabledNodeIds.has(targetNodeId)) {
    return enabledNodeIds
  }

  const incomingByNodeId = new Map<string, string[]>()
  for (const edge of graph.edges) {
    if (!enabledNodeIds.has(edge.source_node_id) || !enabledNodeIds.has(edge.target_node_id)) {
      continue
    }
    const incoming = incomingByNodeId.get(edge.target_node_id) ?? []
    incoming.push(edge.source_node_id)
    incomingByNodeId.set(edge.target_node_id, incoming)
  }

  const orderedNodeIds = new Set<string>()
  const pendingNodeIds = [targetNodeId]
  while (pendingNodeIds.length > 0) {
    const nodeId = pendingNodeIds.pop() as string
    if (orderedNodeIds.has(nodeId)) {
      continue
    }
    orderedNodeIds.add(nodeId)
    pendingNodeIds.push(...(incomingByNodeId.get(nodeId) ?? []))
  }
  return orderedNodeIds
}

/** Manage graph workflow executions through a DB-backed cold backlog and a small in-process running set. */
export class GraphWorkflowExecutionQueue {
  private static initialized = false
  private static runningJobs = new Map<number, QueuedExecutionJob>()
  private static cancelRequestedExecutionIds = new Set<number>()
  private static processRetryTimer: NodeJS.Timeout | null = null
  private static lastStartupRecovery: StartupRecoverySnapshot | null = null

  /** Apply one conservative startup recovery pass before new executions are queued. */
  static start() {
    if (this.initialized) {
      return false
    }

    const recovery = this.recoverInterruptedExecutions()
    this.lastStartupRecovery = {
      ...recovery,
      recoveredAt: new Date().toISOString(),
    }
    this.initialized = true
    console.log(`🧩 Graph workflow execution queue ready (queued_backlog=${recovery.queuedBacklog}, failed_running=${recovery.failedRunning})`)
    this.processQueue()
    return true
  }

  /** Keep queued backlog durable while failing only work that was actively running during restart. */
  static recoverInterruptedExecutions(): InterruptedExecutionRecoverySummary {
    const db = getUserSettingsDb()

    const recoverTransaction = db.transaction(() => {
      const queuedBacklog = db.prepare(`
        SELECT COUNT(*) as total
        FROM graph_executions
        WHERE status = 'queued'
      `).get() as { total: number } | undefined

      const failedRunning = db.prepare(`
        UPDATE graph_executions
        SET status = 'failed',
            error_message = COALESCE(error_message, ?),
            updated_date = CURRENT_TIMESTAMP,
            completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
        WHERE status = 'running'
      `).run(RUNNING_EXECUTION_RESTART_MESSAGE).changes

      return {
        queuedBacklog: queuedBacklog?.total ?? 0,
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
    const job = { executionId: 0, workflowId: workflow.id, inputValues, targetNodeId, forceRerun, triggerType, scheduleId: executionMeta?.scheduleId ?? null }
    const executionId = GraphExecutionModel.create({
      graph_workflow_id: workflow.id,
      graph_version: workflow.version,
      status: 'queued',
      trigger_type: triggerType,
      schedule_id: executionMeta?.scheduleId ?? null,
      execution_plan: encodeQueuedExecutionMetadata(job),
      started_at: null,
    })
    job.executionId = executionId

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

    if (execution.status === 'queued') {
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

    const cancelled = GraphExecutionModel.cancelQueuedByScheduleIds(scheduleIds)
    const scheduleIdSet = new Set(scheduleIds)

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

    const queuedPositions = GraphExecutionModel.findQueuedPositions(Array.from(targetIds))
    for (const [executionId, queuePosition] of queuedPositions) {
      runtimeStateById.set(executionId, {
        queue_position: queuePosition,
        cancel_requested: this.cancelRequestedExecutionIds.has(executionId),
      })
    }

    return runtimeStateById
  }

  /** Return in-process queue state that complements DB-backed execution counts. */
  static getWorkflowRuntimeQueueState(workflowId: number) {
    let inProcessRunningCount = 0
    let cancellationRequestedCount = 0

    for (const runningJob of this.runningJobs.values()) {
      if (runningJob.workflowId !== workflowId) {
        continue
      }

      inProcessRunningCount += 1
      if (this.cancelRequestedExecutionIds.has(runningJob.executionId)) {
        cancellationRequestedCount += 1
      }
    }

    return {
      in_process_running_count: inProcessRunningCount,
      retry_timer_pending: Boolean(this.processRetryTimer),
      queue_recheck_interval_ms: QUEUE_RECHECK_INTERVAL_MS,
      schedule_concurrency_limit: this.resolveScheduleConcurrencyLimit(),
      cancellation_requested_count: cancellationRequestedCount,
      last_startup_recovery: this.lastStartupRecovery,
    }
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

    if (!startedAny && GraphExecutionModel.hasQueued()) {
      this.scheduleProcessRetry()
    }
  }

  /** Start one dispatchable job, prioritizing manual work over reservation work. */
  private static tryStartNextJob() {
    const manualRunning = this.countRunningJobs('manual')
    if (manualRunning === 0) {
      const manualExecution = GraphExecutionModel.claimNextQueued('manual')
      if (manualExecution) {
        this.startJob(buildQueuedJobFromExecution(manualExecution))
        return true
      }
    }

    const scheduleLimit = this.resolveScheduleConcurrencyLimit()
    if (this.countRunningJobs('schedule') >= scheduleLimit) {
      return false
    }

    const scheduleExecution = this.claimNextDispatchableScheduleExecution(scheduleLimit)
    if (!scheduleExecution) {
      return false
    }

    this.startJob(buildQueuedJobFromExecution(scheduleExecution))
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

  /** Claim the oldest queued reservation whose generation lane still has capacity. */
  private static claimNextDispatchableScheduleExecution(scheduleLimit: number) {
    if (scheduleLimit <= 0) {
      return null
    }

    const queuedExecutions = GraphExecutionModel.findQueuedByTriggerType('schedule', SCHEDULE_DISPATCH_SCAN_LIMIT)
    for (const execution of queuedExecutions) {
      const job = buildQueuedJobFromExecution(execution)
      if (!this.canDispatchScheduleJob(job, scheduleLimit)) {
        continue
      }

      const claimed = GraphExecutionModel.claimQueuedById(execution.id)
      if (claimed) {
        return claimed
      }
    }

    return null
  }

  /** Check lane occupancy before a reservation run starts waiting on the generation queue. */
  private static canDispatchScheduleJob(job: QueuedExecutionJob, scheduleLimit: number) {
    if (this.countRunningJobs('schedule') >= scheduleLimit) {
      return false
    }

    for (const lane of this.resolveReservationLanesForJob(job)) {
      const laneLimit = this.resolveReservationLaneLimit(lane)
      if (laneLimit !== null && this.countRunningScheduleLane(lane) >= laneLimit) {
        return false
      }
    }

    return true
  }

  private static resolveReservationLaneLimit(lane: ReservationLane) {
    const generationThrottle = settingsService.loadSettings().generationThrottle
    if (lane === 'novelai') {
      return Math.max(1, generationThrottle.novelai.maxConcurrentJobs)
    }
    if (lane === 'codex') {
      return Math.max(1, generationThrottle.codex.maxConcurrentJobs)
    }
    if (lane === 'comfyui') {
      const activeServers = ComfyUIServerModel.findActiveServers()
      if (activeServers.length === 0) {
        return 1
      }
      return activeServers.reduce((sum, server) => sum + getGenerationQueueServerCapacity(server), 0)
    }
    return null
  }

  private static countRunningScheduleLane(lane: ReservationLane) {
    let count = 0
    for (const runningJob of this.runningJobs.values()) {
      if (runningJob.triggerType !== 'schedule') {
        continue
      }
      if (this.resolveReservationLanesForJob(runningJob).has(lane)) {
        count += 1
      }
    }
    return count
  }

  private static resolveReservationLanesForJob(job: QueuedExecutionJob) {
    const lanes = new Set<ReservationLane>()
    const workflowRecord = GraphWorkflowModel.findById(job.workflowId)
    if (!workflowRecord) {
      lanes.add('other')
      return lanes
    }

    try {
      const workflow = parseGraphWorkflowRecord(workflowRecord)
      const executableNodeIds = collectExecutionNodeIds(workflow.graph, job.targetNodeId)
      for (const node of workflow.graph.nodes) {
        if (!executableNodeIds.has(node.id)) {
          continue
        }

        const moduleRecord = ModuleDefinitionModel.findById(node.module_id)
        if (!moduleRecord) {
          continue
        }
        addReservationLaneForModule(lanes, parseModuleDefinition(moduleRecord))
      }
    } catch (error) {
      console.warn(`Could not resolve reservation generation lanes for workflow ${job.workflowId}:`, formatExecutionError(error))
    }

    if (lanes.size === 0) {
      lanes.add('other')
    }

    return lanes
  }

  /** Treat manual graph executions and user-submitted generation queue jobs as foreground work. */
  private static hasManualGraphWorkPendingOrRunning() {
    if (GraphExecutionModel.hasQueued('manual')) {
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
    if (this.processRetryTimer || !GraphExecutionModel.hasQueued()) {
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
