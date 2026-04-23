import express, { Request, Response } from 'express'
import { asyncHandler } from '../middleware/errorHandler'
import { AuthAccount } from '../models/AuthAccount'
import { GenerationQueueModel } from '../models/GenerationQueue'
import { ComfyUIServerModel, WorkflowServerModel } from '../models/ComfyUIServer'
import { WorkflowModel } from '../models/Workflow'
import {
  normalizeGenerationQueueRoutingTag,
  resolveGenerationQueueLaneMeta,
} from '../services/generationQueueRouting'
import { getCodexAvailabilityStatus } from '../services/codexGenerationExecutor'
import { GenerationQueueService } from '../services/generationQueueService'
import { settingsService } from '../services/settingsService'
import { readComfyRequestDebugSnapshot } from '../services/generationRequestDebugService'
import { AuthAccessControlService } from '../services/authAccessControlService'
import type { GenerationQueueJobRecord, GenerationQueueJobStatus } from '../types/generationQueue'
import { parsePositiveInteger, sendRouteBadRequest } from './routeValidation'

const router = express.Router()

const ACTIVE_QUEUE_STATUSES: GenerationQueueJobStatus[] = ['queued', 'dispatching', 'running']
const TERMINAL_QUEUE_STATUSES: GenerationQueueJobStatus[] = ['completed', 'failed', 'cancelled']
type QueuePositionScope = 'service' | 'server' | 'tag' | 'auto'
type QueuePositionEntry = { laneKey: string; position: number; scope: QueuePositionScope; serverId: number | null; serverTag: string | null; eligibleServerIds: number[] }
type QueueEtaEntry = { waitSeconds: number | null; totalSeconds: number | null; durationSeconds: number | null }

function parseQueueDebugMeta(job: GenerationQueueJobRecord) {
  try {
    const parsed = JSON.parse(job.request_payload) as { _debug?: Record<string, unknown> }
    return parsed?._debug && typeof parsed._debug === 'object' && !Array.isArray(parsed._debug)
      ? parsed._debug
      : null
  } catch {
    return null
  }
}

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

  if (value !== 'comfyui' && value !== 'novelai' && value !== 'codex') {
    throw new Error(`Invalid service_type filter: ${String(value)}`)
  }

  return value
}

function parsePositiveIntegerQuery(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  const parsed = parsePositiveInteger(value)
  if (parsed === null) {
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

function resolveAccessibleQueueJob(req: Request, res: Response) {
  const jobId = parsePositiveInteger(req.params.id)
  if (jobId === null) {
    sendRouteBadRequest(res, 'Invalid queue job id')
    return null
  }

  const job = GenerationQueueModel.findById(jobId)
  if (!job) {
    res.status(404).json({ success: false, error: 'Generation queue job not found' })
    return null
  }

  if (!canAccessJob(req, job)) {
    res.status(403).json({ success: false, error: 'You do not have access to this queue job' })
    return null
  }

  return { jobId, job }
}

function hasGenerationPageAccess(req: Request) {
  const accountId = getRequesterAccountId(req)
  return AuthAccessControlService.hasPermission(accountId, 'page.generation.view')
}

function buildQueueRequesterUsernameMap(records: GenerationQueueJobRecord[]) {
  const usernameByAccountId = new Map<number, string>()
  const accountIds = Array.from(new Set(
    records
      .map((record) => record.requested_by_account_id)
      .filter((accountId): accountId is number => typeof accountId === 'number' && accountId > 0),
  ))

  for (const accountId of accountIds) {
    const account = AuthAccount.findById(accountId)
    if (account?.username) {
      usernameByAccountId.set(accountId, account.username)
    }
  }

  return usernameByAccountId
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
      laneKey: lane.laneKey,
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
  if (record.service_type === 'novelai' || record.service_type === 'codex') {
    return getMedianDurationSeconds(getRecentCompletedDurations(completedRecords, (candidate) => candidate.service_type === record.service_type))
  }

  if (record.workflow_id != null) {
    if (queuePosition?.scope === 'server' && queuePosition.serverId !== null) {
      const workflowServerDurations = getRecentCompletedDurations(completedRecords, (candidate) => (
        candidate.service_type === 'comfyui'
        && candidate.workflow_id === record.workflow_id
        && (candidate.assigned_server_id ?? candidate.requested_server_id ?? null) === queuePosition.serverId
      ))
      const workflowServerMedian = getMedianDurationSeconds(workflowServerDurations)
      if (workflowServerMedian !== null) {
        return workflowServerMedian
      }
    }

    const workflowDurations = getRecentCompletedDurations(completedRecords, (candidate) => (
      candidate.service_type === 'comfyui' && candidate.workflow_id === record.workflow_id
    ))
    const workflowMedian = getMedianDurationSeconds(workflowDurations)
    if (workflowMedian !== null) {
      return workflowMedian
    }
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

function getRunningLaneRecords(record: GenerationQueueJobRecord, queuePosition: QueuePositionEntry | undefined, activeRecords: GenerationQueueJobRecord[]) {
  if (record.service_type === 'novelai' || record.service_type === 'codex') {
    return activeRecords.filter((candidate) => candidate.service_type === record.service_type && candidate.status === 'running')
  }

  if (queuePosition?.scope === 'server' && queuePosition.serverId !== null) {
    return activeRecords.filter((candidate) => (
      candidate.service_type === 'comfyui'
      && candidate.status === 'running'
      && (candidate.assigned_server_id ?? candidate.requested_server_id ?? null) === queuePosition.serverId
    ))
  }

  if (!queuePosition || queuePosition.eligibleServerIds.length === 0) {
    return activeRecords.filter((candidate) => candidate.service_type === 'comfyui' && candidate.status === 'running')
  }

  return activeRecords.filter((candidate) => {
    if (candidate.service_type !== 'comfyui' || candidate.status !== 'running') {
      return false
    }

    const candidateServerId = candidate.assigned_server_id ?? candidate.requested_server_id ?? null
    return candidateServerId !== null && queuePosition.eligibleServerIds.includes(candidateServerId)
  })
}

function getLaneCapacity(record: GenerationQueueJobRecord, queuePosition: QueuePositionEntry | undefined, activeComfyServerCount: number) {
  if (record.service_type === 'novelai' || record.service_type === 'codex') {
    const generationThrottle = settingsService.loadSettings().generationThrottle
    return record.service_type === 'novelai'
      ? Math.max(generationThrottle.novelai.maxConcurrentJobs, 1)
      : Math.max(generationThrottle.codex.maxConcurrentJobs, 1)
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

function getEstimatedRunningRemainingSeconds(record: GenerationQueueJobRecord, durationSeconds: number) {
  const startedAt = record.started_at ? new Date(record.started_at).getTime() : null
  const elapsedSeconds = startedAt && Number.isFinite(startedAt)
    ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
    : 0

  return Math.max(durationSeconds - elapsedSeconds, 0)
}

function getEarliestSlotIndex(slotAvailabilitySeconds: number[]) {
  let earliestIndex = 0
  for (let index = 1; index < slotAvailabilitySeconds.length; index += 1) {
    if (slotAvailabilitySeconds[index] < slotAvailabilitySeconds[earliestIndex]) {
      earliestIndex = index
    }
  }
  return earliestIndex
}

function estimateQueueEta(
  record: GenerationQueueJobRecord,
  queuePosition: QueuePositionEntry | undefined,
  activeRecords: GenerationQueueJobRecord[],
  queuePositions: Map<number, QueuePositionEntry>,
  referenceDurationById: Map<number, number | null>,
  activeComfyServerCount: number,
): QueueEtaEntry {
  const durationSeconds = referenceDurationById.get(record.id) ?? null
  if (durationSeconds === null) {
    return { waitSeconds: null, totalSeconds: null, durationSeconds: null }
  }

  if (record.status === 'running') {
    return {
      waitSeconds: 0,
      totalSeconds: getEstimatedRunningRemainingSeconds(record, durationSeconds),
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
  const slotAvailabilitySeconds = getRunningLaneRecords(record, queuePosition, activeRecords)
    .map((candidate) => {
      const candidateDurationSeconds = referenceDurationById.get(candidate.id) ?? durationSeconds
      return candidateDurationSeconds === null ? durationSeconds : getEstimatedRunningRemainingSeconds(candidate, candidateDurationSeconds)
    })
    .sort((left, right) => left - right)
    .slice(0, capacity)

  while (slotAvailabilitySeconds.length < capacity) {
    slotAvailabilitySeconds.push(0)
  }

  const queuedAheadInSameLane = activeRecords
    .filter((candidate) => {
      if ((candidate.status !== 'queued' && candidate.status !== 'dispatching') || candidate.id === record.id) {
        return false
      }

      const candidateQueuePosition = queuePositions.get(candidate.id)
      return candidateQueuePosition?.laneKey === queuePosition.laneKey
        && candidateQueuePosition.position < queuePosition.position
    })
    .sort((left, right) => {
      const leftPosition = queuePositions.get(left.id)?.position ?? Number.MAX_SAFE_INTEGER
      const rightPosition = queuePositions.get(right.id)?.position ?? Number.MAX_SAFE_INTEGER
      return leftPosition - rightPosition
    })

  for (const queuedCandidate of queuedAheadInSameLane) {
    const queuedDurationSeconds = referenceDurationById.get(queuedCandidate.id) ?? durationSeconds
    const earliestSlotIndex = getEarliestSlotIndex(slotAvailabilitySeconds)
    slotAvailabilitySeconds[earliestSlotIndex] += queuedDurationSeconds ?? durationSeconds
  }

  const waitSeconds = Math.min(...slotAvailabilitySeconds)
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
  const referenceDurationById = new Map<number, number | null>()

  for (const record of activeRecords) {
    referenceDurationById.set(record.id, resolveReferenceDurationSeconds(record, completedRecords, queuePositions.get(record.id)))
  }

  for (const record of activeRecords) {
    etaById.set(
      record.id,
      estimateQueueEta(record, queuePositions.get(record.id), activeRecords, queuePositions, referenceDurationById, activeComfyServerCount),
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
    sendRouteBadRequest(res, error instanceof Error ? error.message : 'Invalid queue stats filter')
    return
  }

  const visibleRecords = filterQueueRecords(GenerationQueueModel.findAll(), {
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

/** GET /api/generation-queue/codex/status */
router.get('/codex/status', asyncHandler(async (_req: Request, res: Response) => {
  const status = await getCodexAvailabilityStatus()
  res.json({
    success: true,
    data: status,
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
    sendRouteBadRequest(res, error instanceof Error ? error.message : 'Invalid queue filter')
    return
  }

  const mineOnly = req.query.mine === 'true'
  const requesterAccountId = getRequesterAccountId(req)

  let records = filterQueueRecords(GenerationQueueModel.findAll(statuses), {
    serviceType,
    workflowId,
  })

  if (mineOnly) {
    records = requesterAccountId === null
      ? []
      : records.filter((record) => record.requested_by_account_id === requesterAccountId)
  }

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
  const requesterUsernames = buildQueueRequesterUsernameMap(records)

  res.json({
    success: true,
    records: records.map((record) => {
      const queuePosition = queuePositions.get(record.id)
      const queueEta = queueEtas.get(record.id)
      return {
        ...record,
        requested_by_username: record.requested_by_account_id != null ? (requesterUsernames.get(record.requested_by_account_id) ?? null) : null,
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
  if (!hasGenerationPageAccess(req)) {
    res.status(403).json({ success: false, error: 'Generation workspace permission is required to create queue jobs here' })
    return
  }

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

  if (service_type !== 'comfyui' && service_type !== 'novelai' && service_type !== 'codex') {
    sendRouteBadRequest(res, 'service_type must be one of comfyui, novelai, or codex')
    return
  }

  if (!request_payload || typeof request_payload !== 'object' || Array.isArray(request_payload)) {
    sendRouteBadRequest(res, 'request_payload must be an object')
    return
  }

  if (priority !== undefined && (!Number.isInteger(priority) || priority < 0 || priority > 100000)) {
    sendRouteBadRequest(res, 'priority must be an integer between 0 and 100000')
    return
  }

  let parsedRequestedServerTag: string | undefined
  try {
    parsedRequestedServerTag = parseRequestedServerTag(requested_server_tag)
  } catch (error) {
    sendRouteBadRequest(res, error instanceof Error ? error.message : 'requested_server_tag is invalid')
    return
  }

  let workflowIdNumber: number | null = null
  let requestedGroupIdNumber: number | null = null
  let requestedServerIdNumber: number | null = null
  let workflowLinkedServers: Array<{ id: number; routing_tags?: string[] }> = []
  let workflowHasServerLinks = false

  if (workflow_id !== undefined && workflow_id !== null) {
    workflowIdNumber = parsePositiveInteger(workflow_id)
    if (workflowIdNumber === null) {
      sendRouteBadRequest(res, 'workflow_id must be a positive integer')
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
    requestedGroupIdNumber = parsePositiveInteger(requested_group_id)
    if (requestedGroupIdNumber === null) {
      sendRouteBadRequest(res, 'requested_group_id must be a positive integer')
      return
    }
  }

  if (service_type === 'comfyui') {
    if (workflowIdNumber === null) {
      sendRouteBadRequest(res, 'workflow_id is required for comfyui jobs')
      return
    }

    if (workflowHasServerLinks && workflowLinkedServers.length === 0) {
      sendRouteBadRequest(res, 'This workflow has no active linked ComfyUI servers')
      return
    }
  }

  if (requested_server_id !== undefined && requested_server_id !== null) {
    requestedServerIdNumber = parsePositiveInteger(requested_server_id)
    if (requestedServerIdNumber === null) {
      sendRouteBadRequest(res, 'requested_server_id must be a positive integer')
      return
    }

    const server = ComfyUIServerModel.findById(requestedServerIdNumber)
    if (!server || !server.is_active) {
      res.status(404).json({ success: false, error: 'Referenced ComfyUI server not found or inactive' })
      return
    }

    if (service_type !== 'comfyui') {
      sendRouteBadRequest(res, 'requested_server_id is only valid for comfyui jobs')
      return
    }

    if (workflowHasServerLinks && !workflowLinkedServers.some((linkedServer) => Number(linkedServer.id) === requestedServerIdNumber)) {
      sendRouteBadRequest(res, 'requested_server_id is not linked to this workflow')
      return
    }
  }

  if (parsedRequestedServerTag !== undefined && service_type !== 'comfyui') {
    sendRouteBadRequest(res, 'requested_server_tag is only valid for comfyui jobs')
    return
  }

  if (requested_server_id !== undefined && requested_server_id !== null && parsedRequestedServerTag !== undefined) {
    sendRouteBadRequest(res, 'requested_server_id and requested_server_tag cannot be combined')
    return
  }

  if (parsedRequestedServerTag !== undefined) {
    const tagCandidateServers = workflowHasServerLinks ? workflowLinkedServers : ComfyUIServerModel.findActiveServers()
    if (!tagCandidateServers.some((linkedServer) => (linkedServer.routing_tags ?? []).includes(parsedRequestedServerTag))) {
      sendRouteBadRequest(res, workflowHasServerLinks ? 'requested_server_tag does not match any linked workflow server' : 'requested_server_tag does not match any active ComfyUI server')
      return
    }
  }

  const requesterAccountId = getRequesterAccountId(req)
  const normalizedRequestSummary = typeof request_summary === 'string' && request_summary.trim().length > 0 ? request_summary.trim() : null
  const jobCreateBase = {
    service_type,
    priority,
    workflow_id: workflowIdNumber,
    workflow_name: typeof workflow_name === 'string' && workflow_name.trim().length > 0 ? workflow_name.trim() : null,
    requested_group_id: requestedGroupIdNumber,
    requested_server_id: requestedServerIdNumber,
    requested_server_tag: parsedRequestedServerTag ?? null,
    requested_by_account_id: requesterAccountId,
    requested_by_account_type: req.session?.accountType,
  }

  const rawCodexCount = service_type === 'codex'
    ? (typeof request_payload.count === 'number' ? request_payload.count : Number(request_payload.count ?? request_payload.n ?? 1))
    : 1
  const codexJobCount = service_type === 'codex' && Number.isInteger(rawCodexCount)
    ? Math.max(1, Math.min(rawCodexCount, 4))
    : 1

  const jobIds: number[] = []
  for (let index = 0; index < codexJobCount; index += 1) {
    const expandedPayload = service_type === 'codex'
      ? {
          ...request_payload,
          count: 1,
          n: 1,
        }
      : request_payload

    jobIds.push(GenerationQueueModel.create({
      ...jobCreateBase,
      request_payload: expandedPayload,
      request_summary: codexJobCount > 1 && normalizedRequestSummary
        ? `${normalizedRequestSummary} (${index + 1}/${codexJobCount})`
        : normalizedRequestSummary,
    }))
  }

  const record = GenerationQueueModel.findById(jobIds[0] ?? 0)
  GenerationQueueService.requestDispatch()
  res.status(201).json({
    success: true,
    record,
    message: codexJobCount > 1 ? `Generation queue jobs created (${codexJobCount})` : 'Generation queue job created',
  })
}))

/** GET /api/generation-queue/:id/request-debug */
router.get('/:id/request-debug', asyncHandler(async (req: Request, res: Response) => {
  const resolvedJob = resolveAccessibleQueueJob(req, res)
  if (!resolvedJob) {
    return
  }

  const { job } = resolvedJob

  if (job.service_type !== 'comfyui') {
    sendRouteBadRequest(res, 'Request debug is currently supported for comfyui jobs only')
    return
  }

  try {
    const snapshot = await readComfyRequestDebugSnapshot(job.id)
    const debugMeta = parseQueueDebugMeta(job)
    res.json({
      success: true,
      data: {
        ...snapshot,
        cancellation_requested_at: typeof debugMeta?.cancellation_requested_at === 'string' ? debugMeta.cancellation_requested_at : null,
        cancellation_endpoint: typeof debugMeta?.cancellation_endpoint === 'string' ? debugMeta.cancellation_endpoint : null,
        cancellation_prompt_id: typeof debugMeta?.cancellation_prompt_id === 'string' ? debugMeta.cancellation_prompt_id : null,
        cancellation_state: typeof debugMeta?.cancellation_state === 'string' ? debugMeta.cancellation_state : null,
        cancellation_error: typeof debugMeta?.cancellation_error === 'string' ? debugMeta.cancellation_error : null,
        cancellation_result: debugMeta?.cancellation_result && typeof debugMeta.cancellation_result === 'object' && !Array.isArray(debugMeta.cancellation_result)
          ? debugMeta.cancellation_result
          : null,
      },
    })
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error instanceof Error ? error.message : 'Request debug snapshot not found',
    })
  }
}))

/** POST /api/generation-queue/:id/retry */
router.post('/:id/retry', asyncHandler(async (req: Request, res: Response) => {
  if (!hasGenerationPageAccess(req)) {
    res.status(403).json({ success: false, error: 'Generation workspace permission is required to retry queue jobs here' })
    return
  }

  const resolvedJob = resolveAccessibleQueueJob(req, res)
  if (!resolvedJob) {
    return
  }

  const { jobId } = resolvedJob

  try {
    const retryRecord = GenerationQueueService.retryJob(jobId)
    res.status(201).json({
      success: true,
      record: retryRecord,
      message: 'Queue job retried',
    })
  } catch (error) {
    sendRouteBadRequest(res, error instanceof Error ? error.message : 'Retry failed')
  }
}))

/** POST /api/generation-queue/:id/cancel */
router.post('/:id/cancel', asyncHandler(async (req: Request, res: Response) => {
  const resolvedJob = resolveAccessibleQueueJob(req, res)
  if (!resolvedJob) {
    return
  }

  const { jobId, job: existing } = resolvedJob

  if (TERMINAL_QUEUE_STATUSES.includes(existing.status)) {
    res.json({
      success: true,
      record: existing,
      message: 'Queue job is already finished',
    })
    return
  }

  try {
    const updated = await GenerationQueueService.requestCancellation(jobId)

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
