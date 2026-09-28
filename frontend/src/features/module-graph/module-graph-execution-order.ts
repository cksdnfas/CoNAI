import type { ModuleGraphEdge, ModuleGraphExecutionSkipReason, ModuleGraphExecutionStatus, ModuleGraphNode } from './module-graph-types'
import type { GraphExecutionStatus } from '@/lib/api-module-graph'

/** Build per-node execution-order positions so large graphs avoid repeated array scans. */
export function buildNodeOrderIndex(orderedNodeIds: string[]): ReadonlyMap<string, number> {
  return new Map(orderedNodeIds.map((nodeId, index) => [nodeId, index]))
}

/** Resolve the planned node order from current graph wiring, preserving canvas node order for ties. */
export function buildPlannedNodeExecutionOrder(nodes: ModuleGraphNode[], edges: ModuleGraphEdge[]) {
  const nodeIds = nodes.map((node) => node.id)
  const knownNodeIds = new Set(nodeIds)
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const nodeId of nodeIds) {
    inDegree.set(nodeId, 0)
    adjacency.set(nodeId, [])
  }

  for (const edge of edges) {
    if (!knownNodeIds.has(edge.source) || !knownNodeIds.has(edge.target)) {
      continue
    }

    adjacency.get(edge.source)?.push(edge.target)
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
  }

  const queue = nodeIds.filter((nodeId) => (inDegree.get(nodeId) ?? 0) === 0)
  const orderedNodeIds: string[] = []

  while (queue.length > 0) {
    const nodeId = queue.shift() as string
    orderedNodeIds.push(nodeId)

    for (const nextId of adjacency.get(nodeId) ?? []) {
      const nextDegree = (inDegree.get(nextId) ?? 0) - 1
      inDegree.set(nextId, nextDegree)
      if (nextDegree === 0) {
        queue.push(nextId)
      }
    }
  }

  return orderedNodeIds.length === nodes.length ? orderedNodeIds : nodeIds
}

/** Resolve a compact node execution status from the selected execution detail. */
export function getNodeExecutionStatus(params: {
  nodeId: string
  orderedNodeIds: string[]
  nodeOrderIndex: ReadonlyMap<string, number>
  artifactNodeIds: Set<string>
  skippedNodeReasons?: ReadonlyMap<string, ModuleGraphExecutionSkipReason>
  executionStatus: GraphExecutionStatus
  failedNodeId?: string | null
}): ModuleGraphExecutionStatus {
  const { nodeId, orderedNodeIds, nodeOrderIndex, artifactNodeIds, skippedNodeReasons, executionStatus, failedNodeId } = params

  if (artifactNodeIds.has(nodeId)) {
    return 'completed'
  }

  if (skippedNodeReasons?.has(nodeId)) {
    return 'skipped'
  }

  if (executionStatus !== 'failed') {
    return 'idle'
  }

  if (failedNodeId) {
    if (failedNodeId === nodeId) {
      return 'failed'
    }

    const failedIndex = nodeOrderIndex.get(failedNodeId) ?? -1
    const nodeIndex = nodeOrderIndex.get(nodeId) ?? -1
    return failedIndex !== -1 && nodeIndex > failedIndex ? 'blocked' : 'idle'
  }

  const firstMissingExecutedNode = orderedNodeIds.find((orderedNodeId) => !artifactNodeIds.has(orderedNodeId))
  if (!firstMissingExecutedNode) {
    return 'idle'
  }

  if (firstMissingExecutedNode === nodeId) {
    return 'failed'
  }

  const failedIndex = nodeOrderIndex.get(firstMissingExecutedNode) ?? -1
  const nodeIndex = nodeOrderIndex.get(nodeId) ?? -1
  return failedIndex !== -1 && nodeIndex > failedIndex ? 'blocked' : 'idle'
}
