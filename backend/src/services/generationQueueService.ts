import { getUserSettingsDb } from '../database/userSettingsDb'
import { GenerationQueueModel } from '../models/GenerationQueue'
import { ComfyUIServerModel } from '../models/ComfyUIServer'
import { getComfyUIServerRuntimeStatuses } from './comfyui/runtimeStatusService'
import { createGenerationQueueRoutingContext, getGenerationQueueEligibleServerIds, getGenerationQueueServerCapacity } from './generationQueueRouting'
import { attemptQueueUpstreamCancellation, type QueueUpstreamCancellationOptions } from './generation-queue/queueUpstreamCancellation'
import { updateQueueRequestDebugMeta } from './generation-queue/queueDebugMeta'
import { executeGenerationQueueJob, isGenerationQueueCancellationError } from './generation-queue/queueJobExecutors'
import { parseStoredRequestPayload, resolveFailureMessage } from './generation-queue/queuePayloads'
import { QueueServiceThrottle, type ThrottledServiceType } from './generation-queue/queueServiceThrottle'
import { QueueTerminalJobWaiters } from './generation-queue/queueTerminalWaiters'
import { ALLOWED_QUEUE_TRANSITIONS, buildQueueTransitionUpdates } from './generation-queue/queueTransitions'
import { GenerationHistoryModel, type ServiceType } from '../models/GenerationHistory'
import type { ComfyUIServerRecord } from '../types/comfyuiServer'
import type {
  GenerationQueueDispatchCandidateRecord,
  GenerationQueueJobRecord,
  GenerationQueueJobStatus,
} from '../types/generationQueue'

const DISPATCH_INTERVAL_MS = 3000
const COMFY_DISPATCH_CANDIDATE_OVERFETCH_PER_SLOT = 24
const COMFY_DISPATCH_CANDIDATE_BATCH_LIMIT = 240
const NAI_WORKER_KEY = 'novelai'
const CODEX_WORKER_KEY = 'codex'

export class GenerationQueueService {
  private static started = false
  private static dispatcherHandle: ReturnType<typeof setInterval> | null = null
  private static dispatchTickScheduled = false
  private static dispatchTickRunning = false
  private static dispatchTickPending = false
  private static activeWorkerKeys = new Set<string>()
  private static terminalJobWaiters = new QueueTerminalJobWaiters()
  private static serviceThrottle = new QueueServiceThrottle()
  private static comfyDispatchSkipStateByServerId = new Map<number, 'unreachable' | 'busy'>()

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
    this.terminalJobWaiters.resolve(null)
    this.serviceThrottle.reset()
    this.comfyDispatchSkipStateByServerId.clear()
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
      this.runDispatchTick().catch((error) => {
        console.error('❌ Generation queue dispatch tick failed:', error)
      })
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

  static attemptUpstreamCancellation(jobId: number, options?: QueueUpstreamCancellationOptions) {
    return attemptQueueUpstreamCancellation(jobId, options)
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
    return this.terminalJobWaiters.waitFor(id, options)
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
    if (!allowRecovery && !ALLOWED_QUEUE_TRANSITIONS[current.status].includes(nextStatus)) {
      throw new Error(`Invalid queue transition: ${current.status} -> ${nextStatus}`)
    }

    const nowIso = options?.nowIso ?? new Date().toISOString()
    const updates = buildQueueTransitionUpdates(current, nextStatus, nowIso, options)

    const expectedCurrentStatuses = options?.expectedCurrentStatuses ?? [current.status]
    const updated = GenerationQueueModel.updateIfCurrentStatus(id, expectedCurrentStatuses, updates)
    if (!updated) {
      throw new Error(`Queue job ${id} changed state before transition could be applied`)
    }

    const latest = GenerationQueueModel.findById(id)
    this.terminalJobWaiters.resolve(latest)
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
    if (requestPayload.pruned === true) {
      throw new Error(`Queue job ${id} request payload was pruned by retention cleanup, so it can no longer be retried`)
    }

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
      const cancelledBeforeDispatchJobIds = db.prepare(`
        SELECT id
        FROM generation_queue_jobs
        WHERE status = 'queued'
          AND cancel_requested = 1
      `).all().map((row) => (row as { id: number }).id)
      const interruptedDispatchingJobIds = db.prepare(`
        SELECT id
        FROM generation_queue_jobs
        WHERE status = 'dispatching'
      `).all().map((row) => (row as { id: number }).id)
      const interruptedRunningJobIds = db.prepare(`
        SELECT id
        FROM generation_queue_jobs
        WHERE status = 'running'
      `).all().map((row) => (row as { id: number }).id)

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

      const cancelledHistoryRecords = GenerationHistoryModel.recordErrorByQueueJobIds(
        cancelledBeforeDispatchJobIds,
        'Cancelled before dispatch.',
      )
      const failedDispatchingHistoryRecords = GenerationHistoryModel.recordErrorByQueueJobIds(
        interruptedDispatchingJobIds,
        'Backend restarted while this queue job was dispatching. Retry is required.',
      )
      const failedRunningHistoryRecords = GenerationHistoryModel.recordErrorByQueueJobIds(
        interruptedRunningJobIds,
        'Backend restarted while this queue job was running. Retry is required.',
      )

      return {
        cancelledBeforeDispatch,
        failedDispatching,
        failedRunning,
        failedHistoryRecords: cancelledHistoryRecords + failedDispatchingHistoryRecords + failedRunningHistoryRecords,
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

  /** Forecast the next service-level throttle start slots without mutating dispatcher state. */
  static getThrottledServiceStartDelaySeconds(serviceType: ThrottledServiceType, count: number, now = Date.now()) {
    return this.serviceThrottle.getStartDelaySeconds(serviceType, count, now)
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

  private static tryStartThrottledServiceWorkers(serviceType: ThrottledServiceType, workerKeyPrefix: string, label: string) {
    const maxConcurrentJobs = this.serviceThrottle.getMaxConcurrentJobs(serviceType)
    const activeWorkers = this.getActiveWorkerCountForPrefix(workerKeyPrefix)
    const availableSlots = Math.max(0, maxConcurrentJobs - activeWorkers)

    for (let slotIndex = 0; slotIndex < availableSlots; slotIndex += 1) {
      if (!this.serviceThrottle.isStartDue(serviceType)) {
        return
      }

      const job = this.claimNextDispatchableJob({ serviceType })
      if (!job) {
        return
      }

      this.serviceThrottle.noteStart(serviceType)
      const workerKey = `${workerKeyPrefix}:${job.id}`
      this.activeWorkerKeys.add(workerKey)
      void this.runClaimedJob(job)
        .catch((error) => {
          console.error(`❌ ${label} queue worker failed for job ${job.id}:`, error)
        })
        .finally(() => {
          this.activeWorkerKeys.delete(workerKey)
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

    const serversWithLocalCapacity = activeServers.filter((server) => this.getActiveComfyWorkerCount(server.id) < getGenerationQueueServerCapacity(server))
    if (serversWithLocalCapacity.length === 0) {
      return
    }

    const availableLocalSlotCount = serversWithLocalCapacity.reduce((sum, server) => {
      const capacity = getGenerationQueueServerCapacity(server)
      const localRunning = this.getActiveComfyWorkerCount(server.id)
      return sum + Math.max(0, capacity - localRunning)
    }, 0)
    const candidateLimit = Math.min(
      COMFY_DISPATCH_CANDIDATE_BATCH_LIMIT,
      Math.max(COMFY_DISPATCH_CANDIDATE_OVERFETCH_PER_SLOT, availableLocalSlotCount * COMFY_DISPATCH_CANDIDATE_OVERFETCH_PER_SLOT),
    )
    const queuedJobs = GenerationQueueModel.findQueuedComfyDispatchCandidates(candidateLimit)
    if (queuedJobs.length === 0) {
      return
    }

    const routingContext = createGenerationQueueRoutingContext(activeServers)
    const compatibleServerIdsByJobId = new Map<number, Set<number>>()
    for (const job of queuedJobs) {
      compatibleServerIdsByJobId.set(job.id, new Set(getGenerationQueueEligibleServerIds(job, routingContext)))
    }

    const failedJobIds = new Set<number>()
    for (const job of queuedJobs) {
      const compatibleServerIds = compatibleServerIdsByJobId.get(job.id)
      if (compatibleServerIds && compatibleServerIds.size > 0) {
        continue
      }

      await this.failJobIfActive(job.id, new Error(`No active linked ComfyUI server matches this job target for workflow ${job.workflow_id ?? 'unknown'}`))
      failedJobIds.add(job.id)
    }

    const runnableQueuedJobs = queuedJobs.filter((job) => !failedJobIds.has(job.id))
    if (runnableQueuedJobs.length === 0) {
      return
    }

    const runnableJobsByServerId = new Map<number, GenerationQueueDispatchCandidateRecord[]>()
    for (const job of runnableQueuedJobs) {
      for (const serverId of compatibleServerIdsByJobId.get(job.id) ?? []) {
        const jobsForServer = runnableJobsByServerId.get(serverId)
        if (jobsForServer) {
          jobsForServer.push(job)
        } else {
          runnableJobsByServerId.set(serverId, [job])
        }
      }
    }

    const probeableServers = serversWithLocalCapacity.filter((server) => server.backend_type !== 'modal')
    const runtimeStatuses = await getComfyUIServerRuntimeStatuses(probeableServers)
    const statusByServerId = new Map(runtimeStatuses.map((status) => [status.server_id, status]))
    const reservedJobIds = new Set<number>()
    const nextRunnableJobIndexByServerId = new Map<number, number>()
    const takeNextRunnableJobForServer = (serverId: number) => {
      const jobsForServer = runnableJobsByServerId.get(serverId)
      if (!jobsForServer) {
        return null
      }

      let index = nextRunnableJobIndexByServerId.get(serverId) ?? 0
      while (index < jobsForServer.length) {
        const job = jobsForServer[index]
        index += 1
        if (!reservedJobIds.has(job.id)) {
          nextRunnableJobIndexByServerId.set(serverId, index)
          return job
        }
      }

      nextRunnableJobIndexByServerId.set(serverId, index)
      return null
    }

    for (const server of serversWithLocalCapacity) {
      const runtimeStatus = server.backend_type === 'modal'
        ? { is_connected: true, is_idle: true, running_count: 0, pending_count: 0 }
        : statusByServerId.get(server.id)
      if (!runtimeStatus?.is_connected) {
        // Log only on state change so the 3s dispatch tick does not repeat skip lines.
        if (this.comfyDispatchSkipStateByServerId.get(server.id) !== 'unreachable') {
          this.comfyDispatchSkipStateByServerId.set(server.id, 'unreachable')
          console.log(`⏭️ Skipping ComfyUI server ${server.name} (${server.id}), unreachable`)
        }
        continue
      }

      const capacity = getGenerationQueueServerCapacity(server)
      const localRunning = this.getActiveComfyWorkerCount(server.id)
      const availableLocalSlots = Math.max(0, capacity - localRunning)
      if (availableLocalSlots === 0) {
        continue
      }

      if (server.backend_type !== 'modal' && runtimeStatus.is_idle !== true) {
        if (this.comfyDispatchSkipStateByServerId.get(server.id) !== 'busy') {
          this.comfyDispatchSkipStateByServerId.set(server.id, 'busy')
          console.log(
            `⏭️ Skipping ComfyUI server ${server.name} (${server.id}), busy (running=${runtimeStatus.running_count ?? 0}, pending=${runtimeStatus.pending_count ?? 0})`,
          )
        }
        continue
      }

      this.comfyDispatchSkipStateByServerId.delete(server.id)

      for (let slotIndex = 0; slotIndex < availableLocalSlots; slotIndex += 1) {
        const candidateJob = takeNextRunnableJobForServer(server.id)
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
