import { WorkflowServerModel } from '../models/ComfyUIServer'
import type { ComfyUIServerRecord } from '../types/comfyuiServer'
import type { GenerationQueueJobRecord } from '../types/generationQueue'

export type GenerationQueueLaneScope = 'service' | 'server' | 'tag' | 'auto'

export type GenerationQueueLaneMeta = {
  laneKey: string
  scope: GenerationQueueLaneScope
  serverId: number | null
  serverTag: string | null
  eligibleServerIds: number[]
}

/** Normalize queue routing tags so server and request matching stays consistent. */
export function normalizeGenerationQueueRoutingTag(value: string) {
  return value.trim().toLowerCase()
}

/** Collect the normalized routing tags exposed by a single active ComfyUI server. */
export function getGenerationQueueServerRoutingTags(server: ComfyUIServerRecord) {
  return new Set((server.routing_tags ?? []).map((tag) => normalizeGenerationQueueRoutingTag(tag)).filter((tag) => tag.length > 0))
}

/** Resolve the worker-slot capacity used by generation queue dispatch and ETA calculations. */
export function getGenerationQueueServerCapacity(server: Pick<ComfyUIServerRecord, 'backend_type' | 'capacity'>) {
  return Math.max(1, Math.floor(server.capacity ?? (server.backend_type === 'modal' ? 10 : 1)))
}

/** Check whether one server exposes a requested routing tag after normalization. */
export function hasGenerationQueueServerRoutingTag(server: Pick<ComfyUIServerRecord, 'routing_tags'>, requestedTag: string) {
  const normalizedRequestedTag = normalizeGenerationQueueRoutingTag(requestedTag)
  if (normalizedRequestedTag.length === 0) {
    return false
  }

  return (server.routing_tags ?? [])
    .some((tag) => normalizeGenerationQueueRoutingTag(tag) === normalizedRequestedTag)
}

/** Resolve the active ComfyUI servers a workflow is allowed to use. */
export function getGenerationQueueWorkflowAllowedServerIds(workflowId: number | null | undefined, activeServers: ComfyUIServerRecord[]) {
  const activeServerIdSet = new Set(activeServers.map((server) => server.id))

  if (!workflowId) {
    return activeServers.map((server) => server.id)
  }

  const linkedServerIds = WorkflowServerModel.findServersByWorkflow(workflowId, true)
    .map((server) => Number(server.id))
    .filter((serverId) => Number.isInteger(serverId) && activeServerIdSet.has(serverId))

  return linkedServerIds.length > 0 ? linkedServerIds : activeServers.map((server) => server.id)
}

/** Resolve the active ComfyUI servers a queued job can actually run on. */
export function getGenerationQueueEligibleServerIds(job: GenerationQueueJobRecord, activeServers: ComfyUIServerRecord[]) {
  if (job.service_type !== 'comfyui' || job.cancel_requested > 0) {
    return []
  }

  const allowedServerIds = getGenerationQueueWorkflowAllowedServerIds(job.workflow_id, activeServers)
  const activeServerById = new Map(activeServers.map((server) => [server.id, server] as const))
  let eligibleServerIds = allowedServerIds

  if (job.requested_server_id !== null && job.requested_server_id !== undefined) {
    eligibleServerIds = eligibleServerIds.filter((serverId) => serverId === job.requested_server_id)
  }

  if (job.requested_server_tag) {
    const normalizedRequestedTag = normalizeGenerationQueueRoutingTag(job.requested_server_tag)
    eligibleServerIds = eligibleServerIds.filter((serverId) => {
      const server = activeServerById.get(serverId)
      return server ? getGenerationQueueServerRoutingTags(server).has(normalizedRequestedTag) : false
    })
  }

  if (job.requested_server_id == null && !job.requested_server_tag) {
    eligibleServerIds = eligibleServerIds.filter((serverId) => {
      const server = activeServerById.get(serverId)
      return server?.backend_type !== 'modal'
    })
  }

  return eligibleServerIds
}

/** Check whether a queued ComfyUI job is dispatch-compatible with one active server. */
export function isGenerationQueueComfyJobCompatibleWithServer(job: GenerationQueueJobRecord, server: ComfyUIServerRecord, activeServers: ComfyUIServerRecord[]) {
  return getGenerationQueueEligibleServerIds(job, activeServers).includes(server.id)
}

/** Build the display lane metadata for queue position and ETA calculations. */
export function resolveGenerationQueueLaneMeta(record: GenerationQueueJobRecord, activeServers: ComfyUIServerRecord[]): GenerationQueueLaneMeta {
  if (record.service_type === 'novelai' || record.service_type === 'codex') {
    return {
      laneKey: record.service_type,
      scope: 'service',
      serverId: null,
      serverTag: null,
      eligibleServerIds: [],
    }
  }

  const eligibleServerIds = getGenerationQueueEligibleServerIds(record, activeServers)
  const assignedOrRequestedServerId = record.requested_server_id ?? record.assigned_server_id ?? null

  if (assignedOrRequestedServerId !== null) {
    return {
      laneKey: `comfyui:server:${assignedOrRequestedServerId}`,
      scope: 'server',
      serverId: assignedOrRequestedServerId,
      serverTag: null,
      eligibleServerIds: eligibleServerIds.length > 0 ? eligibleServerIds : [assignedOrRequestedServerId],
    }
  }

  const eligibleKeySuffix = eligibleServerIds.length > 0 ? eligibleServerIds.join(',') : 'none'
  if (record.requested_server_tag) {
    const normalizedRequestedTag = normalizeGenerationQueueRoutingTag(record.requested_server_tag)
    return {
      laneKey: `comfyui:tag:${normalizedRequestedTag}:${eligibleKeySuffix}`,
      scope: 'tag',
      serverId: null,
      serverTag: normalizedRequestedTag,
      eligibleServerIds,
    }
  }

  return {
    laneKey: `comfyui:auto:${eligibleKeySuffix}`,
    scope: 'auto',
    serverId: null,
    serverTag: null,
    eligibleServerIds,
  }
}
