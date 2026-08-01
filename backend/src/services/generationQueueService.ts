import { getUserSettingsDb } from '../database/userSettingsDb'
import { GenerationQueueModel } from '../models/GenerationQueue'
import { ComfyUIServerModel } from '../models/ComfyUIServer'
import { getComfyUIServerRuntimeStatuses } from './comfyui/runtimeStatusService'
import { createGenerationQueueRoutingContext, getGenerationQueueEligibleServerIds, getGenerationQueueServerCapacity } from './generationQueueRouting'
import { attemptQueueUpstreamCancellation, type QueueUpstreamCancellationOptions } from './generation-queue/queueUpstreamCancellation'
import { queueCancellationRegistry } from './generation-queue/queueCancellationRegistry'
import { NAI_SUBMIT_AMBIGUOUS_FAILURE_CODE, reconcileOrphanedProviderJobs } from './generation-queue/queueOrphanReconciler'
import { updateQueueRequestDebugMeta } from './generation-queue/queueDebugMeta'
import {
  executeGenerationQueueJob,
  isGenerationQueueCancellationError,
  resolveQueueFailureCode,
  resolveQueueFailureMessage,
} from './generation-queue/queueJobExecutors'
import { parseStoredRequestPayload, resolveFailureMessage } from './generation-queue/queuePayloads'
import { QueueServiceThrottle, type ThrottledServiceType } from './generation-queue/queueServiceThrottle'
import { QueueTerminalJobWaiters } from './generation-queue/queueTerminalWaiters'
import { publishQueueJobEvent } from './runtime-events/runtimeEventPublishers'
import { ALLOWED_QUEUE_TRANSITIONS, buildQueueTransitionUpdates } from './generation-queue/queueTransitions'
import { GenerationHistoryModel, type ServiceType } from '../models/GenerationHistory'
import type { ComfyUIServerRecord } from '../types/comfyuiServer'
import type {
  GenerationQueueCancelOrigin,
  GenerationQueueDispatchCandidateRecord,
  GenerationQueueJobRecord,
  GenerationQueueJobStatus,
} from '../types/generationQueue'

const DISPATCH_INTERVAL_MS = 3000
const COMFY_DISPATCH_CANDIDATE_OVERFETCH_PER_SLOT = 24
const COMFY_DISPATCH_CANDIDATE_BATCH_LIMIT = 240
const NAI_WORKER_KEY = 'novelai'
const CODEX_WORKER_KEY = 'codex'
// 소유 워커가 사라진 취소 요청을 확정하기까지의 유예. CR-2(라우트가 확정하지 않음)의 안전망이다.
const ABANDONED_CANCELLATION_GRACE_SECONDS = 30
const ORPHAN_RECONCILE_INTERVAL_MS = 5 * 60 * 1000
// 이 시간이 지나도록 상류 핸들을 확인하지 못한 제출은 회수 가망이 없다고 본다.
const ORPHAN_RECOVERY_DEADLINE_HOURS = 24
const TERMINAL_QUEUE_STATUSES: GenerationQueueJobStatus[] = ['completed', 'failed', 'cancelled']

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
  private static orphanReconcileHandle: ReturnType<typeof setInterval> | null = null

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
    // Phase 2: 상류 orphan 정리. 이게 돌아야 orphan 프롬프트가 is_idle 판정을 막아 큐를 세우는 일이 풀린다.
    this.orphanReconcileHandle = setInterval(() => {
      this.runOrphanReconcile()
    }, ORPHAN_RECONCILE_INTERVAL_MS)
    this.orphanReconcileHandle.unref?.()
    this.runOrphanReconcile()
    this.requestDispatch()

    console.log(
      `📬 Generation queue service ready (cancelled=${recovery.cancelledBeforeDispatch}, failed_dispatching=${recovery.failedDispatching}, failed_running=${recovery.failedRunning}, orphan_suspected=${recovery.orphanSuspected})`,
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
    if (this.orphanReconcileHandle) {
      clearInterval(this.orphanReconcileHandle)
      this.orphanReconcileHandle = null
    }
    this.activeWorkerKeys.clear()
    queueCancellationRegistry.abortAll('queue_service_stopped')
    this.terminalJobWaiters.resolve(null)
    this.serviceThrottle.reset()
    this.comfyDispatchSkipStateByServerId.clear()
    return true
  }

  private static runOrphanReconcile() {
    void reconcileOrphanedProviderJobs().catch((error) => {
      console.error('❌ Generation queue orphan reconcile failed:', error)
    })
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

  /**
   * Request cancellation for one queue job.
   *
   * 반환값은 **"취소 완료"가 아니라 "취소 요청 접수"** 다. `queued` 만 여기서 즉시 확정되고,
   * `dispatching`/`running` 은 플래그만 세운 뒤 소유 워커(없으면 스테일 스위퍼)가 확정한다.
   * 확정을 기다려야 하는 호출부는 `waitForTerminalJob` 을 써야 한다.
   */
  static async requestCancellation(jobId: number, options?: { origin?: GenerationQueueCancelOrigin }) {
    const latest = GenerationQueueModel.findById(jobId)
    if (!latest) {
      throw new Error(`Queue job ${jobId} not found`)
    }

    if (TERMINAL_QUEUE_STATUSES.includes(latest.status)) {
      return latest
    }

    // CR-1: 이 원자 UPDATE 가 취소의 유일한 진입점이고, 업스트림 호출·전이·abort 보다 먼저 실행된다.
    // 이후 어떤 경로로도 이 잡이 새로 claim 되지 않음이 claim 가드로 보장된다.
    // changes === 0 은 에러가 아니라 "이미 terminal" 이라는 뜻이므로 멱등 성공으로 다룬다.
    GenerationQueueModel.markCancelRequested(jobId, options?.origin ?? 'user')

    // 인메모리 시그널은 지연 최적화다. 소유 워커가 다른 프로세스면 false 를 받고 폴링/스위퍼에 위임한다.
    queueCancellationRegistry.abort(jobId, 'cancel_requested')

    const flagged = GenerationQueueModel.findById(jobId) ?? latest
    // E4: "취소 요청 접수" 이벤트다. 확정(terminal)은 워커/스위퍼가 별도 E1 이벤트로 알린다.
    publishQueueJobEvent('queue.job.cancel-requested', flagged, { previousStatus: latest.status })

    if (TERMINAL_QUEUE_STATUSES.includes(flagged.status)) {
      this.requestDispatch()
      return flagged
    }

    // CR-2: `queued` 는 claim 가드가 재클레임을 막아 주므로 라우트가 바로 확정해도 안전하다.
    if (flagged.status === 'queued') {
      try {
        const updated = this.transitionJob(jobId, 'cancelled', {
          expectedCurrentStatuses: ['queued'],
        })

        this.requestDispatch()
        return updated
      } catch (transitionError) {
        // 플래그 세팅과 확정 사이에 다른 프로세스가 claim 했다면 워커 확정 경로로 넘어간다.
        console.warn(`⚠️ Queue job ${jobId} left the queued state before cancellation could be finalized:`, transitionError)
      }
    }

    // `dispatching`/`running` 은 여기서 확정하지 않는다. 업스트림 취소만 시도하고
    // 실제 terminal 확정은 소유 워커(또는 finalizeAbandonedCancellations)가 맡는다.
    try {
      await this.attemptUpstreamCancellation(jobId)
    } catch (error) {
      GenerationQueueModel.markProviderCancelState(jobId, 'error')
      updateQueueRequestDebugMeta(flagged, {
        cancellation_requested_at: new Date().toISOString(),
        cancellation_prompt_id: flagged.provider_job_id ?? null,
        cancellation_state: 'error',
        cancellation_error: resolveFailureMessage(error),
      })
      console.warn(`⚠️ Failed to request upstream ComfyUI cancellation for queue job ${jobId}:`, error)
    }

    this.requestDispatch()
    return GenerationQueueModel.findById(jobId)
  }

  /**
   * Finalize cancel-requested jobs whose owning worker is gone.
   * CR-2 로 라우트가 `dispatching`/`running` 을 확정하지 않게 된 이상 이 스위퍼가 필수 안전망이다.
   */
  static finalizeAbandonedCancellations(options?: { staleSeconds?: number }) {
    const staleSeconds = Math.max(0, Math.floor(options?.staleSeconds ?? ABANDONED_CANCELLATION_GRACE_SECONDS))
    const candidates = GenerationQueueModel.findAbandonedCancellations(staleSeconds)
    if (candidates.length === 0) {
      return 0
    }

    const ownedJobIds = new Set(queueCancellationRegistry.ownedJobIds())
    let finalized = 0

    for (const candidate of candidates) {
      if (ownedJobIds.has(candidate.id)) {
        // 이 프로세스 워커가 아직 정리 중이다. 워커 확정을 우선한다.
        continue
      }

      const submitState = candidate.provider_submit_state ?? 'none'
      if (submitState !== 'none') {
        // 상류에 작업이 남아 있을 수 있으므로 reconcile 대상으로 승격시킨 뒤 terminal 로 보낸다.
        GenerationQueueModel.markProviderSubmitState(candidate.id, 'orphan_suspected')
      }

      try {
        this.transitionJob(candidate.id, 'cancelled', {
          expectedCurrentStatuses: [candidate.status],
        })
        finalized += 1
      } catch (transitionError) {
        console.warn(`⚠️ Failed to finalize abandoned cancellation for queue job ${candidate.id}:`, transitionError)
      }
    }

    if (finalized > 0) {
      console.log(`🧹 Finalized ${finalized} abandoned queue cancellation(s) with no owning worker`)
    }

    return finalized
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
    // E1: 모든 정상 전이가 이 funnel 을 지나므로 큐 상태 푸시의 주 발행 지점이다.
    publishQueueJobEvent('queue.job.status', latest, { previousStatus: current.status })
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

    const claimed = claimTransaction(params?.serviceType, params?.assignedServerId ?? null)
    // E2: claim 은 transitionJob 을 우회하는 raw UPDATE 라 여기서 직접 발행한다.
    publishQueueJobEvent('queue.job.status', claimed, { previousStatus: 'queued' })
    return claimed
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

    const claimed = GenerationQueueModel.findById(id)
    // E3: 두 번째 claim 경로도 같은 raw UPDATE 라 같은 이벤트를 발행한다.
    publishQueueJobEvent('queue.job.status', claimed, { previousStatus: 'queued' })
    return claimed
  }

  /** Create a new queued retry job from one finished failed/cancelled job. */
  static retryJob(id: number, options?: { force?: boolean }) {
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

    // CC-3: NovelAI 는 접수 시점에 Anlas 가 빠지므로 모호한 실패의 자동 재시도는 이중 과금이 된다.
    const isAmbiguousNaiSubmit = existing.failure_code === NAI_SUBMIT_AMBIGUOUS_FAILURE_CODE
      || (existing.service_type === 'novelai' && existing.provider_submit_state === 'orphan_unresolved')
    if (isAmbiguousNaiSubmit && options?.force !== true) {
      throw new Error(`Queue job ${id} may already have consumed NovelAI Anlas, so it cannot be retried without an explicit force flag`)
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

    const retryJob = GenerationQueueModel.findById(retryJobId)
    // E5: 재시도는 신규 잡 생성이다.
    publishQueueJobEvent('queue.job.created', retryJob)

    this.requestDispatch()
    return retryJob
  }

  /**
   * Recover interrupted jobs after backend restart without silently re-running them.
   *
   * Phase 1(동기 분류, DB만 만짐): 상류에 아무 것도 없음이 증명된 잡만 확정한다.
   * 상류 작업이 남아 있을 수 있는 잡(`provider_submit_state != 'none'`)은 **확정하지 않고**
   * `orphan_suspected` 로만 마킹해 Phase 2 reconciler 가 이어받게 한다.
   *
   * 여기서는 런타임 이벤트를 발행하지 않는다. 이 일괄 전이는 프로세스 기동 시점에만 일어나고,
   * 그 시점의 클라이언트는 끊긴 스트림을 재연결하며 `hello` 후 전체 무효화를 수행하기 때문이다.
   * 수백 건을 개별 프레임으로 흘리는 것보다 재연결 무효화 한 번이 싸고 정확하다.
   */
  static recoverInterruptedJobs() {
    const db = getUserSettingsDb()
    const nowIso = new Date().toISOString()
    const orphanDeadlineHours = `-${ORPHAN_RECOVERY_DEADLINE_HOURS} hours`

    const recoveryTransaction = db.transaction(() => {
      const cancelledBeforeDispatchJobIds = db.prepare(`
        SELECT id
        FROM generation_queue_jobs
        WHERE status = 'queued'
          AND cancel_requested = 1
      `).all().map((row) => (row as { id: number }).id)
      // 상류 흔적이 없는(=제출 전에 죽은) 잡만 실패 확정 대상이다.
      const interruptedDispatchingJobIds = db.prepare(`
        SELECT id
        FROM generation_queue_jobs
        WHERE status = 'dispatching'
          AND provider_submit_state = 'none'
      `).all().map((row) => (row as { id: number }).id)
      const interruptedRunningJobIds = db.prepare(`
        SELECT id
        FROM generation_queue_jobs
        WHERE status = 'running'
          AND provider_submit_state = 'none'
      `).all().map((row) => (row as { id: number }).id)
      // 24시간이 지나도록 회수되지 않은 제출은 가망이 없다고 보고 함께 실패 확정한다.
      const expiredOrphanJobIds = db.prepare(`
        SELECT id
        FROM generation_queue_jobs
        WHERE status IN ('dispatching', 'running')
          AND provider_submit_state != 'none'
          AND COALESCE(provider_submit_started_at, started_at, queued_at) < datetime('now', ?)
      `).all(orphanDeadlineHours).map((row) => (row as { id: number }).id)

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
          AND provider_submit_state = 'none'
      `).run(nowIso).changes

      const failedRunning = db.prepare(`
        UPDATE generation_queue_jobs
        SET status = 'failed',
            failure_code = COALESCE(failure_code, 'process_restarted'),
            failure_message = COALESCE(failure_message, 'Backend restarted while this queue job was running. Retry is required.'),
            completed_at = COALESCE(completed_at, ?),
            updated_date = CURRENT_TIMESTAMP
        WHERE status = 'running'
          AND provider_submit_state = 'none'
      `).run(nowIso).changes

      const failedExpiredOrphans = db.prepare(`
        UPDATE generation_queue_jobs
        SET status = 'failed',
            failure_code = COALESCE(failure_code, 'process_restarted_orphan'),
            failure_message = COALESCE(failure_message, 'Backend restarted while upstream work may have been running, and it could not be recovered in time.'),
            provider_submit_state = 'orphan_unresolved',
            completed_at = COALESCE(completed_at, ?),
            updated_date = CURRENT_TIMESTAMP
        WHERE status IN ('dispatching', 'running')
          AND provider_submit_state != 'none'
          AND COALESCE(provider_submit_started_at, started_at, queued_at) < datetime('now', ?)
      `).run(nowIso, orphanDeadlineHours).changes

      // 아직 회수 가능성이 있는 잡은 status 를 유지한 채 취소 요청 + orphan 후보로만 마킹한다.
      const orphanSuspected = db.prepare(`
        UPDATE generation_queue_jobs
        SET cancel_requested = 1,
            cancel_requested_at = COALESCE(cancel_requested_at, ?),
            cancel_origin = COALESCE(cancel_origin, 'reconcile'),
            provider_submit_state = 'orphan_suspected',
            updated_date = CURRENT_TIMESTAMP
        WHERE status IN ('dispatching', 'running')
          AND provider_submit_state IN ('in_flight', 'accepted', 'orphan_suspected', 'cancel_sent')
      `).run(nowIso).changes

      // 아직 확정하지 않은 잡의 history 를 미리 error 로 만들지 않는다.
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
      const expiredOrphanHistoryRecords = GenerationHistoryModel.recordErrorByQueueJobIds(
        expiredOrphanJobIds,
        'Backend restarted while upstream work may have been running, and it could not be recovered in time.',
      )

      return {
        cancelledBeforeDispatch,
        failedDispatching,
        failedRunning,
        failedExpiredOrphans,
        orphanSuspected,
        failedHistoryRecords: cancelledHistoryRecords
          + failedDispatchingHistoryRecords
          + failedRunningHistoryRecords
          + expiredOrphanHistoryRecords,
      }
    })

    return recoveryTransaction()
  }

  private static async dispatchTick() {
    if (!this.started) {
      return
    }

    try {
      this.finalizeAbandonedCancellations()
    } catch (error) {
      console.error('❌ Failed to finalize abandoned queue cancellations:', error)
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
    // 이 워커가 잡의 취소 시그널 소유자다. 스테일 스위퍼도 이 소유권으로 확정 주체를 가른다.
    const controller = queueCancellationRegistry.register(job.id)

    try {
      await executeGenerationQueueJob(job, assignedServer ?? null, {
        transitionJob: (id, nextStatus, options) => this.transitionJob(id, nextStatus, options),
        attemptUpstreamCancellation: (jobId, options) => this.attemptUpstreamCancellation(jobId, options),
        signal: controller.signal,
      })
    } catch (error) {
      if (isGenerationQueueCancellationError(error) || GenerationQueueModel.readCancelState(job.id)?.cancelRequested === true) {
        await this.cancelJobIfActive(job.id)
        return
      }

      await this.failJobIfActive(job.id, error)
      throw error
    } finally {
      queueCancellationRegistry.release(job.id)
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
        // 실행기가 특정한 실패 코드(예: nai_submit_ambiguous)를 붙였으면 그대로 보존한다.
        failureCode: resolveQueueFailureCode(error) ?? 'execution_failed',
        failureMessage: resolveQueueFailureMessage(error) ?? resolveFailureMessage(error),
      })
    } catch (transitionError) {
      console.warn(`⚠️ Failed to mark queue job ${jobId} as failed:`, transitionError)
    }
  }
}
