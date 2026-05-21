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

export type GenerationQueueRoutingContext = {
  activeServers: ComfyUIServerRecord[]
  activeServerIds: number[]
  defaultAutoServerIds: number[]
  defaultAutoServerIdSet: Set<number>
  activeServerById: Map<number, ComfyUIServerRecord>
  routingTagsByServerId: Map<number, Set<string>>
  workflowAllowedServerIdsByWorkflowId: Map<number, number[]>
}

export type GenerationQueueRoutingSource = ComfyUIServerRecord[] | GenerationQueueRoutingContext

/** Normalize queue routing tags so server and request matching stays consistent. */
export function normalizeGenerationQueueRoutingTag(value: string) {
  return value.trim().toLowerCase()
}

/** Collect the normalized routing tags exposed by a single active ComfyUI server. */
export function getGenerationQueueServerRoutingTags(server: ComfyUIServerRecord) {
  return new Set((server.routing_tags ?? []).map((tag) => normalizeGenerationQueueRoutingTag(tag)).filter((tag) => tag.length > 0))
}

/** Build reusable routing lookup state for queue dispatch/ETA passes over many jobs. */
export function createGenerationQueueRoutingContext(activeServers: ComfyUIServerRecord[]): GenerationQueueRoutingContext {
  const activeServerById = new Map(activeServers.map((server) => [server.id, server] as const))
  const routingTagsByServerId = new Map(activeServers.map((server) => [server.id, getGenerationQueueServerRoutingTags(server)] as const))
  const activeServerIds = activeServers.map((server) => server.id)
  const defaultAutoServerIds = activeServers
    .filter((server) => server.backend_type !== 'modal')
    .map((server) => server.id)
  const defaultAutoServerIdSet = new Set(defaultAutoServerIds)

  return {
    activeServers,
    activeServerIds,
    defaultAutoServerIds,
    defaultAutoServerIdSet,
    activeServerById,
    routingTagsByServerId,
    workflowAllowedServerIdsByWorkflowId: new Map(),
  }
}

function resolveGenerationQueueRoutingContext(source: GenerationQueueRoutingSource) {
  return Array.isArray(source) ? createGenerationQueueRoutingContext(source) : source
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
export function getGenerationQueueWorkflowAllowedServerIds(workflowId: number | null | undefined, source: GenerationQueueRoutingSource) {
  const context = resolveGenerationQueueRoutingContext(source)

  if (!workflowId) {
    return context.activeServerIds
  }

  const cached = context.workflowAllowedServerIdsByWorkflowId.get(workflowId)
  if (cached) {
    return cached
  }

  const linkedServerIds = WorkflowServerModel.findServersByWorkflow(workflowId, true)
    .map((server) => Number(server.id))
    .filter((serverId) => Number.isInteger(serverId) && context.activeServerById.has(serverId))

  const allowedServerIds = linkedServerIds.length > 0 ? linkedServerIds : context.activeServerIds
  context.workflowAllowedServerIdsByWorkflowId.set(workflowId, allowedServerIds)

  return allowedServerIds
}

/** Resolve the active ComfyUI servers a queued job can actually run on. */
export function getGenerationQueueEligibleServerIds(job: GenerationQueueJobRecord, source: GenerationQueueRoutingSource) {
  if (job.service_type !== 'comfyui' || job.cancel_requested > 0) {
    return []
  }

  const context = resolveGenerationQueueRoutingContext(source)
  const allowedServerIds = getGenerationQueueWorkflowAllowedServerIds(job.workflow_id, context)
  let eligibleServerIds = allowedServerIds

  if (job.requested_server_id !== null && job.requested_server_id !== undefined) {
    eligibleServerIds = eligibleServerIds.filter((serverId) => serverId === job.requested_server_id)
  }

  if (job.requested_server_tag) {
    const normalizedRequestedTag = normalizeGenerationQueueRoutingTag(job.requested_server_tag)
    eligibleServerIds = eligibleServerIds.filter((serverId) => {
      const routingTags = context.routingTagsByServerId.get(serverId)
      return routingTags ? routingTags.has(normalizedRequestedTag) : false
    })
  }

  if (job.requested_server_id == null && !job.requested_server_tag) {
    eligibleServerIds = eligibleServerIds.filter((serverId) => context.defaultAutoServerIdSet.has(serverId))
  }

  return eligibleServerIds
}

/** Check whether a queued ComfyUI job is dispatch-compatible with one active server. */
export function isGenerationQueueComfyJobCompatibleWithServer(job: GenerationQueueJobRecord, server: ComfyUIServerRecord, source: GenerationQueueRoutingSource) {
  return getGenerationQueueEligibleServerIds(job, source).includes(server.id)
}

/** Build the display lane metadata for queue position and ETA calculations. */
export function resolveGenerationQueueLaneMeta(record: GenerationQueueJobRecord, source: GenerationQueueRoutingSource): GenerationQueueLaneMeta {
  if (record.service_type === 'novelai' || record.service_type === 'codex') {
    return {
      laneKey: record.service_type,
      scope: 'service',
      serverId: null,
      serverTag: null,
      eligibleServerIds: [],
    }
  }

  const eligibleServerIds = getGenerationQueueEligibleServerIds(record, source)
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
