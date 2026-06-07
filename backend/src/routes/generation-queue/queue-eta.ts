import { ComfyUIServerModel } from '../../models/ComfyUIServer'
import { createGenerationQueueRoutingContext, getGenerationQueueServerCapacity, resolveGenerationQueueLaneMeta } from '../../services/generationQueueRouting'
import { settingsService } from '../../services/settingsService'
import type { GenerationQueueDurationSample, GenerationQueueJobListRecord } from '../../types/generationQueue'

export type QueuePositionScope = 'service' | 'server' | 'tag' | 'auto'
export type QueuePositionEntry = { laneKey: string; position: number; scope: QueuePositionScope; serverId: number | null; serverTag: string | null; eligibleServerIds: number[] }
export type QueueEtaEntry = { waitSeconds: number | null; totalSeconds: number | null; durationSeconds: number | null }

type QueueEtaCapacityContext = {
  totalComfyCapacity: number
  comfyCapacityByServerId: Map<number, number>
  novelaiCapacity: number
  codexCapacity: number
}

type DurationSampleStats = {
  novelaiDurations: number[]
  codexDurations: number[]
  comfyDurations: number[]
  comfyDurationsByWorkflowId: Map<number, number[]>
  comfyDurationsByServerId: Map<number, number[]>
  comfyDurationsByWorkflowServerKey: Map<string, number[]>
}

type RunningLaneRecordIndex = {
  novelai: GenerationQueueJobListRecord[]
  codex: GenerationQueueJobListRecord[]
  comfyByServerId: Map<number, GenerationQueueJobListRecord[]>
  comfyAll: GenerationQueueJobListRecord[]
}

export function computeQueuePositions(records: GenerationQueueJobListRecord[], activeComfyServers: ReturnType<typeof ComfyUIServerModel.findActiveServers>) {
  const positions = new Map<number, QueuePositionEntry>()
  const nextByLane = new Map<string, number>()
  const routingContext = createGenerationQueueRoutingContext(activeComfyServers)

  for (const record of records) {
    if (record.status !== 'queued' && record.status !== 'dispatching') {
      continue
    }

    const lane = resolveGenerationQueueLaneMeta(record, routingContext)
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

function getJobDurationSeconds(record: GenerationQueueDurationSample) {
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

function pushRecentDuration(bucket: number[], durationSeconds: number) {
  if (bucket.length < 12) {
    bucket.push(durationSeconds)
  }
}

function getWorkflowServerDurationKey(workflowId: number, serverId: number) {
  return `${workflowId}:${serverId}`
}

function buildDurationSampleStats(completedRecords: GenerationQueueDurationSample[]): DurationSampleStats {
  const stats: DurationSampleStats = {
    novelaiDurations: [],
    codexDurations: [],
    comfyDurations: [],
    comfyDurationsByWorkflowId: new Map(),
    comfyDurationsByServerId: new Map(),
    comfyDurationsByWorkflowServerKey: new Map(),
  }

  const recordsByMostRecentCompletion = [...completedRecords]
    .sort((left, right) => String(right.completed_at ?? '').localeCompare(String(left.completed_at ?? '')))

  for (const record of recordsByMostRecentCompletion) {
    const durationSeconds = getJobDurationSeconds(record)
    if (durationSeconds === null) {
      continue
    }

    if (record.service_type === 'novelai') {
      pushRecentDuration(stats.novelaiDurations, durationSeconds)
      continue
    }

    if (record.service_type === 'codex') {
      pushRecentDuration(stats.codexDurations, durationSeconds)
      continue
    }

    if (record.service_type !== 'comfyui') {
      continue
    }

    pushRecentDuration(stats.comfyDurations, durationSeconds)

    if (record.workflow_id != null) {
      const workflowDurations = stats.comfyDurationsByWorkflowId.get(record.workflow_id) ?? []
      pushRecentDuration(workflowDurations, durationSeconds)
      stats.comfyDurationsByWorkflowId.set(record.workflow_id, workflowDurations)
    }

    const serverId = record.assigned_server_id ?? record.requested_server_id ?? null
    if (serverId !== null) {
      const serverDurations = stats.comfyDurationsByServerId.get(serverId) ?? []
      pushRecentDuration(serverDurations, durationSeconds)
      stats.comfyDurationsByServerId.set(serverId, serverDurations)

      if (record.workflow_id != null) {
        const workflowServerKey = getWorkflowServerDurationKey(record.workflow_id, serverId)
        const workflowServerDurations = stats.comfyDurationsByWorkflowServerKey.get(workflowServerKey) ?? []
        pushRecentDuration(workflowServerDurations, durationSeconds)
        stats.comfyDurationsByWorkflowServerKey.set(workflowServerKey, workflowServerDurations)
      }
    }
  }

  return stats
}

function resolveReferenceDurationSeconds(record: GenerationQueueJobListRecord, stats: DurationSampleStats, queuePosition: QueuePositionEntry | undefined) {
  if (record.service_type === 'novelai') {
    return getMedianDurationSeconds(stats.novelaiDurations)
  }

  if (record.service_type === 'codex') {
    return getMedianDurationSeconds(stats.codexDurations)
  }

  if (record.workflow_id != null) {
    if (queuePosition?.scope === 'server' && queuePosition.serverId !== null) {
      const workflowServerMedian = getMedianDurationSeconds(
        stats.comfyDurationsByWorkflowServerKey.get(getWorkflowServerDurationKey(record.workflow_id, queuePosition.serverId)) ?? [],
      )
      if (workflowServerMedian !== null) {
        return workflowServerMedian
      }
    }

    const workflowMedian = getMedianDurationSeconds(stats.comfyDurationsByWorkflowId.get(record.workflow_id) ?? [])
    if (workflowMedian !== null) {
      return workflowMedian
    }
  }

  if (queuePosition?.scope === 'server' && queuePosition.serverId !== null) {
    const serverMedian = getMedianDurationSeconds(stats.comfyDurationsByServerId.get(queuePosition.serverId) ?? [])
    if (serverMedian !== null) {
      return serverMedian
    }
  }

  return getMedianDurationSeconds(stats.comfyDurations)
}

function buildCapacityContext(activeComfyServers: ReturnType<typeof ComfyUIServerModel.findActiveServers>): QueueEtaCapacityContext {
  const comfyCapacityByServerId = new Map<number, number>()
  let totalComfyCapacity = 0

  for (const server of activeComfyServers) {
    const capacity = getGenerationQueueServerCapacity(server)
    comfyCapacityByServerId.set(server.id, capacity)
    totalComfyCapacity += capacity
  }

  const generationThrottle = settingsService.loadSettings().generationThrottle
  return {
    totalComfyCapacity: Math.max(totalComfyCapacity, 1),
    comfyCapacityByServerId,
    novelaiCapacity: Math.max(generationThrottle.novelai.maxConcurrentJobs, 1),
    codexCapacity: Math.max(generationThrottle.codex.maxConcurrentJobs, 1),
  }
}

function buildRunningLaneRecordIndex(activeRecords: GenerationQueueJobListRecord[]): RunningLaneRecordIndex {
  const index: RunningLaneRecordIndex = {
    novelai: [],
    codex: [],
    comfyByServerId: new Map(),
    comfyAll: [],
  }

  for (const record of activeRecords) {
    if (record.status !== 'running') {
      continue
    }

    if (record.service_type === 'novelai') {
      index.novelai.push(record)
      continue
    }

    if (record.service_type === 'codex') {
      index.codex.push(record)
      continue
    }

    if (record.service_type !== 'comfyui') {
      continue
    }

    index.comfyAll.push(record)
    const serverId = record.assigned_server_id ?? record.requested_server_id ?? null
    if (serverId !== null) {
      const serverRecords = index.comfyByServerId.get(serverId) ?? []
      serverRecords.push(record)
      index.comfyByServerId.set(serverId, serverRecords)
    }
  }

  return index
}

function getRunningLaneRecords(record: GenerationQueueJobListRecord, queuePosition: QueuePositionEntry | undefined, runningIndex: RunningLaneRecordIndex) {
  if (record.service_type === 'novelai') {
    return runningIndex.novelai
  }

  if (record.service_type === 'codex') {
    return runningIndex.codex
  }

  if (queuePosition?.scope === 'server' && queuePosition.serverId !== null) {
    return runningIndex.comfyByServerId.get(queuePosition.serverId) ?? []
  }

  if (!queuePosition || queuePosition.eligibleServerIds.length === 0) {
    return runningIndex.comfyAll
  }

  const eligibleServerIdSet = new Set(queuePosition.eligibleServerIds)
  const records: GenerationQueueJobListRecord[] = []
  runningIndex.comfyByServerId.forEach((serverRecords, serverId) => {
    if (eligibleServerIdSet.has(serverId)) {
      records.push(...serverRecords)
    }
  })

  return records
}

function getLaneCapacity(record: GenerationQueueJobListRecord, queuePosition: QueuePositionEntry | undefined, capacityContext: QueueEtaCapacityContext) {
  if (record.service_type === 'novelai') {
    return capacityContext.novelaiCapacity
  }

  if (record.service_type === 'codex') {
    return capacityContext.codexCapacity
  }

  if (!queuePosition) {
    return capacityContext.totalComfyCapacity
  }

  if (queuePosition.eligibleServerIds.length === 0) {
    return 0
  }

  if (queuePosition.scope === 'server' && queuePosition.serverId !== null) {
    return capacityContext.comfyCapacityByServerId.get(queuePosition.serverId) ?? 0
  }

  if (queuePosition.eligibleServerIds.length > 0) {
    const capacity = queuePosition.eligibleServerIds.reduce((sum, serverId) => sum + (capacityContext.comfyCapacityByServerId.get(serverId) ?? 0), 0)
    return Math.max(capacity, 1)
  }

  return capacityContext.totalComfyCapacity
}

function getEstimatedRunningRemainingSeconds(record: GenerationQueueJobListRecord, durationSeconds: number) {
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

function buildQueuedRecordsByLaneKey(
  activeRecords: GenerationQueueJobListRecord[],
  queuePositions: Map<number, QueuePositionEntry>,
) {
  const recordsByLaneKey = new Map<string, GenerationQueueJobListRecord[]>()

  for (const record of activeRecords) {
    if (record.status !== 'queued' && record.status !== 'dispatching') {
      continue
    }

    const queuePosition = queuePositions.get(record.id)
    if (!queuePosition) {
      continue
    }

    const laneRecords = recordsByLaneKey.get(queuePosition.laneKey) ?? []
    laneRecords.push(record)
    recordsByLaneKey.set(queuePosition.laneKey, laneRecords)
  }

  recordsByLaneKey.forEach((laneRecords) => {
    laneRecords.sort((left, right) => {
      const leftPosition = queuePositions.get(left.id)?.position ?? Number.MAX_SAFE_INTEGER
      const rightPosition = queuePositions.get(right.id)?.position ?? Number.MAX_SAFE_INTEGER
      return leftPosition - rightPosition
    })
  })

  return recordsByLaneKey
}

function estimateQueueEta(
  record: GenerationQueueJobListRecord,
  queuePosition: QueuePositionEntry | undefined,
  runningIndex: RunningLaneRecordIndex,
  queuedRecordsByLaneKey: Map<string, GenerationQueueJobListRecord[]>,
  queuePositions: Map<number, QueuePositionEntry>,
  referenceDurationById: Map<number, number | null>,
  capacityContext: QueueEtaCapacityContext,
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

  const capacity = getLaneCapacity(record, queuePosition, capacityContext)
  if (capacity <= 0) {
    return { waitSeconds: null, totalSeconds: null, durationSeconds }
  }

  const slotAvailabilitySeconds = getRunningLaneRecords(record, queuePosition, runningIndex)
    .map((candidate) => {
      const candidateDurationSeconds = referenceDurationById.get(candidate.id) ?? durationSeconds
      return candidateDurationSeconds === null ? durationSeconds : getEstimatedRunningRemainingSeconds(candidate, candidateDurationSeconds)
    })
    .sort((left, right) => left - right)
    .slice(0, capacity)

  while (slotAvailabilitySeconds.length < capacity) {
    slotAvailabilitySeconds.push(0)
  }

  const queuedCandidatesInSameLane = queuedRecordsByLaneKey.get(queuePosition.laneKey) ?? []
  for (const queuedCandidate of queuedCandidatesInSameLane) {
    if (queuedCandidate.id === record.id) {
      continue
    }

    const candidateQueuePosition = queuePositions.get(queuedCandidate.id)
    if (!candidateQueuePosition || candidateQueuePosition.position >= queuePosition.position) {
      break
    }

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

export function computeQueueEtas(
  activeRecords: GenerationQueueJobListRecord[],
  queuePositions: Map<number, QueuePositionEntry>,
  completedRecords: GenerationQueueDurationSample[],
  activeComfyServers: ReturnType<typeof ComfyUIServerModel.findActiveServers>,
) {
  const etaById = new Map<number, QueueEtaEntry>()
  const referenceDurationById = new Map<number, number | null>()
  const durationStats = buildDurationSampleStats(completedRecords)
  const runningIndex = buildRunningLaneRecordIndex(activeRecords)
  const queuedRecordsByLaneKey = buildQueuedRecordsByLaneKey(activeRecords, queuePositions)
  const capacityContext = buildCapacityContext(activeComfyServers)

  for (const record of activeRecords) {
    referenceDurationById.set(record.id, resolveReferenceDurationSeconds(record, durationStats, queuePositions.get(record.id)))
  }

  for (const record of activeRecords) {
    etaById.set(
      record.id,
      estimateQueueEta(record, queuePositions.get(record.id), runningIndex, queuedRecordsByLaneKey, queuePositions, referenceDurationById, capacityContext),
    )
  }

  return etaById
}
