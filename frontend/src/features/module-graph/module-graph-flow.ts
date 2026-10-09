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

const AUTO_LAYOUT_COLUMN_GAP = 96
const AUTO_LAYOUT_ROW_GAP = 40
const AUTO_LAYOUT_ORIGIN = 80
const AUTO_LAYOUT_FALLBACK_SIZE = { width: 260, height: 180 }

/** Measured size of one rendered node (React Flow fills `measured` once the card is on screen). */
function getLayoutNodeSize(node: ModuleGraphNode) {
  return {
    width: node.measured?.width ?? node.width ?? AUTO_LAYOUT_FALLBACK_SIZE.width,
    height: node.measured?.height ?? node.height ?? AUTO_LAYOUT_FALLBACK_SIZE.height,
  }
}

/**
 * Arrange graph nodes into left-to-right columns by edge flow, using each card's real size so nothing overlaps.
 * Source-only nodes sit one column before their first consumer, and each column is ordered by where its neighbours
 * sit to keep links from crossing. Nodes with no links wrap into a grid under the flow instead of one tall column.
 */
export function buildAutoLayoutedNodes(allNodes: ModuleGraphNode[], edges: ModuleGraphEdge[]) {
  if (allNodes.length === 0) {
    return allNodes
  }

  const allNodeIds = new Set(allNodes.map((node) => node.id))
  const linkedNodeIds = new Set<string>()
  for (const edge of edges) {
    if (allNodeIds.has(edge.source) && allNodeIds.has(edge.target) && edge.source !== edge.target) {
      linkedNodeIds.add(edge.source)
      linkedNodeIds.add(edge.target)
    }
  }
  const nodes = allNodes.filter((node) => linkedNodeIds.has(node.id))
  const isolatedNodes = allNodes
    .filter((node) => !linkedNodeIds.has(node.id))
    .sort((left, right) => (left.position.y - right.position.y) || (left.position.x - right.position.x) || left.id.localeCompare(right.id))
  const positionById = new Map<string, { x: number; y: number }>()
  const flowBounds = nodes.length > 0 ? layoutLinkedNodes(nodes, edges, positionById) : null
  placeIsolatedNodes(isolatedNodes, flowBounds, positionById)

  return allNodes.map((node) => ({
    ...node,
    position: positionById.get(node.id) ?? node.position,
  }))
}

/** Wrap unlinked nodes into rows under the flow (or at the origin when nothing is linked), about as wide as the flow. */
function placeIsolatedNodes(
  nodes: ModuleGraphNode[],
  flowBounds: { width: number; height: number } | null,
  positionById: Map<string, { x: number; y: number }>,
) {
  if (nodes.length === 0) {
    return
  }
  const sizes = nodes.map(getLayoutNodeSize)
  const averageWidth = sizes.reduce((sum, size) => sum + size.width, 0) / sizes.length
  const squareColumns = Math.ceil(Math.sqrt(nodes.length * 1.5))
  const rowWidth = Math.max(flowBounds?.width ?? 0, squareColumns * (averageWidth + AUTO_LAYOUT_COLUMN_GAP) - AUTO_LAYOUT_COLUMN_GAP)
  const startY = AUTO_LAYOUT_ORIGIN + (flowBounds ? flowBounds.height + AUTO_LAYOUT_COLUMN_GAP : 0)

  let cursorX = 0
  let rowY = startY
  let rowHeight = 0
  nodes.forEach((node, index) => {
    const size = sizes[index]
    if (cursorX > 0 && cursorX + size.width > rowWidth) {
      cursorX = 0
      rowY += rowHeight + AUTO_LAYOUT_ROW_GAP
      rowHeight = 0
    }
    positionById.set(node.id, { x: Math.round(AUTO_LAYOUT_ORIGIN + cursorX), y: Math.round(rowY) })
    cursorX += size.width + AUTO_LAYOUT_COLUMN_GAP
    rowHeight = Math.max(rowHeight, size.height)
  })
}

/** Column layout of the linked nodes; returns the size it took up. */
function layoutLinkedNodes(
  nodes: ModuleGraphNode[],
  edges: ModuleGraphEdge[],
  positionById: Map<string, { x: number; y: number }>,
) {
  const nodeIds = nodes.map((node) => node.id)
  const nodeIdSet = new Set(nodeIds)
  const inDegree = new Map<string, number>()
  const parents = new Map<string, string[]>()
  const children = new Map<string, string[]>()
  const depthByNode = new Map<string, number>()

  for (const node of nodes) {
    inDegree.set(node.id, 0)
    parents.set(node.id, [])
    children.set(node.id, [])
    depthByNode.set(node.id, 0)
  }

  for (const edge of edges) {
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target) || edge.source === edge.target) {
      continue
    }
    children.get(edge.source)?.push(edge.target)
    parents.get(edge.target)?.push(edge.source)
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
  }

  const queue = nodeIds.filter((nodeId) => (inDegree.get(nodeId) ?? 0) === 0)
  const visited = new Set<string>()

  while (queue.length > 0) {
    const nodeId = queue.shift() as string
    visited.add(nodeId)
    const currentDepth = depthByNode.get(nodeId) ?? 0

    for (const nextId of children.get(nodeId) ?? []) {
      depthByNode.set(nextId, Math.max(depthByNode.get(nextId) ?? 0, currentDepth + 1))
      const nextDegree = (inDegree.get(nextId) ?? 0) - 1
      inDegree.set(nextId, nextDegree)
      if (nextDegree === 0) {
        queue.push(nextId)
      }
    }
  }

  // Nodes left in a cycle get their own columns after everything else.
  let fallbackDepth = Math.max(...Array.from(depthByNode.values()), 0) + 1
  for (const nodeId of nodeIds) {
    if (!visited.has(nodeId)) {
      depthByNode.set(nodeId, fallbackDepth)
      fallbackDepth += 1
    }
  }

  // A text or image source feeding only a late node moves next to it instead of stretching a link across the graph.
  for (const nodeId of nodeIds) {
    const nodeChildren = children.get(nodeId) ?? []
    if ((parents.get(nodeId) ?? []).length === 0 && nodeChildren.length > 0) {
      const firstConsumerDepth = Math.min(...nodeChildren.map((childId) => depthByNode.get(childId) ?? 0))
      depthByNode.set(nodeId, Math.max(0, firstConsumerDepth - 1))
    }
  }

  const depths = Array.from(new Set(depthByNode.values())).sort((left, right) => left - right)
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const columns = depths.map((depth) => nodes
    .filter((node) => depthByNode.get(node.id) === depth)
    .sort((left, right) => (left.position.y - right.position.y) || left.id.localeCompare(right.id))
    .map((node) => node.id))

  const rankOf = new Map<string, number>()
  const writeRanks = () => {
    for (const column of columns) {
      column.forEach((nodeId, index) => rankOf.set(nodeId, column.length > 1 ? index / (column.length - 1) : 0.5))
    }
  }
  const sortColumnBy = (column: string[], neighboursOf: Map<string, string[]>) => {
    const keyed = column.map((nodeId) => {
      const neighbours = (neighboursOf.get(nodeId) ?? []).filter((neighbourId) => rankOf.has(neighbourId))
      const key = neighbours.length > 0
        ? neighbours.reduce((sum, neighbourId) => sum + (rankOf.get(neighbourId) ?? 0), 0) / neighbours.length
        : (rankOf.get(nodeId) ?? 0.5)
      return { nodeId, key }
    })
    keyed.sort((left, right) => left.key - right.key)
    column.splice(0, column.length, ...keyed.map((entry) => entry.nodeId))
  }

  writeRanks()
  for (let sweep = 0; sweep < 2; sweep += 1) {
    for (let index = 1; index < columns.length; index += 1) {
      sortColumnBy(columns[index], parents)
      writeRanks()
    }
    for (let index = columns.length - 2; index >= 0; index -= 1) {
      sortColumnBy(columns[index], children)
      writeRanks()
    }
  }

  const columnWidths = columns.map((column) => Math.max(...column.map((nodeId) => getLayoutNodeSize(nodeById.get(nodeId) as ModuleGraphNode).width)))
  const columnHeights = columns.map((column) => column.reduce((sum, nodeId) => sum + getLayoutNodeSize(nodeById.get(nodeId) as ModuleGraphNode).height, 0) + AUTO_LAYOUT_ROW_GAP * Math.max(column.length - 1, 0))
  const tallestColumn = Math.max(...columnHeights)

  let columnX = AUTO_LAYOUT_ORIGIN
  columns.forEach((column, columnIndex) => {
    let rowY = AUTO_LAYOUT_ORIGIN + (tallestColumn - columnHeights[columnIndex]) / 2
    for (const nodeId of column) {
      positionById.set(nodeId, { x: Math.round(columnX), y: Math.round(rowY) })
      rowY += getLayoutNodeSize(nodeById.get(nodeId) as ModuleGraphNode).height + AUTO_LAYOUT_ROW_GAP
    }
    columnX += columnWidths[columnIndex] + AUTO_LAYOUT_COLUMN_GAP
  })

  return { width: columnX - AUTO_LAYOUT_COLUMN_GAP - AUTO_LAYOUT_ORIGIN, height: tallestColumn }
}
