import { ComfyUIServerModel } from '../../models/ComfyUIServer'
import { getGenerationQueueServerCapacity, resolveGenerationQueueLaneMeta } from '../../services/generationQueueRouting'
import { settingsService } from '../../services/settingsService'
import type { GenerationQueueDurationSample, GenerationQueueJobRecord } from '../../types/generationQueue'

export type QueuePositionScope = 'service' | 'server' | 'tag' | 'auto'
export type QueuePositionEntry = { laneKey: string; position: number; scope: QueuePositionScope; serverId: number | null; serverTag: string | null; eligibleServerIds: number[] }
export type QueueEtaEntry = { waitSeconds: number | null; totalSeconds: number | null; durationSeconds: number | null }

export function computeQueuePositions(records: GenerationQueueJobRecord[], activeComfyServers: ReturnType<typeof ComfyUIServerModel.findActiveServers>) {
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

function getRecentCompletedDurations(records: GenerationQueueDurationSample[], predicate: (record: GenerationQueueDurationSample) => boolean) {
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

function resolveReferenceDurationSeconds(record: GenerationQueueJobRecord, completedRecords: GenerationQueueDurationSample[], queuePosition: QueuePositionEntry | undefined) {
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

function getComfyServerCapacitySum(activeComfyServers: ReturnType<typeof ComfyUIServerModel.findActiveServers>, serverIds?: number[]) {
  const serverIdSet = serverIds && serverIds.length > 0 ? new Set(serverIds) : null
  const capacity = activeComfyServers
    .filter((server) => serverIdSet === null || serverIdSet.has(server.id))
    .reduce((sum, server) => sum + getGenerationQueueServerCapacity(server), 0)

  return Math.max(capacity, 1)
}

function getLaneCapacity(record: GenerationQueueJobRecord, queuePosition: QueuePositionEntry | undefined, activeComfyServers: ReturnType<typeof ComfyUIServerModel.findActiveServers>) {
  if (record.service_type === 'novelai' || record.service_type === 'codex') {
    const generationThrottle = settingsService.loadSettings().generationThrottle
    return record.service_type === 'novelai'
      ? Math.max(generationThrottle.novelai.maxConcurrentJobs, 1)
      : Math.max(generationThrottle.codex.maxConcurrentJobs, 1)
  }

  if (!queuePosition) {
    return getComfyServerCapacitySum(activeComfyServers)
  }

  if (queuePosition.scope === 'server' && queuePosition.serverId !== null) {
    return getComfyServerCapacitySum(activeComfyServers, [queuePosition.serverId])
  }

  if (queuePosition.eligibleServerIds.length > 0) {
    return getComfyServerCapacitySum(activeComfyServers, queuePosition.eligibleServerIds)
  }

  return getComfyServerCapacitySum(activeComfyServers)
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
  activeComfyServers: ReturnType<typeof ComfyUIServerModel.findActiveServers>,
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

  const capacity = getLaneCapacity(record, queuePosition, activeComfyServers)
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

export function computeQueueEtas(
  activeRecords: GenerationQueueJobRecord[],
  queuePositions: Map<number, QueuePositionEntry>,
  completedRecords: GenerationQueueDurationSample[],
  activeComfyServers: ReturnType<typeof ComfyUIServerModel.findActiveServers>,
) {
  const etaById = new Map<number, QueueEtaEntry>()
  const referenceDurationById = new Map<number, number | null>()

  for (const record of activeRecords) {
    referenceDurationById.set(record.id, resolveReferenceDurationSeconds(record, completedRecords, queuePositions.get(record.id)))
  }

  for (const record of activeRecords) {
    etaById.set(
      record.id,
      estimateQueueEta(record, queuePositions.get(record.id), activeRecords, queuePositions, referenceDurationById, activeComfyServers),
    )
  }

  return etaById
}
