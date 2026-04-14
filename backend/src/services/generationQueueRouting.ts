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

/** Resolve the active ComfyUI servers a workflow is allowed to use. */
export function getGenerationQueueWorkflowAllowedServerIds(workflowId: number | null | undefined, activeServers: ComfyUIServerRecord[]) {
  if (!workflowId) {
    return activeServers.map((server) => server.id)
  }

  const linkedServerIds = WorkflowServerModel.findServersByWorkflow(workflowId, true)
    .map((server) => Number(server.id))
    .filter((serverId) => Number.isInteger(serverId) && activeServers.some((server) => server.id === serverId))

  return linkedServerIds.length > 0 ? linkedServerIds : activeServers.map((server) => server.id)
}

/** Resolve the active ComfyUI servers a queued job can actually run on. */
export function getGenerationQueueEligibleServerIds(job: GenerationQueueJobRecord, activeServers: ComfyUIServerRecord[]) {
  if (job.service_type !== 'comfyui' || job.cancel_requested > 0) {
    return []
  }

  const allowedServerIds = getGenerationQueueWorkflowAllowedServerIds(job.workflow_id, activeServers)
  let eligibleServerIds = allowedServerIds

  if (job.requested_server_id !== null && job.requested_server_id !== undefined) {
    eligibleServerIds = eligibleServerIds.filter((serverId) => serverId === job.requested_server_id)
  }

  if (job.requested_server_tag) {
    eligibleServerIds = eligibleServerIds.filter((serverId) => {
      const server = activeServers.find((candidate) => candidate.id === serverId)
      return server ? getGenerationQueueServerRoutingTags(server).has(job.requested_server_tag ?? '') : false
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
  if (record.service_type === 'novelai') {
    return {
      laneKey: 'novelai',
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
    return {
      laneKey: `comfyui:tag:${record.requested_server_tag}:${eligibleKeySuffix}`,
      scope: 'tag',
      serverId: null,
      serverTag: record.requested_server_tag,
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
