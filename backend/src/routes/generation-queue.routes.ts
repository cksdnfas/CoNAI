import express, { Request, Response } from 'express'
import { asyncHandler } from '../middleware/errorHandler'
import { GenerationQueueModel } from '../models/GenerationQueue'
import { ComfyUIServerModel, WorkflowServerModel } from '../models/ComfyUIServer'
import { WorkflowModel } from '../models/Workflow'
import {
  normalizeGenerationQueueRoutingTag,
  resolveGenerationQueueLaneMeta,
} from '../services/generationQueueRouting'
import { GenerationQueueService } from '../services/generationQueueService'
import type { GenerationQueueJobRecord, GenerationQueueJobStatus } from '../types/generationQueue'

const router = express.Router()

const ACTIVE_QUEUE_STATUSES: GenerationQueueJobStatus[] = ['queued', 'dispatching', 'running']
const TERMINAL_QUEUE_STATUSES: GenerationQueueJobStatus[] = ['completed', 'failed', 'cancelled']
type QueuePositionScope = 'service' | 'server' | 'tag' | 'auto'
type QueuePositionEntry = { position: number; scope: QueuePositionScope; serverId: number | null; serverTag: string | null; eligibleServerIds: number[] }
type QueueEtaEntry = { waitSeconds: number | null; totalSeconds: number | null; durationSeconds: number | null }

function parseStatusList(value: unknown): GenerationQueueJobStatus[] | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined
  }

  const accepted = new Set<GenerationQueueJobStatus>(['queued', 'dispatching', 'running', 'completed', 'failed', 'cancelled'])
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  const invalid = entries.filter((entry) => !accepted.has(entry as GenerationQueueJobStatus))
  if (invalid.length > 0) {
    throw new Error(`Invalid queue status filter: ${invalid.join(', ')}`)
  }

  return entries.length > 0 ? entries as GenerationQueueJobStatus[] : undefined
}

function parseServiceType(value: unknown): GenerationQueueJobRecord['service_type'] | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined
  }

  if (value !== 'comfyui' && value !== 'novelai') {
    throw new Error(`Invalid service_type filter: ${String(value)}`)
  }

  return value
}

function parsePositiveIntegerQuery(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }

  return parsed
}

function parseRequestedServerTag(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new Error('requested_server_tag must be a string')
  }

  const normalized = normalizeGenerationQueueRoutingTag(value)
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized)) {
    throw new Error('requested_server_tag must match /^[a-z0-9][a-z0-9._-]{0,63}$/')
  }

  return normalized
}

function isAdminRequest(req: Request) {
  return req.session?.accountType === 'admin'
}

function getRequesterAccountId(req: Request) {
  return typeof req.session?.accountId === 'number' ? req.session.accountId : null
}

function canAccessJob(req: Request, job: GenerationQueueJobRecord) {
  if (isAdminRequest(req)) {
    return true
  }

  const accountId = getRequesterAccountId(req)
  return accountId !== null && job.requested_by_account_id === accountId
}

function filterQueueRecords(records: GenerationQueueJobRecord[], filters: {
  serviceType?: GenerationQueueJobRecord['service_type']
  workflowId?: number
}) {
  return records.filter((record) => {
    if (filters.serviceType && record.service_type !== filters.serviceType) {
      return false
    }

    if (filters.workflowId !== undefined && record.workflow_id !== filters.workflowId) {
      return false
    }

    return true
  })
}

function computeQueuePositions(records: GenerationQueueJobRecord[], activeComfyServers: ReturnType<typeof ComfyUIServerModel.findActiveServers>) {
  const positions = new Map<number, QueuePositionEntry>()
  const nextByLane = new Map<string, number>()

  for (const record of records) {
    if (record.status !== 'queued' && record.status !== 'dispatching') {
      continue
    }

    const lane = resolveGenerationQueueLaneMeta(record, activeComfyServers)
    const nextPosition = nextByLane.get(lane.laneKey) ?? 1
    positions.set(record.id, {
      position: nextPosition,
      scope: lane.scope,
      serverId: lane.serverId,
      serverTag: lane.serverTag,
      eligibleServerIds: lane.eligibleServerIds,
    })
    nextByLane.set(lane.laneKey, nextPosition + 1)
  }

  return positions
}

function getJobDurationSeconds(record: GenerationQueueJobRecord) {
  if (!record.started_at || !record.completed_at) {
    return null
  }

  const startedAt = new Date(record.started_at).getTime()
  const completedAt = new Date(record.completed_at).getTime()
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt <= startedAt) {
    return null
  }

  const seconds = Math.round((completedAt - startedAt) / 1000)
  if (seconds <= 0 || seconds > 60 * 60) {
    return null
  }

  return seconds
}

function getMedianDurationSeconds(values: number[]) {
  if (values.length === 0) {
    return null
  }

  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null
  }

  const left = sorted[middle - 1]
  const right = sorted[middle]
  if (left === undefined || right === undefined) {
    return sorted[middle] ?? null
  }

  return Math.round((left + right) / 2)
}

function getRecentCompletedDurations(records: GenerationQueueJobRecord[], predicate: (record: GenerationQueueJobRecord) => boolean) {
  const filtered = records
    .filter(predicate)
    .sort((left, right) => String(right.completed_at ?? '').localeCompare(String(left.completed_at ?? '')))

  const durations: number[] = []
  for (const record of filtered) {
    const duration = getJobDurationSeconds(record)
    if (duration !== null) {
      durations.push(duration)
    }
    if (durations.length >= 12) {
      break
    }
  }

  return durations
}

function resolveReferenceDurationSeconds(record: GenerationQueueJobRecord, completedRecords: GenerationQueueJobRecord[], queuePosition: QueuePositionEntry | undefined) {
  if (record.service_type === 'novelai') {
    return getMedianDurationSeconds(getRecentCompletedDurations(completedRecords, (candidate) => candidate.service_type === 'novelai'))
  }

  if (queuePosition?.scope === 'server' && queuePosition.serverId !== null) {
    const serverDurations = getRecentCompletedDurations(completedRecords, (candidate) => (
      candidate.service_type === 'comfyui' && (candidate.assigned_server_id ?? candidate.requested_server_id ?? null) === queuePosition.serverId
    ))
    const serverMedian = getMedianDurationSeconds(serverDurations)
    if (serverMedian !== null) {
      return serverMedian
    }
  }

  return getMedianDurationSeconds(getRecentCompletedDurations(completedRecords, (candidate) => candidate.service_type === 'comfyui'))
}

function getRunningWorkerCount(record: GenerationQueueJobRecord, queuePosition: QueuePositionEntry | undefined, activeRecords: GenerationQueueJobRecord[]) {
  if (record.service_type === 'novelai') {
    return activeRecords.filter((candidate) => candidate.service_type === 'novelai' && candidate.status === 'running').length
  }

  if (queuePosition?.scope === 'server' && queuePosition.serverId !== null) {
    return activeRecords.filter((candidate) => (
      candidate.service_type === 'comfyui'
      && candidate.status === 'running'
      && (candidate.assigned_server_id ?? candidate.requested_server_id ?? null) === queuePosition.serverId
    )).length
  }

  if (!queuePosition || queuePosition.eligibleServerIds.length === 0) {
    return activeRecords.filter((candidate) => candidate.service_type === 'comfyui' && candidate.status === 'running').length
  }

  return activeRecords.filter((candidate) => {
    if (candidate.service_type !== 'comfyui' || candidate.status !== 'running') {
      return false
    }

    const candidateServerId = candidate.assigned_server_id ?? candidate.requested_server_id ?? null
    return candidateServerId !== null && queuePosition.eligibleServerIds.includes(candidateServerId)
  }).length
}

function getLaneCapacity(record: GenerationQueueJobRecord, queuePosition: QueuePositionEntry | undefined, activeComfyServerCount: number) {
  if (record.service_type === 'novelai') {
    return 1
  }

  if (!queuePosition) {
    return Math.max(activeComfyServerCount, 1)
  }

  if (queuePosition.scope === 'server') {
    return 1
  }

  if (queuePosition.eligibleServerIds.length > 0) {
    return Math.max(queuePosition.eligibleServerIds.length, 1)
  }

  return Math.max(activeComfyServerCount, 1)
}

function estimateQueueEta(
  record: GenerationQueueJobRecord,
  queuePosition: QueuePositionEntry | undefined,
  activeRecords: GenerationQueueJobRecord[],
  completedRecords: GenerationQueueJobRecord[],
  activeComfyServerCount: number,
): QueueEtaEntry {
  const durationSeconds = resolveReferenceDurationSeconds(record, completedRecords, queuePosition)
  if (durationSeconds === null) {
    return { waitSeconds: null, totalSeconds: null, durationSeconds: null }
  }

  if (record.status === 'running') {
    const startedAt = record.started_at ? new Date(record.started_at).getTime() : null
    const elapsedSeconds = startedAt && Number.isFinite(startedAt)
      ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
      : 0

    return {
      waitSeconds: 0,
      totalSeconds: Math.max(durationSeconds - elapsedSeconds, 0),
      durationSeconds,
    }
  }

  if (record.status !== 'queued' && record.status !== 'dispatching') {
    return { waitSeconds: null, totalSeconds: null, durationSeconds }
  }

  if (!queuePosition) {
    return { waitSeconds: null, totalSeconds: null, durationSeconds }
  }

  const capacity = getLaneCapacity(record, queuePosition, activeComfyServerCount)
  const runningWorkers = Math.min(getRunningWorkerCount(record, queuePosition, activeRecords), capacity)
  const freeSlots = Math.max(capacity - runningWorkers, 0)
  const startRounds = Math.max(0, Math.ceil((queuePosition.position - freeSlots) / capacity))
  const waitSeconds = startRounds * durationSeconds

  return {
    waitSeconds,
    totalSeconds: waitSeconds + durationSeconds,
    durationSeconds,
  }
}

function computeQueueEtas(
  activeRecords: GenerationQueueJobRecord[],
  queuePositions: Map<number, QueuePositionEntry>,
  completedRecords: GenerationQueueJobRecord[],
  activeComfyServerCount: number,
) {
  const etaById = new Map<number, QueueEtaEntry>()

  for (const record of activeRecords) {
    etaById.set(
      record.id,
      estimateQueueEta(record, queuePositions.get(record.id), activeRecords, completedRecords, activeComfyServerCount),
    )
  }

  return etaById
}

/** GET /api/generation-queue/stats */
router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
  let serviceType: GenerationQueueJobRecord['service_type'] | undefined
  let workflowId: number | undefined
  try {
    serviceType = parseServiceType(req.query.service_type)
    workflowId = parsePositiveIntegerQuery(req.query.workflow_id, 'workflow_id')
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Invalid queue stats filter',
    })
    return
  }

  const requesterAccountId = getRequesterAccountId(req)
  const accessibleRecords = isAdminRequest(req)
    ? GenerationQueueModel.findAll()
    : requesterAccountId === null
      ? []
      : GenerationQueueModel.findByRequester(requesterAccountId)

  const visibleRecords = filterQueueRecords(accessibleRecords, {
    serviceType,
    workflowId,
  })

  const visibleStatusCounts: Record<GenerationQueueJobStatus, number> = {
    queued: 0,
    dispatching: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  }

  for (const record of visibleRecords) {
    visibleStatusCounts[record.status] += 1
  }

  res.json({
    success: true,
    global: GenerationQueueModel.getStatusCounts(),
    visible: visibleStatusCounts,
    total_visible: visibleRecords.length,
    active_visible: visibleRecords.filter((record) => ACTIVE_QUEUE_STATUSES.includes(record.status)).length,
  })
}))

/** GET /api/generation-queue */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  let statuses: GenerationQueueJobStatus[] | undefined
  let serviceType: GenerationQueueJobRecord['service_type'] | undefined
  let workflowId: number | undefined
  try {
    statuses = parseStatusList(req.query.status)
    serviceType = parseServiceType(req.query.service_type)
    workflowId = parsePositiveIntegerQuery(req.query.workflow_id, 'workflow_id')
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Invalid queue filter',
    })
    return
  }

  const mineOnly = req.query.mine === 'true'
  const requesterAccountId = getRequesterAccountId(req)

  let accessibleRecords = GenerationQueueModel.findAll(statuses)
  if (!isAdminRequest(req) || mineOnly) {
    accessibleRecords = requesterAccountId === null
      ? []
      : accessibleRecords.filter((record) => record.requested_by_account_id === requesterAccountId)
  }

  const records = filterQueueRecords(accessibleRecords, {
    serviceType,
    workflowId,
  })

  const activeRelevantRecords = filterQueueRecords(GenerationQueueModel.findAll(ACTIVE_QUEUE_STATUSES), {
    serviceType,
    workflowId,
  })
  const completedRelevantRecords = filterQueueRecords(GenerationQueueModel.findAll(['completed']), {
    serviceType,
    workflowId,
  })
  const activeComfyServers = ComfyUIServerModel.findActiveServers()
  const activeComfyServerCount = activeComfyServers.length
  const queuePositions = computeQueuePositions(activeRelevantRecords, activeComfyServers)
  const queueEtas = computeQueueEtas(activeRelevantRecords, queuePositions, completedRelevantRecords, activeComfyServerCount)

  res.json({
    success: true,
    records: records.map((record) => {
      const queuePosition = queuePositions.get(record.id)
      const queueEta = queueEtas.get(record.id)
      return {
        ...record,
        queue_position: queuePosition?.position ?? null,
        queue_position_scope: queuePosition?.scope ?? null,
        queue_position_server_id: queuePosition?.serverId ?? null,
        queue_position_server_tag: queuePosition?.serverTag ?? null,
        estimated_wait_seconds: queueEta?.waitSeconds ?? null,
        estimated_total_seconds: queueEta?.totalSeconds ?? null,
        estimated_duration_seconds: queueEta?.durationSeconds ?? null,
        is_mine: requesterAccountId !== null && record.requested_by_account_id === requesterAccountId,
      }
    }),
    total: records.length,
  })
}))

/** POST /api/generation-queue */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const {
    service_type,
    priority,
    workflow_id,
    workflow_name,
    requested_group_id,
    requested_server_id,
    requested_server_tag,
    request_payload,
    request_summary,
  } = req.body ?? {}

  if (service_type !== 'comfyui' && service_type !== 'novelai') {
    res.status(400).json({ success: false, error: 'service_type must be either comfyui or novelai' })
    return
  }

  if (!request_payload || typeof request_payload !== 'object' || Array.isArray(request_payload)) {
    res.status(400).json({ success: false, error: 'request_payload must be an object' })
    return
  }

  if (priority !== undefined && (!Number.isInteger(priority) || priority < 0 || priority > 100000)) {
    res.status(400).json({ success: false, error: 'priority must be an integer between 0 and 100000' })
    return
  }

  let parsedRequestedServerTag: string | undefined
  try {
    parsedRequestedServerTag = parseRequestedServerTag(requested_server_tag)
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'requested_server_tag is invalid' })
    return
  }

  let workflowIdNumber: number | null = null
  let workflowLinkedServers: Array<{ id: number; routing_tags?: string[] }> = []
  let workflowHasServerLinks = false

  if (workflow_id !== undefined && workflow_id !== null) {
    workflowIdNumber = Number(workflow_id)
    if (!Number.isInteger(workflowIdNumber) || workflowIdNumber <= 0) {
      res.status(400).json({ success: false, error: 'workflow_id must be a positive integer' })
      return
    }

    const workflow = await WorkflowModel.findById(workflowIdNumber)
    if (!workflow) {
      res.status(404).json({ success: false, error: 'Referenced workflow not found' })
      return
    }

    workflowHasServerLinks = WorkflowServerModel.findServersByWorkflow(workflowIdNumber, false).length > 0
    workflowLinkedServers = WorkflowServerModel.findServersByWorkflow(workflowIdNumber, true)
  }

  if (requested_group_id !== undefined && requested_group_id !== null) {
    const groupIdNumber = Number(requested_group_id)
    if (!Number.isInteger(groupIdNumber) || groupIdNumber <= 0) {
      res.status(400).json({ success: false, error: 'requested_group_id must be a positive integer' })
      return
    }
  }

  if (service_type === 'comfyui') {
    if (workflowIdNumber === null) {
      res.status(400).json({ success: false, error: 'workflow_id is required for comfyui jobs' })
      return
    }

    if (workflowHasServerLinks && workflowLinkedServers.length === 0) {
      res.status(400).json({ success: false, error: 'This workflow has no active linked ComfyUI servers' })
      return
    }
  }

  if (requested_server_id !== undefined && requested_server_id !== null) {
    const serverIdNumber = Number(requested_server_id)
    if (!Number.isInteger(serverIdNumber) || serverIdNumber <= 0) {
      res.status(400).json({ success: false, error: 'requested_server_id must be a positive integer' })
      return
    }

    const server = ComfyUIServerModel.findById(serverIdNumber)
    if (!server || !server.is_active) {
      res.status(404).json({ success: false, error: 'Referenced ComfyUI server not found or inactive' })
      return
    }

    if (service_type !== 'comfyui') {
      res.status(400).json({ success: false, error: 'requested_server_id is only valid for comfyui jobs' })
      return
    }

    if (workflowHasServerLinks && !workflowLinkedServers.some((linkedServer) => Number(linkedServer.id) === serverIdNumber)) {
      res.status(400).json({ success: false, error: 'requested_server_id is not linked to this workflow' })
      return
    }
  }

  if (parsedRequestedServerTag !== undefined && service_type !== 'comfyui') {
    res.status(400).json({ success: false, error: 'requested_server_tag is only valid for comfyui jobs' })
    return
  }

  if (requested_server_id !== undefined && requested_server_id !== null && parsedRequestedServerTag !== undefined) {
    res.status(400).json({ success: false, error: 'requested_server_id and requested_server_tag cannot be combined' })
    return
  }

  if (parsedRequestedServerTag !== undefined) {
    const tagCandidateServers = workflowHasServerLinks ? workflowLinkedServers : ComfyUIServerModel.findActiveServers()
    if (!tagCandidateServers.some((linkedServer) => (linkedServer.routing_tags ?? []).includes(parsedRequestedServerTag))) {
      res.status(400).json({ success: false, error: workflowHasServerLinks ? 'requested_server_tag does not match any linked workflow server' : 'requested_server_tag does not match any active ComfyUI server' })
      return
    }
  }

  const requesterAccountId = getRequesterAccountId(req)
  const jobId = GenerationQueueModel.create({
    service_type,
    priority,
    workflow_id: workflowIdNumber,
    workflow_name: typeof workflow_name === 'string' && workflow_name.trim().length > 0 ? workflow_name.trim() : null,
    requested_group_id: requested_group_id !== undefined && requested_group_id !== null ? Number(requested_group_id) : null,
    requested_server_id: requested_server_id !== undefined && requested_server_id !== null ? Number(requested_server_id) : null,
    requested_server_tag: parsedRequestedServerTag ?? null,
    request_payload,
    request_summary: typeof request_summary === 'string' && request_summary.trim().length > 0 ? request_summary.trim() : null,
    requested_by_account_id: requesterAccountId,
    requested_by_account_type: req.session?.accountType,
  })

  const record = GenerationQueueModel.findById(jobId)
  GenerationQueueService.requestDispatch()
  res.status(201).json({
    success: true,
    record,
    message: 'Generation queue job created',
  })
}))

/** POST /api/generation-queue/:id/retry */
router.post('/:id/retry', asyncHandler(async (req: Request, res: Response) => {
  const jobId = Number(req.params.id)
  if (!Number.isInteger(jobId) || jobId <= 0) {
    res.status(400).json({ success: false, error: 'Invalid queue job id' })
    return
  }

  const existing = GenerationQueueModel.findById(jobId)
  if (!existing) {
    res.status(404).json({ success: false, error: 'Generation queue job not found' })
    return
  }

  if (!canAccessJob(req, existing)) {
    res.status(403).json({ success: false, error: 'You do not have access to this queue job' })
    return
  }

  try {
    const retryRecord = GenerationQueueService.retryJob(jobId)
    res.status(201).json({
      success: true,
      record: retryRecord,
      message: 'Queue job retried',
    })
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Retry failed',
    })
  }
}))

/** POST /api/generation-queue/:id/cancel */
router.post('/:id/cancel', asyncHandler(async (req: Request, res: Response) => {
  const jobId = Number(req.params.id)
  if (!Number.isInteger(jobId) || jobId <= 0) {
    res.status(400).json({ success: false, error: 'Invalid queue job id' })
    return
  }

  const existing = GenerationQueueModel.findById(jobId)
  if (!existing) {
    res.status(404).json({ success: false, error: 'Generation queue job not found' })
    return
  }

  if (!canAccessJob(req, existing)) {
    res.status(403).json({ success: false, error: 'You do not have access to this queue job' })
    return
  }

  if (TERMINAL_QUEUE_STATUSES.includes(existing.status)) {
    res.json({
      success: true,
      record: existing,
      message: 'Queue job is already finished',
    })
    return
  }

  try {
    const updated = existing.status === 'running'
      ? (() => {
          const changed = GenerationQueueModel.requestCancelIfCurrentStatus(jobId, ['running'])
          if (!changed) {
            throw new Error(`Queue job ${jobId} changed state before cancellation request could be applied`)
          }
          return GenerationQueueModel.findById(jobId)
        })()
      : GenerationQueueService.transitionJob(jobId, 'cancelled', {
          expectedCurrentStatuses: [existing.status],
        })

    GenerationQueueService.requestDispatch()

    res.json({
      success: true,
      record: updated,
      message: existing.status === 'running' ? 'Cancellation requested' : 'Queue job cancelled',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Queue cancellation failed'
    const isConflict = typeof message === 'string' && message.includes('changed state before')
    res.status(isConflict ? 409 : 400).json({
      success: false,
      error: message,
    })
  }
}))

export default router
