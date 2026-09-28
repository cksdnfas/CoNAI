import { MarkerType } from '@xyflow/react'
import { applySavedWorkflowInputMetadataToNodes } from './module-graph-workflow-inputs'
import { resolveMiniMaxDirectorLegacyOutputPortKey } from './module-graph-minimax-director-ports'
import { getModuleNodeDisplayLabel } from './module-graph-module-helpers'
import { buildHandleId, buildModuleEdgePresentation, findNodePort, getModulePortCompatibility, parseHandleId } from './module-graph-ports'
import type { ModuleGraphEdge, ModuleGraphNode, ModuleGraphNodeData } from './module-graph-types'
import type { GraphWorkflowMetadata, GraphWorkflowRecord, ModuleDefinitionRecord } from '@/lib/api-module-graph'

/** Convert a saved graph workflow into React Flow nodes and edges. */
export function buildFlowFromGraphRecord(graph: GraphWorkflowRecord, modules: ModuleDefinitionRecord[]) {
  const moduleMap = new Map(modules.map((module) => [module.id, module]))

  const baseNodes: ModuleGraphNode[] = graph.graph.nodes
    .map<ModuleGraphNode | null>((node) => {
      const module = moduleMap.get(node.module_id)
      if (!module) {
        return null
      }

      const data: ModuleGraphNodeData = {
        module,
        inputValues: node.input_values || {},
      }

      if (node.disabled === true) {
        data.disabled = true
      }

      if (typeof node.label === 'string' && node.label.trim().length > 0) {
        data.label = node.label.trim()
      }

      return {
        id: node.id,
        type: 'module',
        position: node.position,
        data,
      }
    })
    .filter((node): node is ModuleGraphNode => node !== null)

  const nodes = applySavedWorkflowInputMetadataToNodes(baseNodes, graph.graph.metadata?.exposed_inputs)

  const nodeById = new Map(nodes.map((node) => [node.id, node]))

  const edges: ModuleGraphEdge[] = graph.graph.edges.flatMap((edge) => {
    const sourceNode = nodeById.get(edge.source_node_id)
    const targetNode = nodeById.get(edge.target_node_id)
    const sourcePortKey = sourceNode
      ? resolveMiniMaxDirectorLegacyOutputPortKey(sourceNode.data.module, edge.source_port_key)
      : edge.source_port_key
    const sourcePort = findNodePort(sourceNode, 'out', sourcePortKey)
    const targetPort = findNodePort(targetNode, 'in', edge.target_port_key)
    if (!sourcePort || !targetPort || getModulePortCompatibility(sourcePort.data_type, targetPort.data_type) === 'incompatible') {
      return []
    }

    return [{
      id: edge.id,
      source: edge.source_node_id,
      target: edge.target_node_id,
      sourceHandle: buildHandleId('out', sourcePortKey),
      targetHandle: buildHandleId('in', edge.target_port_key),
      markerEnd: { type: MarkerType.ArrowClosed },
      ...buildModuleEdgePresentation(sourcePort, targetPort),
    }]
  })

  return { nodes, edges }
}

/** Build a graph-workflow payload from the current React Flow state. */
export function buildGraphPayload(nodes: ModuleGraphNode[], edges: ModuleGraphEdge[], metadata?: GraphWorkflowMetadata) {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      module_id: node.data.module.id,
      label: getModuleNodeDisplayLabel(node),
      disabled: node.data.disabled === true ? true : undefined,
      position: node.position,
      input_values: node.data.inputValues || {},
    })),
    edges: edges
      .map((edge) => {
        const sourceHandle = parseHandleId(edge.sourceHandle)
        const targetHandle = parseHandleId(edge.targetHandle)

        if (!sourceHandle || !targetHandle) {
          return null
        }

        return {
          id: edge.id,
          source_node_id: edge.source,
          source_port_key: sourceHandle.portKey,
          target_node_id: edge.target,
          target_port_key: targetHandle.portKey,
        }
      })
      .filter((edge): edge is NonNullable<typeof edge> => edge !== null),
    metadata,
  }
}

/** Serialize the editable graph state so UI can compare clean vs dirty changes. */
export function buildGraphEditorSnapshot(params: {
  name: string
  description: string
  nodes: ModuleGraphNode[]
  edges: ModuleGraphEdge[]
  workflowMetadata?: GraphWorkflowMetadata
}) {
  return JSON.stringify({
    name: params.name.trim(),
    description: params.description.trim(),
    graph: buildGraphPayload(params.nodes, params.edges, params.workflowMetadata),
  })
}

/** Arrange graph nodes into simple left-to-right layers based on edge flow. */
export function buildAutoLayoutedNodes(nodes: ModuleGraphNode[], edges: ModuleGraphEdge[]) {
  if (nodes.length === 0) {
    return nodes
  }

  const nodeIds = nodes.map((node) => node.id)
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  const depthByNode = new Map<string, number>()

  for (const node of nodes) {
    inDegree.set(node.id, 0)
    adjacency.set(node.id, [])
    depthByNode.set(node.id, 0)
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target)
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
  }

  const queue = nodeIds.filter((nodeId) => (inDegree.get(nodeId) ?? 0) === 0)
  const visited = new Set<string>()

  while (queue.length > 0) {
    const nodeId = queue.shift() as string
    visited.add(nodeId)
    const currentDepth = depthByNode.get(nodeId) ?? 0

    for (const nextId of adjacency.get(nodeId) ?? []) {
      depthByNode.set(nextId, Math.max(depthByNode.get(nextId) ?? 0, currentDepth + 1))
      const nextDegree = (inDegree.get(nextId) ?? 0) - 1
      inDegree.set(nextId, nextDegree)
      if (nextDegree === 0) {
        queue.push(nextId)
      }
    }
  }

  const fallbackDepthStart = Math.max(...Array.from(depthByNode.values()), 0) + 1
  let fallbackDepth = fallbackDepthStart
  for (const nodeId of nodeIds) {
    if (!visited.has(nodeId)) {
      depthByNode.set(nodeId, fallbackDepth)
      fallbackDepth += 1
    }
  }

  const grouped = new Map<number, ModuleGraphNode[]>()
  for (const node of nodes) {
    const depth = depthByNode.get(node.id) ?? 0
    const bucket = grouped.get(depth) ?? []
    bucket.push(node)
    grouped.set(depth, bucket)
  }

  const xSpacing = 320
  const ySpacing = 180
  const startX = 80
  const startY = 80

  return nodes.map((node) => {
    const depth = depthByNode.get(node.id) ?? 0
    const columnNodes = (grouped.get(depth) ?? []).slice().sort((left, right) => {
      if (left.position.y !== right.position.y) {
        return left.position.y - right.position.y
      }
      return left.id.localeCompare(right.id)
    })
    const rowIndex = columnNodes.findIndex((item) => item.id === node.id)

    return {
      ...node,
      position: {
        x: startX + depth * xSpacing,
        y: startY + Math.max(rowIndex, 0) * ySpacing,
      },
    }
  })
}
