import { getToken } from '../utils/nai/auth'
import { getUserSettingsDb } from '../database/userSettingsDb'
import { WorkflowModel } from '../models/Workflow'
import { GenerationHistoryModel, type ServiceType } from '../models/GenerationHistory'
import { GenerationQueueModel } from '../models/GenerationQueue'
import { ComfyUIServerModel } from '../models/ComfyUIServer'
import { GenerationHistoryService } from './generationHistoryService'
import { createComfyUIService, getComfyUIServerRuntimeStatuses } from './comfyuiService'
import { isGenerationQueueComfyJobCompatibleWithServer } from './generationQueueRouting'
import { prepareComfyPromptData } from './prepareComfyPromptData'
import { resolveWorkflowPromptValues } from './workflowPromptValueResolver'
import { executeComfyGeneration, isComfyGenerationCancelledError } from './comfyGenerationExecutor'
import { executeNaiGeneration } from './naiGenerationExecutor'
import { executeCodexGeneration, type CodexGenerationPayload } from './codexGenerationExecutor'
import { ComfyUIWorkflowParser } from '../utils/comfyuiWorkflowParser'
import { reconcileComfyModelSelectionValues } from './comfyModelSelectionResolver'
import { getComfyRequestDebugRelativePath, writeComfyRequestDebugSnapshot, type ComfyRequestDebugSnapshot } from './generationRequestDebugService'
import { FileDiscoveryService } from './folderScan/fileDiscoveryService'
import { settingsService } from './settingsService'
import { ImageUploadService } from './imageUploadService'
import { WildcardService } from './wildcardService'
import type { GeneratedImageSaveOptions } from '../utils/fileSaver'
import type { AIMetadata } from './metadata/types'
import type { ComfyUIServerRecord } from '../types/comfyuiServer'
import type { NAIMetadataInputParams } from '../utils/nai/metadata'
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
const GENERATION_QUEUE_CANCELLATION_MESSAGE = '__GENERATION_QUEUE_CANCELLATION__'

type ThrottledServiceType = 'novelai' | 'codex'
type ServiceThrottleState = {
  completedSinceCooldown: number
  cooldownUntil: number | null
}

function parseStoredRequestPayload(record: GenerationQueueJobRecord) {
  try {
    const parsed = JSON.parse(record.request_payload) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Stored request payload must be an object')
    }

    return parsed as Record<string, unknown>
  } catch (error) {
    throw new Error(`Queue job ${record.id} has invalid request_payload: ${error instanceof Error ? error.message : 'unknown parse error'}`)
  }
}

function resolveFailureMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown queue execution error'
}

function isGenerationQueueCancellationError(error: unknown) {
  return error instanceof Error && error.message === GENERATION_QUEUE_CANCELLATION_MESSAGE
}

function parseComfyQueuePayload(record: GenerationQueueJobRecord) {
  const payload = parseStoredRequestPayload(record)
  const promptData = payload.prompt_data
  if (!promptData || typeof promptData !== 'object' || Array.isArray(promptData)) {
    throw new Error(`Queue job ${record.id} is missing object request_payload.prompt_data for ComfyUI execution`)
  }

  const imageSaveOptions = payload.imageSaveOptions
  if (imageSaveOptions !== undefined && (!imageSaveOptions || typeof imageSaveOptions !== 'object' || Array.isArray(imageSaveOptions))) {
    throw new Error(`Queue job ${record.id} has invalid request_payload.imageSaveOptions`)
  }

  return {
    promptData: promptData as Record<string, any>,
    imageSaveOptions: imageSaveOptions as GeneratedImageSaveOptions | undefined,
  }
}

function parseNaiQueuePayload(record: GenerationQueueJobRecord) {
  const payload = parseStoredRequestPayload(record)
  return payload as unknown as NAIMetadataInputParams & { imageSaveOptions?: GeneratedImageSaveOptions }
}

function parseCodexWildcardText(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  return WildcardService.parseWildcards(trimmed, 'codex')
}

function parseCodexQueuePayload(record: GenerationQueueJobRecord) {
  const payload = parseStoredRequestPayload(record)
  const prompt = parseCodexWildcardText(payload.prompt)
  if (!prompt) {
    throw new Error(`Queue job ${record.id} is missing string request_payload.prompt for Codex execution`)
  }

  const imageSaveOptions = payload.imageSaveOptions
  if (imageSaveOptions !== undefined && (!imageSaveOptions || typeof imageSaveOptions !== 'object' || Array.isArray(imageSaveOptions))) {
    throw new Error(`Queue job ${record.id} has invalid request_payload.imageSaveOptions`)
  }

  const rawCountSource = payload.count ?? payload.n
  const rawCount = typeof rawCountSource === 'number' ? rawCountSource : Number(rawCountSource)
  const count = Number.isInteger(rawCount) ? Math.max(1, Math.min(rawCount, 4)) : 1
  const operation: CodexGenerationPayload['operation'] = payload.operation === 'edit' || payload.operation === 'infill' ? payload.operation : 'generate'
  const background: CodexGenerationPayload['background'] = payload.background === 'transparent' || payload.background === 'opaque' ? payload.background : 'auto'
  const outputFormat: CodexGenerationPayload['output_format'] = payload.output_format === 'jpeg' || payload.output_format === 'webp' ? payload.output_format : 'png'

  return {
    prompt,
    model: typeof payload.model === 'string' && payload.model.trim().length > 0 ? payload.model.trim() : undefined,
    negative_prompt: parseCodexWildcardText(payload.negative_prompt),
    size: typeof payload.size === 'string' && payload.size.trim().length > 0 ? payload.size.trim() : undefined,
    quality: typeof payload.quality === 'string' && payload.quality.trim().length > 0 ? payload.quality.trim() : undefined,
    background,
    output_format: outputFormat,
    count,
    operation,
    image: typeof payload.image === 'string' && payload.image.trim().length > 0 ? payload.image : undefined,
    mask: typeof payload.mask === 'string' && payload.mask.trim().length > 0 ? payload.mask : undefined,
    imageSaveOptions: imageSaveOptions as GeneratedImageSaveOptions | undefined,
  }
}

function buildCodexMetadataPatch(payload: CodexGenerationPayload, outputIndex: number, totalCount: number, lastMessage: string | null): Partial<AIMetadata> {
  const sizeMatch = typeof payload.size === 'string' ? /^(\d{2,5})x(\d{2,5})$/i.exec(payload.size.trim()) : null
  const width = sizeMatch ? Number(sizeMatch[1]) : undefined
  const height = sizeMatch ? Number(sizeMatch[2]) : undefined

  return {
    ai_tool: 'codex',
    software: 'Codex CLI',
    model: payload.model || 'codex',
    prompt: payload.prompt,
    positive_prompt: payload.prompt,
    negative_prompt: payload.negative_prompt,
    width,
    height,
    batch_size: totalCount,
    batch_index: outputIndex,
    codex_operation: payload.operation ?? 'generate',
    codex_quality: payload.quality,
    codex_background: payload.background,
    codex_output_format: payload.output_format,
    codex_last_message: lastMessage ?? undefined,
  }
}

function updateQueueRequestDebugMeta(record: GenerationQueueJobRecord, meta: Record<string, unknown>) {
  try {
    const latestRecord = GenerationQueueModel.findById(record.id) ?? record
    const payload = parseStoredRequestPayload(latestRecord)
    const currentDebug = payload._debug && typeof payload._debug === 'object' && !Array.isArray(payload._debug)
      ? payload._debug as Record<string, unknown>
      : {}

    GenerationQueueModel.update(record.id, {
      request_payload: {
        ...payload,
        _debug: {
          ...currentDebug,
          ...meta,
        },
      },
    })
  } catch (error) {
    console.warn(`⚠️ Failed to persist queue debug metadata for job ${record.id}:`, error)
  }
}

async function writeQueueComfyDebugSnapshot(record: GenerationQueueJobRecord, snapshot: ComfyRequestDebugSnapshot) {
  try {
    const saved = await writeComfyRequestDebugSnapshot(record.id, snapshot)
    updateQueueRequestDebugMeta(record, {
      comfy_request_log_path: saved.relativePath,
      comfy_request_captured_at: snapshot.captured_at,
      comfy_request_stage: snapshot.stage,
      comfy_prompt_id: snapshot.prompt_id ?? null,
      comfy_endpoint: snapshot.endpoint ?? null,
    })
    return saved
  } catch (error) {
    console.warn(`⚠️ Failed to write ComfyUI request debug snapshot for job ${record.id}:`, error)
    return {
      absolutePath: null,
      relativePath: getComfyRequestDebugRelativePath(record.id),
    }
  }
}

function hasQueuedComfyJobs() {
  return GenerationQueueModel.findAll(['queued']).some((record) => record.service_type === 'comfyui' && record.cancel_requested === 0)
}


export class GenerationQueueService {
  private static started = false
  private static dispatcherHandle: ReturnType<typeof setInterval> | null = null
  private static dispatchTickScheduled = false
  private static activeWorkerKeys = new Set<string>()
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
    if (this.dispatcherHandle) {
      clearInterval(this.dispatcherHandle)
      this.dispatcherHandle = null
    }
    this.activeWorkerKeys.clear()
    this.serviceThrottleState = {
      novelai: { completedSinceCooldown: 0, cooldownUntil: null },
      codex: { completedSinceCooldown: 0, cooldownUntil: null },
    }
    return true
  }

  /** Schedule one dispatcher pass without waiting for the next poll interval. */
  static requestDispatch() {
    if (!this.started || this.dispatchTickScheduled) {
      return false
    }

    this.dispatchTickScheduled = true
    queueMicrotask(() => {
      this.dispatchTickScheduled = false
      if (!this.started) {
        return
      }

      void this.dispatchTick()
    })

    return true
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
    const endpoint = this.resolveComfyCancellationEndpoint(latest, options?.assignedServer)
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

    const comfyService = createComfyUIService(endpoint)
    const result = await comfyService.cancelPrompt(promptId)
    updateQueueRequestDebugMeta(latest, {
      cancellation_requested_at: requestedAt,
      cancellation_endpoint: endpoint,
      cancellation_prompt_id: promptId,
      cancellation_state: result.interrupted || result.deleted ? 'requested' : 'not_found',
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

    return GenerationQueueModel.findById(id)
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

  private static async tryStartComfyWorkers() {
    const activeServers = ComfyUIServerModel.findActiveServers()

    if (activeServers.length === 0) {
      return
    }

    if (!hasQueuedComfyJobs()) {
      return
    }

    const queuedJobs = GenerationQueueModel.findAll(['queued']).filter((record) => record.service_type === 'comfyui' && record.cancel_requested === 0)
    if (queuedJobs.length === 0) {
      return
    }

    for (const job of queuedJobs) {
      const hasCompatibleServer = activeServers.some((server) => isGenerationQueueComfyJobCompatibleWithServer(job, server, activeServers))
      if (hasCompatibleServer) {
        continue
      }

      await this.failJobIfActive(job.id, new Error(`No active linked ComfyUI server matches this job target for workflow ${job.workflow_id ?? 'unknown'}`))
    }

    const runnableQueuedJobs = GenerationQueueModel.findAll(['queued']).filter((record) => record.service_type === 'comfyui' && record.cancel_requested === 0)
    if (runnableQueuedJobs.length === 0) {
      return
    }

    const runtimeStatuses = await getComfyUIServerRuntimeStatuses(activeServers)
    const statusByServerId = new Map(runtimeStatuses.map((status) => [status.server_id, status]))
    const reservedJobIds = new Set<number>()

    for (const server of activeServers) {
      const workerKey = `comfyui:${server.id}`
      if (this.activeWorkerKeys.has(workerKey)) {
        continue
      }

      const runtimeStatus = statusByServerId.get(server.id)
      if (!runtimeStatus?.is_connected) {
        console.log(`⏭️ Skipping ComfyUI server ${server.name} (${server.id}), unreachable`)
        continue
      }

      if (runtimeStatus.is_idle !== true) {
        console.log(
          `⏭️ Skipping ComfyUI server ${server.name} (${server.id}), busy (running=${runtimeStatus.running_count ?? 0}, pending=${runtimeStatus.pending_count ?? 0})`,
        )
        continue
      }

      const candidateJob = runnableQueuedJobs.find((job) => !reservedJobIds.has(job.id) && isGenerationQueueComfyJobCompatibleWithServer(job, server, activeServers))
      if (!candidateJob) {
        continue
      }

      const job = this.claimQueuedJobForDispatch(candidateJob.id, server.id)
      if (!job) {
        continue
      }

      reservedJobIds.add(job.id)
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

  private static async runClaimedJob(job: GenerationQueueJobRecord, assignedServer?: ComfyUIServerRecord | null) {
    try {
      if (job.service_type === 'comfyui') {
        await this.executeComfyUiJob(job, assignedServer ?? null)
        return
      }

      if (job.service_type === 'novelai') {
        await this.executeNovelAiJob(job)
        return
      }

      if (job.service_type === 'codex') {
        await this.executeCodexJob(job)
        return
      }

      throw new Error(`Unsupported queue service type: ${job.service_type}`)
    } catch (error) {
      if (isGenerationQueueCancellationError(error) || (GenerationQueueModel.findById(job.id)?.cancel_requested ?? 0) > 0) {
        await this.cancelJobIfActive(job.id)
        return
      }

      await this.failJobIfActive(job.id, error)
      throw error
    }
  }

  private static async executeComfyUiJob(job: GenerationQueueJobRecord, assignedServer: ComfyUIServerRecord | null) {
    if (!job.workflow_id) {
      throw new Error(`Queue job ${job.id} is missing workflow_id for ComfyUI execution`)
    }

    const workflow = WorkflowModel.findById(job.workflow_id)
    if (!workflow) {
      throw new Error(`Queue job ${job.id} references missing workflow ${job.workflow_id}`)
    }

    if (!workflow.is_active) {
      throw new Error(`Queue job ${job.id} references inactive workflow ${job.workflow_id}`)
    }

    const payload = parseComfyQueuePayload(job)
    const apiEndpoint = assignedServer?.endpoint ?? workflow.api_endpoint
    const comfyService = createComfyUIService(apiEndpoint)
    const markedFields = workflow.marked_fields ? JSON.parse(workflow.marked_fields) : []
    const preparedPromptData = await prepareComfyPromptData(comfyService, markedFields, payload.promptData)
    const parsedPromptData = resolveWorkflowPromptValues(markedFields, preparedPromptData, 'comfyui')
    const resolvedPromptData = await reconcileComfyModelSelectionValues(workflow.workflow_json, markedFields, parsedPromptData, comfyService)
    const substitutedWorkflow = comfyService.substitutePromptData(
      workflow.workflow_json,
      markedFields,
      resolvedPromptData,
    )

    let historyId: number | undefined
    try {
      historyId = await GenerationHistoryService.createComfyUIHistory({
        workflowId: workflow.id,
        workflowName: workflow.name,
        groupId: job.requested_group_id ?? undefined,
        queueJobId: job.id,
        requestedByAccountId: job.requested_by_account_id ?? undefined,
        requestedByAccountType: job.requested_by_account_type ?? undefined,
        serverId: assignedServer?.id ?? job.assigned_server_id ?? undefined,
      })
    } catch (historyError) {
      console.error(`⚠️ Failed to create ComfyUI queue history for job ${job.id}:`, historyError)
    }

    updateQueueRequestDebugMeta(job, {
      history_id: historyId ?? null,
      workflow_id: workflow.id,
      workflow_name: workflow.name,
      server_id: assignedServer?.id ?? job.assigned_server_id ?? null,
      server_name: assignedServer?.name ?? null,
      endpoint: apiEndpoint,
    })

    const debugSnapshotBase = {
      service_type: 'comfyui' as const,
      queue_job_id: job.id,
      history_id: historyId ?? null,
      workflow_id: workflow.id,
      workflow_name: workflow.name,
      server_id: assignedServer?.id ?? job.assigned_server_id ?? null,
      server_name: assignedServer?.name ?? null,
      endpoint: apiEndpoint,
      raw_prompt_data: payload.promptData,
      prepared_prompt_data: preparedPromptData,
      resolved_prompt_data: resolvedPromptData,
      request_body: {
        prompt: substitutedWorkflow,
      },
    }

    const preparedDebugLog = await writeQueueComfyDebugSnapshot(job, {
      ...debugSnapshotBase,
      stage: 'prepared',
      captured_at: new Date().toISOString(),
    })

    console.log(`🧾 Queue job ${job.id} ComfyUI request snapshot: ${preparedDebugLog.relativePath}`)

    try {
      const result = await executeComfyGeneration({
        comfyService,
        workflow: substitutedWorkflow,
        imageSaveOptions: payload.imageSaveOptions,
        shouldCancel: () => (GenerationQueueModel.findById(job.id)?.cancel_requested ?? 0) > 0,
        onCancelRequested: async (promptId) => {
          await this.attemptUpstreamCancellation(job.id, {
            assignedServer,
            providerJobId: promptId,
          })
        },
        onPromptSubmitted: async (promptId) => {
          this.transitionJob(job.id, 'running', {
            assignedServerId: assignedServer?.id ?? job.assigned_server_id ?? null,
            expectedCurrentStatuses: ['dispatching'],
            providerJobId: promptId,
          })

          await writeQueueComfyDebugSnapshot(job, {
            ...debugSnapshotBase,
            stage: 'submitted',
            captured_at: new Date().toISOString(),
            prompt_id: promptId,
          })

          if (!historyId) {
            return
          }

          GenerationHistoryModel.update(historyId, {
            generation_status: 'processing',
          })
        },
      })

      if (!result.representativeImage) {
        throw new Error(`Queue job ${job.id} finished ComfyUI execution but no representative output was saved`)
      }

      if (historyId) {
        GenerationHistoryModel.updateImagePaths(historyId, {
          compositeHash: result.representativeImage.compositeHash,
        })
        GenerationHistoryModel.updateStatus(historyId, 'completed')
      }

      updateQueueRequestDebugMeta(job, {
        history_id: historyId ?? null,
        result_prompt_id: result.promptId,
        result_composite_hash: result.representativeImage.compositeHash,
        result_original_path: result.representativeImage.originalPath,
        result_file_size: result.representativeImage.fileSize,
        result_mime_type: FileDiscoveryService.getMimeType(result.representativeImage.originalPath),
        attempted_image_count: result.attemptedImageCount,
        saved_image_count: result.savedImageCount,
      })

      await writeQueueComfyDebugSnapshot(job, {
        ...debugSnapshotBase,
        stage: 'completed',
        captured_at: new Date().toISOString(),
        prompt_id: result.promptId,
      })

      this.transitionJob(job.id, 'completed', {
        expectedCurrentStatuses: ['running'],
      })

      console.log(`✅ Queue job ${job.id} completed via ComfyUI (${result.savedImageCount}/${result.attemptedImageCount} outputs saved)`)
    } catch (error) {
      const cancellationRequested = isComfyGenerationCancelledError(error) || (GenerationQueueModel.findById(job.id)?.cancel_requested ?? 0) > 0
      if (cancellationRequested) {
        await writeQueueComfyDebugSnapshot(job, {
          ...debugSnapshotBase,
          stage: 'cancelled',
          captured_at: new Date().toISOString(),
          prompt_id: GenerationQueueModel.findById(job.id)?.provider_job_id ?? null,
          error_message: 'Queue job cancelled before ComfyUI output handoff completed',
        })

        if (historyId) {
          GenerationHistoryModel.recordError(historyId, 'Cancelled by user')
        }

        throw new Error(GENERATION_QUEUE_CANCELLATION_MESSAGE)
      }

      const failureMessage = resolveFailureMessage(error)
      await writeQueueComfyDebugSnapshot(job, {
        ...debugSnapshotBase,
        stage: 'failed',
        captured_at: new Date().toISOString(),
        error_message: failureMessage,
      })

      if (historyId) {
        GenerationHistoryModel.recordError(historyId, failureMessage)
      }
      throw error
    }
  }

  private static async executeNovelAiJob(job: GenerationQueueJobRecord) {
    const token = getToken()
    if (!token) {
      throw new Error('NovelAI queue execution requires a configured backend token')
    }

    const payload = parseNaiQueuePayload(job)
    const requestInput: NAIMetadataInputParams = {
      ...payload,
      groupId: job.requested_group_id ?? payload.groupId,
    }

    let placeholderHistoryId: number | null = null
    try {
      placeholderHistoryId = await GenerationHistoryService.createNAIHistory({
        model: requestInput.model || 'nai-diffusion-4-5-curated',
        groupId: job.requested_group_id ?? requestInput.groupId,
        queueJobId: job.id,
        requestedByAccountId: job.requested_by_account_id ?? undefined,
        requestedByAccountType: job.requested_by_account_type ?? undefined,
        serverId: job.assigned_server_id ?? undefined,
      })
    } catch (historyError) {
      console.error(`⚠️ Failed to create NovelAI queue history for job ${job.id}:`, historyError)
    }

    try {
      const { metadata, imageBuffers } = await executeNaiGeneration(requestInput, token, {
        onUpstreamAccepted: async () => {
          this.transitionJob(job.id, 'running', {
            expectedCurrentStatuses: ['dispatching'],
          })

          if (placeholderHistoryId) {
            GenerationHistoryModel.updateStatus(placeholderHistoryId, 'processing')
          }
        },
      })
      if (imageBuffers.length === 0) {
        throw new Error(`Queue job ${job.id} returned no NovelAI images`)
      }

      const historyIds: number[] = []
      const processPromises: Promise<void>[] = []

      for (let index = 0; index < imageBuffers.length; index += 1) {
        let historyId: number
        if (index === 0 && placeholderHistoryId) {
          historyId = placeholderHistoryId
          GenerationHistoryModel.update(historyId, {
            nai_model: metadata.model || 'unknown',
            assigned_group_id: job.requested_group_id ?? metadata.groupId,
            requested_by_account_id: job.requested_by_account_id ?? undefined,
            requested_by_account_type: job.requested_by_account_type ?? undefined,
            server_id: job.assigned_server_id ?? undefined,
          })
        } else {
          historyId = await GenerationHistoryService.createNAIHistory({
            model: metadata.model || 'unknown',
            groupId: job.requested_group_id ?? metadata.groupId,
            queueJobId: job.id,
            requestedByAccountId: job.requested_by_account_id ?? undefined,
            requestedByAccountType: job.requested_by_account_type ?? undefined,
            serverId: job.assigned_server_id ?? undefined,
          })
        }

        historyIds.push(historyId)
        processPromises.push(
          GenerationHistoryService.processAndUploadImage(historyId, imageBuffers[index], 'novelai', payload.imageSaveOptions),
        )
      }

      await Promise.all(processPromises)

      this.transitionJob(job.id, 'completed', {
        expectedCurrentStatuses: ['running'],
      })

      console.log(`✅ Queue job ${job.id} completed via NovelAI (${historyIds.length} histories)`)
    } catch (error) {
      if (placeholderHistoryId) {
        const latestQueue = GenerationQueueModel.findById(job.id)
        const failureMessage = latestQueue?.status === 'cancelled' || (latestQueue?.cancel_requested ?? 0) > 0
          ? 'Cancelled by user'
          : resolveFailureMessage(error)
        const placeholderHistory = GenerationHistoryModel.findById(placeholderHistoryId)
        if (placeholderHistory && placeholderHistory.generation_status !== 'completed') {
          GenerationHistoryModel.recordError(placeholderHistoryId, failureMessage)
        }
      }

      throw error
    }
  }

  private static async executeCodexJob(job: GenerationQueueJobRecord) {
    const payload = parseCodexQueuePayload(job)

    let placeholderHistoryId: number | null = null
    try {
      placeholderHistoryId = await GenerationHistoryService.createCodexHistory({
        model: payload.model || 'codex',
        prompt: payload.prompt,
        negativePrompt: payload.negative_prompt,
        groupId: job.requested_group_id ?? undefined,
        queueJobId: job.id,
        requestedByAccountId: job.requested_by_account_id ?? undefined,
        requestedByAccountType: job.requested_by_account_type ?? undefined,
      })
    } catch (historyError) {
      console.error(`⚠️ Failed to create Codex queue history for job ${job.id}:`, historyError)
    }

    try {
      this.transitionJob(job.id, 'running', {
        expectedCurrentStatuses: ['dispatching'],
      })

      if (placeholderHistoryId) {
        GenerationHistoryModel.updateStatus(placeholderHistoryId, 'processing')
      }

      const result = await executeCodexGeneration(payload)
      if (result.outputFiles.length === 0) {
        throw new Error(`Queue job ${job.id} finished Codex execution but no outputs were discovered`)
      }

      const historyIds: number[] = []
      const processPromises: Promise<void>[] = []

      for (let index = 0; index < result.outputFiles.length; index += 1) {
        const output = result.outputFiles[index]
        let historyId: number

        if (index === 0 && placeholderHistoryId) {
          historyId = placeholderHistoryId
          GenerationHistoryModel.update(historyId, {
            metadata: JSON.stringify({
              codex_job_directory: result.jobDirectory,
              codex_output_file: output.absolutePath,
              codex_last_message: result.lastMessage,
            }),
          })
        } else {
          historyId = await GenerationHistoryService.createCodexHistory({
            model: payload.model || 'codex',
            prompt: payload.prompt,
            negativePrompt: payload.negative_prompt,
            groupId: job.requested_group_id ?? undefined,
            queueJobId: job.id,
            requestedByAccountId: job.requested_by_account_id ?? undefined,
            requestedByAccountType: job.requested_by_account_type ?? undefined,
            metadata: {
              codex_job_directory: result.jobDirectory,
              codex_output_file: output.absolutePath,
              codex_last_message: result.lastMessage,
            },
          })
        }

        historyIds.push(historyId)
        processPromises.push(
          GenerationHistoryService.processAndUploadGeneratedFile(historyId, output.absolutePath, 'codex', {
            ...payload.imageSaveOptions,
            sourcePathForMetadata: output.absolutePath,
            sourceMimeType: output.mimeType,
            originalFileName: output.absolutePath.split(/[/\\]/).pop(),
            metadataPatch: buildCodexMetadataPatch(payload, index, result.outputFiles.length, result.lastMessage),
          }),
        )
      }

      await Promise.all(processPromises)

      const representativeHistory = historyIds
        .map((historyId) => GenerationHistoryModel.findById(historyId))
        .find((history) => Boolean(history?.composite_hash))
        ?? (historyIds.length > 0 ? GenerationHistoryModel.findById(historyIds[0]) : null)
      const representativeCompositeHash = representativeHistory?.composite_hash ?? null
      const representativeOriginalPath = representativeCompositeHash
        ? ImageUploadService.getActiveFilePath(representativeCompositeHash)
        : null

      updateQueueRequestDebugMeta(job, {
        history_ids: historyIds,
        codex_job_directory: result.jobDirectory,
        codex_stdout_path: result.stdoutPath,
        codex_stderr_path: result.stderrPath,
        codex_last_message: result.lastMessage,
        attempted_image_count: payload.count ?? result.outputFiles.length,
        saved_image_count: result.outputFiles.length,
        result_mime_types: result.outputFiles.map((output) => output.mimeType),
        result_composite_hash: representativeCompositeHash,
        result_original_path: representativeOriginalPath,
        result_mime_type: representativeOriginalPath ? FileDiscoveryService.getMimeType(representativeOriginalPath) : null,
      })

      this.transitionJob(job.id, 'completed', {
        expectedCurrentStatuses: ['running'],
      })

      console.log(`✅ Queue job ${job.id} completed via Codex (${historyIds.length} histories)`)
    } catch (error) {
      if (placeholderHistoryId) {
        const latestQueue = GenerationQueueModel.findById(job.id)
        const failureMessage = latestQueue?.status === 'cancelled' || (latestQueue?.cancel_requested ?? 0) > 0
          ? 'Cancelled by user'
          : resolveFailureMessage(error)
        const placeholderHistory = GenerationHistoryModel.findById(placeholderHistoryId)
        if (placeholderHistory && placeholderHistory.generation_status !== 'completed') {
          GenerationHistoryModel.recordError(placeholderHistoryId, failureMessage)
        }
      }

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
