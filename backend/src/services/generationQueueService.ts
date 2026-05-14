import { getUserSettingsDb } from '../database/userSettingsDb'
import { WorkflowModel } from '../models/Workflow'
import { GenerationQueueModel } from '../models/GenerationQueue'
import { ComfyUIServerModel } from '../models/ComfyUIServer'
import { createComfyUIService, getComfyUIServerRuntimeStatuses } from './comfyuiService'
import { getGenerationQueueServerCapacity, isGenerationQueueComfyJobCompatibleWithServer } from './generationQueueRouting'
import { settingsService } from './settingsService'
import { updateQueueRequestDebugMeta } from './generation-queue/queueDebugMeta'
import { executeGenerationQueueJob, isGenerationQueueCancellationError } from './generation-queue/queueJobExecutors'
import { parseStoredRequestPayload, resolveFailureMessage } from './generation-queue/queuePayloads'
import type { ServiceType } from '../models/GenerationHistory'
import type { ComfyUIServerRecord } from '../types/comfyuiServer'
import type { GenerationQueueJobRecord, GenerationQueueJobStatus, GenerationQueueJobUpdateData } from '../types/generationQueue'

const ALLOWED_TRANSITIONS: Record<GenerationQueueJobStatus, GenerationQueueJobStatus[]> = {
  queued: ['dispatching', 'cancelled', 'failed'],
  dispatching: ['queued', 'running', 'cancelled', 'failed'],
  running: ['completed', 'cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
}

const DISPATCH_INTERVAL_MS = 3000
const NAI_WORKER_KEY = 'novelai'
const CODEX_WORKER_KEY = 'codex'

type ThrottledServiceType = 'novelai' | 'codex'
type ServiceThrottleState = {
  completedSinceCooldown: number
  cooldownUntil: number | null
}

const TERMINAL_QUEUE_STATUSES = new Set<GenerationQueueJobStatus>(['completed', 'failed', 'cancelled'])

type TerminalJobWaiter = {
  resolve: (record: GenerationQueueJobRecord | null) => void
  timeoutHandle: ReturnType<typeof setTimeout> | null
}

export class GenerationQueueService {
  private static started = false
  private static dispatcherHandle: ReturnType<typeof setInterval> | null = null
  private static dispatchTickScheduled = false
  private static dispatchTickRunning = false
  private static dispatchTickPending = false
  private static activeWorkerKeys = new Set<string>()
  private static terminalJobWaiters = new Map<number, Set<TerminalJobWaiter>>()
  private static serviceThrottleState: Record<ThrottledServiceType, ServiceThrottleState> = {
    novelai: { completedSinceCooldown: 0, cooldownUntil: null },
    codex: { completedSinceCooldown: 0, cooldownUntil: null },
  }

  /** Start queue recovery hooks and dispatcher once per process. */
  static start() {
    if (this.started) {
      return false
    }

    const recovery = this.recoverInterruptedJobs()
    this.started = true
    this.dispatcherHandle = setInterval(() => {
      this.requestDispatch()
    }, DISPATCH_INTERVAL_MS)
    this.requestDispatch()

    console.log(
      `📬 Generation queue service ready (cancelled=${recovery.cancelledBeforeDispatch}, failed_dispatching=${recovery.failedDispatching}, failed_running=${recovery.failedRunning})`,
    )
    return true
  }

  /** Stop queue service lifecycle hooks. */
  static stop() {
    if (!this.started) {
      return false
    }

    this.started = false
    this.dispatchTickScheduled = false
    this.dispatchTickRunning = false
    this.dispatchTickPending = false
    if (this.dispatcherHandle) {
      clearInterval(this.dispatcherHandle)
      this.dispatcherHandle = null
    }
    this.activeWorkerKeys.clear()
    this.resolveTerminalJobWaiters(null)
    this.serviceThrottleState = {
      novelai: { completedSinceCooldown: 0, cooldownUntil: null },
      codex: { completedSinceCooldown: 0, cooldownUntil: null },
    }
    return true
  }

  /** Schedule one dispatcher pass without waiting for the next poll interval. */
  static requestDispatch() {
    if (!this.started) {
      return false
    }

    if (this.dispatchTickScheduled || this.dispatchTickRunning) {
      this.dispatchTickPending = true
      return false
    }

    this.dispatchTickScheduled = true
    queueMicrotask(() => {
      this.dispatchTickScheduled = false
      void this.runDispatchTick()
    })

    return true
  }

  private static async runDispatchTick() {
    if (!this.started || this.dispatchTickRunning) {
      return
    }

    this.dispatchTickRunning = true
    try {
      await this.dispatchTick()
    } finally {
      this.dispatchTickRunning = false
      if (this.started && this.dispatchTickPending) {
        this.dispatchTickPending = false
        this.requestDispatch()
      }
    }
  }

  private static resolveComfyCancellationEndpoint(job: GenerationQueueJobRecord, assignedServer?: ComfyUIServerRecord | null) {
    if (assignedServer?.endpoint) {
      return assignedServer.endpoint
    }

    if (job.assigned_server_id) {
      const server = ComfyUIServerModel.findById(job.assigned_server_id)
      if (server?.endpoint) {
        return server.endpoint
      }
    }

    if (job.workflow_id) {
      const workflow = WorkflowModel.findById(job.workflow_id)
      if (workflow?.api_endpoint) {
        return workflow.api_endpoint
      }
    }

    return null
  }

  static async attemptUpstreamCancellation(jobId: number, options?: {
    assignedServer?: ComfyUIServerRecord | null
    providerJobId?: string | null
  }) {
    const latest = GenerationQueueModel.findById(jobId)
    if (!latest || latest.service_type !== 'comfyui') {
      return null
    }

    const promptId = options?.providerJobId ?? latest.provider_job_id ?? null
    const assignedServer = options?.assignedServer ?? (latest.assigned_server_id ? ComfyUIServerModel.findById(latest.assigned_server_id) : null)
    const endpoint = this.resolveComfyCancellationEndpoint(latest, assignedServer)
    const requestedAt = new Date().toISOString()

    if (!promptId || !endpoint) {
      updateQueueRequestDebugMeta(latest, {
        cancellation_requested_at: requestedAt,
        cancellation_endpoint: endpoint,
        cancellation_prompt_id: promptId,
        cancellation_state: promptId ? 'missing_endpoint' : 'missing_prompt_id',
      })
      return null
    }

    const comfyService = createComfyUIService(endpoint, assignedServer)
    const result = await comfyService.cancelPrompt(promptId)
    updateQueueRequestDebugMeta(latest, {
      cancellation_requested_at: requestedAt,
      cancellation_endpoint: endpoint,
      cancellation_prompt_id: promptId,
      cancellation_state: assignedServer?.backend_type === 'modal' ? 'unsupported' : result.interrupted || result.deleted ? 'requested' : 'not_found',
      cancellation_result: result,
    })
    return result
  }

  static async requestCancellation(jobId: number) {
    const latest = GenerationQueueModel.findById(jobId)
    if (!latest) {
      throw new Error(`Queue job ${jobId} not found`)
    }

    if (latest.status === 'completed' || latest.status === 'failed' || latest.status === 'cancelled') {
      return latest
    }

    if (latest.status === 'running') {
      const changed = GenerationQueueModel.requestCancelIfCurrentStatus(jobId, ['running'])
      if (!changed) {
        throw new Error(`Queue job ${jobId} changed state before cancellation request could be applied`)
      }

      try {
        await this.attemptUpstreamCancellation(jobId)
      } catch (error) {
        updateQueueRequestDebugMeta(latest, {
          cancellation_requested_at: new Date().toISOString(),
          cancellation_prompt_id: latest.provider_job_id ?? null,
          cancellation_state: 'error',
          cancellation_error: resolveFailureMessage(error),
        })
        console.warn(`⚠️ Failed to request upstream ComfyUI cancellation for queue job ${jobId}:`, error)
      }

      this.requestDispatch()
      return GenerationQueueModel.findById(jobId)
    }

    if (latest.provider_job_id) {
      try {
        await this.attemptUpstreamCancellation(jobId)
      } catch (error) {
        updateQueueRequestDebugMeta(latest, {
          cancellation_requested_at: new Date().toISOString(),
          cancellation_prompt_id: latest.provider_job_id ?? null,
          cancellation_state: 'error',
          cancellation_error: resolveFailureMessage(error),
        })
        console.warn(`⚠️ Failed to request upstream ComfyUI cancellation for queue job ${jobId}:`, error)
      }
    } else {
      updateQueueRequestDebugMeta(latest, {
        cancellation_requested_at: new Date().toISOString(),
        cancellation_state: 'pre_submit',
      })
    }

    const updated = this.transitionJob(jobId, 'cancelled', {
      expectedCurrentStatuses: [latest.status],
    })

    this.requestDispatch()
    return updated
  }

  /** Wait for a queue job to reach a terminal state without per-consumer DB polling. */
  static waitForTerminalJob(id: number, options?: { timeoutMs?: number }) {
    const current = GenerationQueueModel.findById(id)
    if (!current || TERMINAL_QUEUE_STATUSES.has(current.status)) {
      return Promise.resolve(current)
    }

    return new Promise<GenerationQueueJobRecord | null>((resolve) => {
      const waiter: TerminalJobWaiter = {
        resolve,
        timeoutHandle: null,
      }
      const waiters = this.terminalJobWaiters.get(id) ?? new Set<TerminalJobWaiter>()
      waiters.add(waiter)
      this.terminalJobWaiters.set(id, waiters)

      const timeoutMs = options?.timeoutMs
      if (timeoutMs && timeoutMs > 0) {
        waiter.timeoutHandle = setTimeout(() => {
          waiters.delete(waiter)
          if (waiters.size === 0) {
            this.terminalJobWaiters.delete(id)
          }

          const latest = GenerationQueueModel.findById(id)
          resolve(latest && TERMINAL_QUEUE_STATUSES.has(latest.status) ? latest : null)
        }, timeoutMs)
      }
    })
  }

  private static resolveTerminalJobWaiters(record: GenerationQueueJobRecord | null) {
    if (record === null) {
      for (const waiters of this.terminalJobWaiters.values()) {
        for (const waiter of waiters) {
          if (waiter.timeoutHandle) {
            clearTimeout(waiter.timeoutHandle)
          }
          waiter.resolve(null)
        }
      }
      this.terminalJobWaiters.clear()
      return
    }

    if (!TERMINAL_QUEUE_STATUSES.has(record.status)) {
      return
    }

    const waiters = this.terminalJobWaiters.get(record.id)
    if (!waiters) {
      return
    }

    this.terminalJobWaiters.delete(record.id)
    for (const waiter of waiters) {
      if (waiter.timeoutHandle) {
        clearTimeout(waiter.timeoutHandle)
      }
      waiter.resolve(record)
    }
  }

  /** Validate and apply one queue job state transition. */
  static transitionJob(
    id: number,
    nextStatus: GenerationQueueJobStatus,
    options?: {
      assignedServerId?: number | null
      failureCode?: string | null
      failureMessage?: string | null
      nowIso?: string
      allowRecovery?: boolean
      expectedCurrentStatuses?: GenerationQueueJobStatus[]
      providerJobId?: string | null
    },
  ) {
    const current = GenerationQueueModel.findById(id)
    if (!current) {
      throw new Error(`Queue job ${id} not found`)
    }

    if (current.status === nextStatus) {
      return current
    }

    const allowRecovery = options?.allowRecovery === true
    if (!allowRecovery && !ALLOWED_TRANSITIONS[current.status].includes(nextStatus)) {
      throw new Error(`Invalid queue transition: ${current.status} -> ${nextStatus}`)
    }

    const nowIso = options?.nowIso ?? new Date().toISOString()
    const updates: GenerationQueueJobUpdateData = {
      status: nextStatus,
    }

    switch (nextStatus) {
      case 'queued':
        updates.started_at = null
        updates.completed_at = null
        updates.assigned_server_id = null
        updates.provider_job_id = null
        updates.cancel_requested = false
        updates.failure_code = null
        updates.failure_message = null
        break
      case 'dispatching':
        updates.completed_at = null
        if (options?.assignedServerId !== undefined) {
          updates.assigned_server_id = options.assignedServerId
        }
        break
      case 'running':
        updates.started_at = current.started_at ?? nowIso
        updates.completed_at = null
        if (options?.assignedServerId !== undefined) {
          updates.assigned_server_id = options.assignedServerId
        }
        break
      case 'completed':
        updates.completed_at = nowIso
        updates.cancel_requested = current.cancel_requested > 0
        updates.failure_code = null
        updates.failure_message = null
        break
      case 'failed':
        updates.completed_at = nowIso
        updates.cancel_requested = current.cancel_requested > 0
        updates.failure_code = options?.failureCode ?? current.failure_code ?? null
        updates.failure_message = options?.failureMessage ?? current.failure_message ?? null
        break
      case 'cancelled':
        updates.completed_at = nowIso
        updates.cancel_requested = true
        break
    }

    if (options?.providerJobId !== undefined) {
      updates.provider_job_id = options.providerJobId
    }

    const expectedCurrentStatuses = options?.expectedCurrentStatuses ?? [current.status]
    const updated = GenerationQueueModel.updateIfCurrentStatus(id, expectedCurrentStatuses, updates)
    if (!updated) {
      throw new Error(`Queue job ${id} changed state before transition could be applied`)
    }

    const latest = GenerationQueueModel.findById(id)
    this.resolveTerminalJobWaiters(latest)
    return latest
  }

  /** Claim the next queued job and move it to dispatching atomically. */
  static claimNextDispatchableJob(params?: {
    serviceType?: ServiceType
    assignedServerId?: number | null
  }) {
    const db = getUserSettingsDb()
    const claimTransaction = db.transaction((serviceType?: ServiceType, assignedServerId?: number | null) => {
      const whereClauses = ["status = 'queued'", 'cancel_requested = 0']
      const values: Array<string | number> = []

      if (serviceType) {
        whereClauses.push('service_type = ?')
        values.push(serviceType)
      }

      if (serviceType === 'comfyui') {
        if (assignedServerId !== undefined && assignedServerId !== null) {
          whereClauses.push('(requested_server_id IS NULL OR requested_server_id = ?)')
          values.push(assignedServerId)
        } else {
          whereClauses.push('requested_server_id IS NULL')
          whereClauses.push('requested_server_tag IS NULL')
        }
      }

      const record = db.prepare(`
        SELECT * FROM generation_queue_jobs
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY priority ASC, queued_at ASC, id ASC
        LIMIT 1
      `).get(...values) as GenerationQueueJobRecord | undefined

      if (!record) {
        return null
      }

      const resolvedAssignedServerId = serviceType === 'comfyui'
        ? assignedServerId ?? record.requested_server_id ?? null
        : null

      const info = db.prepare(`
        UPDATE generation_queue_jobs
        SET status = 'dispatching',
            assigned_server_id = ?,
            updated_date = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'queued'
          AND cancel_requested = 0
      `).run(resolvedAssignedServerId, record.id)

      if (info.changes === 0) {
        return null
      }

      return db.prepare('SELECT * FROM generation_queue_jobs WHERE id = ?').get(record.id) as GenerationQueueJobRecord | undefined ?? null
    })

    return claimTransaction(params?.serviceType, params?.assignedServerId ?? null)
  }

  /** Claim one specific queued job for dispatch if it is still available. */
  static claimQueuedJobForDispatch(id: number, assignedServerId: number | null) {
    const db = getUserSettingsDb()
    const info = db.prepare(`
      UPDATE generation_queue_jobs
      SET status = 'dispatching',
          assigned_server_id = ?,
          updated_date = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status = 'queued'
        AND cancel_requested = 0
    `).run(assignedServerId, id)

    if (info.changes === 0) {
      return null
    }

    return GenerationQueueModel.findById(id)
  }

  /** Create a new queued retry job from one finished failed/cancelled job. */
  static retryJob(id: number) {
    const existing = GenerationQueueModel.findById(id)
    if (!existing) {
      throw new Error(`Queue job ${id} not found`)
    }

    if (existing.status !== 'failed' && existing.status !== 'cancelled') {
      throw new Error('Only failed or cancelled queue jobs can be retried safely')
    }

    const requestPayload = parseStoredRequestPayload(existing)
    const retrySummary = existing.request_summary
      ? `${existing.request_summary} (retry)`
      : `Retry of queue job ${existing.id}`

    const retryJobId = GenerationQueueModel.create({
      service_type: existing.service_type,
      priority: existing.priority,
      requested_by_account_id: existing.requested_by_account_id ?? null,
      requested_by_account_type: existing.requested_by_account_type ?? null,
      workflow_id: existing.workflow_id ?? null,
      workflow_name: existing.workflow_name ?? null,
      requested_group_id: existing.requested_group_id ?? null,
      requested_server_id: existing.requested_server_id ?? null,
      requested_server_tag: existing.requested_server_tag ?? null,
      request_payload: requestPayload,
      request_summary: retrySummary,
    })

    this.requestDispatch()
    return GenerationQueueModel.findById(retryJobId)
  }

  /** Recover interrupted jobs after backend restart without silently re-running them. */
  static recoverInterruptedJobs() {
    const db = getUserSettingsDb()
    const nowIso = new Date().toISOString()

    const recoveryTransaction = db.transaction(() => {
      const cancelledBeforeDispatch = db.prepare(`
        UPDATE generation_queue_jobs
        SET status = 'cancelled',
            completed_at = COALESCE(completed_at, ?),
            updated_date = CURRENT_TIMESTAMP
        WHERE status = 'queued'
          AND cancel_requested = 1
      `).run(nowIso).changes

      const failedDispatching = db.prepare(`
        UPDATE generation_queue_jobs
        SET status = 'failed',
            failure_code = COALESCE(failure_code, 'process_restarted'),
            failure_message = COALESCE(failure_message, 'Backend restarted while this queue job was dispatching. Retry is required.'),
            completed_at = COALESCE(completed_at, ?),
            updated_date = CURRENT_TIMESTAMP
        WHERE status = 'dispatching'
      `).run(nowIso).changes

      const failedRunning = db.prepare(`
        UPDATE generation_queue_jobs
        SET status = 'failed',
            failure_code = COALESCE(failure_code, 'process_restarted'),
            failure_message = COALESCE(failure_message, 'Backend restarted while this queue job was running. Retry is required.'),
            completed_at = COALESCE(completed_at, ?),
            updated_date = CURRENT_TIMESTAMP
        WHERE status = 'running'
      `).run(nowIso).changes

      return {
        cancelledBeforeDispatch,
        failedDispatching,
        failedRunning,
      }
    })

    return recoveryTransaction()
  }

  private static async dispatchTick() {
    if (!this.started) {
      return
    }

    this.tryStartNovelAiWorker()
    this.tryStartCodexWorker()
    await this.tryStartComfyWorkers()
  }

  private static getServiceThrottleConfig(serviceType: ThrottledServiceType) {
    const generationThrottle = settingsService.loadSettings().generationThrottle
    return serviceType === 'novelai' ? generationThrottle.novelai : generationThrottle.codex
  }

  private static getActiveWorkerCountForPrefix(workerKeyPrefix: string) {
    let count = 0
    for (const workerKey of this.activeWorkerKeys) {
      if (workerKey.startsWith(`${workerKeyPrefix}:`)) {
        count += 1
      }
    }
    return count
  }

  private static isServiceCoolingDown(serviceType: ThrottledServiceType) {
    const cooldownUntil = this.serviceThrottleState[serviceType].cooldownUntil
    return cooldownUntil !== null && cooldownUntil > Date.now()
  }

  private static noteServiceCompletion(serviceType: ThrottledServiceType) {
    const throttle = this.getServiceThrottleConfig(serviceType)
    const state = this.serviceThrottleState[serviceType]
    const cooldownAfterCompletions = Math.max(1, throttle.cooldownAfterCompletions)
    const cooldownSeconds = Math.max(0, throttle.cooldownSeconds)

    if (state.cooldownUntil !== null && state.cooldownUntil <= Date.now()) {
      state.cooldownUntil = null
    }

    state.completedSinceCooldown += 1
    if (cooldownSeconds <= 0 || state.completedSinceCooldown < cooldownAfterCompletions) {
      return
    }

    state.completedSinceCooldown = 0
    state.cooldownUntil = Date.now() + cooldownSeconds * 1000
  }

  private static tryStartThrottledServiceWorkers(serviceType: ThrottledServiceType, workerKeyPrefix: string, label: string) {
    if (this.isServiceCoolingDown(serviceType)) {
      return
    }

    const throttle = this.getServiceThrottleConfig(serviceType)
    const maxConcurrentJobs = Math.max(1, throttle.maxConcurrentJobs)
    const activeWorkers = this.getActiveWorkerCountForPrefix(workerKeyPrefix)
    const availableSlots = Math.max(0, maxConcurrentJobs - activeWorkers)

    for (let slotIndex = 0; slotIndex < availableSlots; slotIndex += 1) {
      const job = this.claimNextDispatchableJob({ serviceType })
      if (!job) {
        return
      }

      const workerKey = `${workerKeyPrefix}:${job.id}`
      this.activeWorkerKeys.add(workerKey)
      void this.runClaimedJob(job)
        .catch((error) => {
          console.error(`❌ ${label} queue worker failed for job ${job.id}:`, error)
        })
        .finally(() => {
          this.activeWorkerKeys.delete(workerKey)
          const latest = GenerationQueueModel.findById(job.id)
          if (latest?.status === 'completed') {
            this.noteServiceCompletion(serviceType)
          }
          this.requestDispatch()
        })
    }
  }

  private static tryStartNovelAiWorker() {
    this.tryStartThrottledServiceWorkers('novelai', NAI_WORKER_KEY, 'NovelAI')
  }

  private static tryStartCodexWorker() {
    this.tryStartThrottledServiceWorkers('codex', CODEX_WORKER_KEY, 'Codex')
  }

  private static getActiveComfyWorkerCount(serverId: number) {
    return this.getActiveWorkerCountForPrefix(`comfyui:${serverId}`)
  }

  private static async tryStartComfyWorkers(): Promise<void> {
    const activeServers = ComfyUIServerModel.findActiveServers()

    if (activeServers.length === 0) {
      return
    }

    const queuedJobs = GenerationQueueModel.findQueuedComfyJobs()
    if (queuedJobs.length === 0) {
      return
    }

    const failedJobIds = new Set<number>()
    for (const job of queuedJobs) {
      const hasCompatibleServer = activeServers.some((server) => isGenerationQueueComfyJobCompatibleWithServer(job, server, activeServers))
      if (hasCompatibleServer) {
        continue
      }

      await this.failJobIfActive(job.id, new Error(`No active linked ComfyUI server matches this job target for workflow ${job.workflow_id ?? 'unknown'}`))
      failedJobIds.add(job.id)
    }

    const runnableQueuedJobs = queuedJobs.filter((job) => !failedJobIds.has(job.id))
    if (runnableQueuedJobs.length === 0) {
      return
    }

    const serversWithLocalCapacity = activeServers.filter((server) => this.getActiveComfyWorkerCount(server.id) < getGenerationQueueServerCapacity(server))
    if (serversWithLocalCapacity.length === 0) {
      return
    }

    const probeableServers = serversWithLocalCapacity.filter((server) => server.backend_type !== 'modal')
    const runtimeStatuses = await getComfyUIServerRuntimeStatuses(probeableServers)
    const statusByServerId = new Map(runtimeStatuses.map((status) => [status.server_id, status]))
    const reservedJobIds = new Set<number>()

    for (const server of serversWithLocalCapacity) {
      const runtimeStatus = server.backend_type === 'modal'
        ? { is_connected: true, is_idle: true, running_count: 0, pending_count: 0 }
        : statusByServerId.get(server.id)
      if (!runtimeStatus?.is_connected) {
        console.log(`⏭️ Skipping ComfyUI server ${server.name} (${server.id}), unreachable`)
        continue
      }

      const capacity = getGenerationQueueServerCapacity(server)
      const localRunning = this.getActiveComfyWorkerCount(server.id)
      const availableLocalSlots = Math.max(0, capacity - localRunning)
      if (availableLocalSlots === 0) {
        continue
      }

      if (server.backend_type !== 'modal' && runtimeStatus.is_idle !== true) {
        console.log(
          `⏭️ Skipping ComfyUI server ${server.name} (${server.id}), busy (running=${runtimeStatus.running_count ?? 0}, pending=${runtimeStatus.pending_count ?? 0})`,
        )
        continue
      }

      for (let slotIndex = 0; slotIndex < availableLocalSlots; slotIndex += 1) {
        const candidateJob = runnableQueuedJobs.find((job) => !reservedJobIds.has(job.id) && isGenerationQueueComfyJobCompatibleWithServer(job, server, activeServers))
        if (!candidateJob) {
          break
        }

        const job = this.claimQueuedJobForDispatch(candidateJob.id, server.id)
        if (!job) {
          reservedJobIds.add(candidateJob.id)
          continue
        }

        reservedJobIds.add(job.id)
        const workerKey = `comfyui:${server.id}:${job.id}`
        this.activeWorkerKeys.add(workerKey)
        void this.runClaimedJob(job, server)
          .catch((error) => {
            console.error(`❌ ComfyUI queue worker failed for job ${job.id} on server ${server.id}:`, error)
          })
          .finally(() => {
            this.activeWorkerKeys.delete(workerKey)
            this.requestDispatch()
          })
      }
    }
  }

  private static async runClaimedJob(job: GenerationQueueJobRecord, assignedServer?: ComfyUIServerRecord | null) {
    try {
      await executeGenerationQueueJob(job, assignedServer ?? null, {
        transitionJob: (id, nextStatus, options) => this.transitionJob(id, nextStatus, options),
        attemptUpstreamCancellation: (jobId, options) => this.attemptUpstreamCancellation(jobId, options),
      })
    } catch (error) {
      if (isGenerationQueueCancellationError(error) || (GenerationQueueModel.findById(job.id)?.cancel_requested ?? 0) > 0) {
        await this.cancelJobIfActive(job.id)
        return
      }

      await this.failJobIfActive(job.id, error)
      throw error
    }
  }

  private static async cancelJobIfActive(jobId: number) {
    const latest = GenerationQueueModel.findById(jobId)
    if (!latest) {
      return
    }

    if (latest.status === 'failed' || latest.status === 'completed' || latest.status === 'cancelled') {
      return
    }

    try {
      this.transitionJob(jobId, 'cancelled', {
        expectedCurrentStatuses: [latest.status],
      })
    } catch (transitionError) {
      console.warn(`⚠️ Failed to mark queue job ${jobId} as cancelled:`, transitionError)
    }
  }

  private static async failJobIfActive(jobId: number, error: unknown) {
    const latest = GenerationQueueModel.findById(jobId)
    if (!latest) {
      return
    }

    if (latest.status === 'failed' || latest.status === 'completed' || latest.status === 'cancelled') {
      return
    }

    try {
      this.transitionJob(jobId, 'failed', {
        expectedCurrentStatuses: [latest.status],
        failureCode: 'execution_failed',
        failureMessage: resolveFailureMessage(error),
      })
    } catch (transitionError) {
      console.warn(`⚠️ Failed to mark queue job ${jobId} as failed:`, transitionError)
    }
  }
}
