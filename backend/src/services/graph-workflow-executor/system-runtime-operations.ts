import { ComfyUIServerModel } from '../../models/ComfyUIServer'
import { GenerationQueueModel } from '../../models/GenerationQueue'
import type { GraphWorkflowNode } from '../../types/moduleGraph'
import { getComfyUIServerRuntimeStatuses } from '../comfyui/runtimeStatusService'
import { normalizeGenerationQueueRoutingTag } from '../generationQueueRouting'
import { buildRuntimeArtifact, completeSystemNode } from './system-module-artifacts'
import type { ExecutionContext, ParsedModuleDefinition } from './shared'

/**
 * Read the ComfyUI servers' live occupancy and the generation queue's backlog. A server counts as idle when it is
 * connected, has nothing running or waiting upstream, and no CoNAI job is queued for ComfyUI.
 */
export async function executeReadRuntimeStatusNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const operationKey = 'system.read_runtime_status'
  const tag = typeof resolvedInputs.server_tag === 'string' && resolvedInputs.server_tag.trim()
    ? normalizeGenerationQueueRoutingTag(resolvedInputs.server_tag)
    : null
  const servers = ComfyUIServerModel.findActiveServers()
    .filter((server) => !tag || (server.routing_tags ?? []).some((entry: string) => normalizeGenerationQueueRoutingTag(entry) === tag))
  const statuses = await getComfyUIServerRuntimeStatuses(servers)
  const counts = GenerationQueueModel.getStatusCounts({ serviceType: 'comfyui' })
  const queueWaiting = counts.queued + counts.dispatching
  const list = statuses.map((status) => ({
    id: status.server_id,
    name: status.server_name,
    connected: status.is_connected,
    running: status.running_count ?? 0,
    pending: status.pending_count ?? 0,
    free_slots: status.available_count ?? 0,
    idle: Boolean(status.is_connected && status.is_idle),
    error: status.error_message ?? null,
  }))
  const idleIds = queueWaiting > 0 ? [] : list.filter((server) => server.idle).map((server) => server.id)

  const meta = { kind: 'system-runtime-status', operationKey }
  completeSystemNode(context, node, moduleDefinition, operationKey, {
    has_idle: buildRuntimeArtifact(context.executionId, node.id, 'has_idle', 'boolean', idleIds.length > 0, meta),
    idle_count: buildRuntimeArtifact(context.executionId, node.id, 'idle_count', 'number', idleIds.length, meta),
    queue_waiting: buildRuntimeArtifact(context.executionId, node.id, 'queue_waiting', 'number', queueWaiting, meta),
    idle_server_ids: buildRuntimeArtifact(context.executionId, node.id, 'idle_server_ids', 'json', idleIds, meta),
    servers: buildRuntimeArtifact(context.executionId, node.id, 'servers', 'json', list, meta),
  })
}
