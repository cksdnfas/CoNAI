import { getToken } from '../utils/nai/auth'
import { getUserSettingsDb } from '../database/userSettingsDb'
import { WorkflowModel } from '../models/Workflow'
import { GenerationHistoryModel, type ServiceType } from '../models/GenerationHistory'
import { GenerationQueueModel } from '../models/GenerationQueue'
import { ComfyUIServerModel, WorkflowServerModel } from '../models/ComfyUIServer'
import { GenerationHistoryService } from './generationHistoryService'
import { createComfyUIService, getComfyUIServerRuntimeStatuses } from './comfyuiService'
import { prepareComfyPromptData } from './prepareComfyPromptData'
import { resolveWorkflowPromptValues } from './workflowPromptValueResolver'
import { executeComfyGeneration } from './comfyGenerationExecutor'
import { executeNaiGeneration } from './naiGenerationExecutor'
import { ComfyUIWorkflowParser } from '../utils/comfyuiWorkflowParser'
import type { GeneratedImageSaveOptions } from '../utils/fileSaver'
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

function hasQueuedComfyJobs() {
  return GenerationQueueModel.findAll(['queued']).some((record) => record.service_type === 'comfyui' && record.cancel_requested === 0)
}

function getServerRoutingTags(server: ComfyUIServerRecord) {
  return new Set((server.routing_tags ?? []).map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0))
}

function getWorkflowAllowedServerIds(workflowId: number | null | undefined, activeServers: ComfyUIServerRecord[]) {
  if (!workflowId) {
    return []
  }

  return WorkflowServerModel.findServersByWorkflow(workflowId, true)
    .map((server) => Number(server.id))
    .filter((serverId) => Number.isInteger(serverId) && activeServers.some((server) => server.id === serverId))
}

function isComfyJobCompatibleWithServer(job: GenerationQueueJobRecord, server: ComfyUIServerRecord, activeServers: ComfyUIServerRecord[]) {
  if (job.service_type !== 'comfyui' || job.cancel_requested > 0) {
    return false
  }

  const allowedServerIds = getWorkflowAllowedServerIds(job.workflow_id, activeServers)
  if (!allowedServerIds.includes(server.id)) {
    return false
  }

  if (job.requested_server_id !== null && job.requested_server_id !== undefined) {
    return job.requested_server_id === server.id
  }

  if (job.requested_server_tag) {
    return getServerRoutingTags(server).has(job.requested_server_tag)
  }

  return true
}

export class GenerationQueueService {
  private static started = false
  private static dispatcherHandle: ReturnType<typeof setInterval> | null = null
  private static dispatchTickScheduled = false
  private static activeWorkerKeys = new Set<string>()

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
    await this.tryStartComfyWorkers()
  }

  private static tryStartNovelAiWorker() {
    if (this.activeWorkerKeys.has(NAI_WORKER_KEY)) {
      return
    }

    const job = this.claimNextDispatchableJob({ serviceType: 'novelai' })
    if (!job) {
      return
    }

    this.activeWorkerKeys.add(NAI_WORKER_KEY)
    void this.runClaimedJob(job)
      .catch((error) => {
        console.error(`❌ NovelAI queue worker failed for job ${job.id}:`, error)
      })
      .finally(() => {
        this.activeWorkerKeys.delete(NAI_WORKER_KEY)
        this.requestDispatch()
      })
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
      const hasCompatibleServer = activeServers.some((server) => isComfyJobCompatibleWithServer(job, server, activeServers))
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

      const candidateJob = runnableQueuedJobs.find((job) => !reservedJobIds.has(job.id) && isComfyJobCompatibleWithServer(job, server, activeServers))
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

      throw new Error(`Unsupported queue service type: ${job.service_type}`)
    } catch (error) {
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
    const resolvedPromptData = resolveWorkflowPromptValues(markedFields, preparedPromptData, 'comfyui')
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

    try {
      const result = await executeComfyGeneration({
        comfyService,
        workflow: substitutedWorkflow,
        imageSaveOptions: payload.imageSaveOptions,
        onPromptSubmitted: async (promptId) => {
          this.transitionJob(job.id, 'running', {
            assignedServerId: assignedServer?.id ?? job.assigned_server_id ?? null,
            expectedCurrentStatuses: ['dispatching'],
            providerJobId: promptId,
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
        throw new Error(`Queue job ${job.id} finished ComfyUI execution but no representative image was saved`)
      }

      if (historyId) {
        GenerationHistoryModel.updateImagePaths(historyId, {
          compositeHash: result.representativeImage.compositeHash,
        })
        GenerationHistoryModel.updateStatus(historyId, 'completed')
      }

      this.transitionJob(job.id, 'completed', {
        expectedCurrentStatuses: ['running'],
      })

      console.log(`✅ Queue job ${job.id} completed via ComfyUI (${result.savedImageCount}/${result.attemptedImageCount} saved)`)
    } catch (error) {
      if (historyId) {
        GenerationHistoryModel.recordError(historyId, resolveFailureMessage(error))
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

    const { metadata, imageBuffers } = await executeNaiGeneration(requestInput, token, {
      onUpstreamAccepted: async () => {
        this.transitionJob(job.id, 'running', {
          expectedCurrentStatuses: ['dispatching'],
        })
      },
    })
    if (imageBuffers.length === 0) {
      throw new Error(`Queue job ${job.id} returned no NovelAI images`)
    }

    const historyIds: number[] = []
    const processPromises: Promise<void>[] = []

    for (let index = 0; index < imageBuffers.length; index += 1) {
      const historyId = await GenerationHistoryService.createNAIHistory({
        model: metadata.model || 'unknown',
        groupId: job.requested_group_id ?? metadata.groupId,
        queueJobId: job.id,
        requestedByAccountId: job.requested_by_account_id ?? undefined,
        requestedByAccountType: job.requested_by_account_type ?? undefined,
        serverId: job.assigned_server_id ?? undefined,
      })

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
