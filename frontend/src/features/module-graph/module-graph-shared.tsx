import { MarkerType, type Edge, type Node } from '@xyflow/react'
import { buildApiUrl } from '@/lib/api-client'
import type {
  GraphExecutionArtifactRecord,
  GraphExecutionStatus,
  GraphWorkflowMetadata,
  GraphWorkflowRecord,
  ModuleDefinitionRecord,
  ModulePortDataType,
  ModulePortDefinition,
} from '@/lib/api'

export type ModuleGraphNodeData = {
  module: ModuleDefinitionRecord
  inputValues: Record<string, unknown>
  executionStatus?: 'idle' | 'completed' | 'failed' | 'blocked'
  executionArtifactCount?: number
  connectedInputKeys?: string[]
  connectedOutputKeys?: string[]
}

export type ModuleGraphNode = Node<ModuleGraphNodeData, 'module'>
export type ModuleGraphEdge = Edge

/** Parse a React Flow handle id and recover the port key. */
export function parseHandleId(handleId?: string | null) {
  if (!handleId) {
    return null
  }

  const [direction, ...rest] = handleId.split(':')
  return {
    direction,
    portKey: rest.join(':'),
  }
}

/** Build a stable React Flow handle id for module ports. */
export function buildHandleId(direction: 'in' | 'out', portKey: string) {
  return `${direction}:${portKey}`
}

/** Read a local file into a data URL for graph input overrides. */
export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file as data URL'))
    reader.readAsDataURL(file)
  })
}

const PORT_TYPE_COLORS: Record<ModulePortDataType, string> = {
  image: '#4fc3f7',
  mask: '#ffb74d',
  prompt: '#ba68c8',
  text: '#81c784',
  number: '#ffd54f',
  boolean: '#ef9a9a',
  json: '#90a4ae',
}

/** Resolve a visible color for module nodes when the module does not define one. */
export function getModuleColor(module: ModuleDefinitionRecord) {
  if (module.color) {
    return module.color
  }

  if (module.engine_type === 'nai') {
    return '#7c4dff'
  }

  if (module.engine_type === 'comfyui') {
    return '#2196f3'
  }

  return '#26a69a'
}

/** Resolve a stable accent color for one module port data type. */
export function getPortTypeColor(dataType: ModulePortDataType) {
  return PORT_TYPE_COLORS[dataType]
}

/** Format timestamps for compact execution history display. */
export function formatDateTime(value?: string | null) {
  if (!value) {
    return '시간 정보 없음'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

/** Map a stored temp artifact path back into a backend-served /temp URL. */
export function getArtifactPreviewUrl(artifact: GraphExecutionArtifactRecord) {
  if (!artifact.storage_path) {
    return null
  }

  const normalized = artifact.storage_path.replace(/\\/g, '/')
  const marker = '/graph-executions/'
  const markerIndex = normalized.lastIndexOf(marker)
  if (markerIndex === -1) {
    return null
  }

  return buildApiUrl(`/temp${normalized.slice(markerIndex)}`)
}

/** Parse a JSON-ish metadata string into an inspectable value. */
export function parseMetadataValue(value?: string | null) {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return value
  }
}

/** Resolve a compact node execution status from the selected execution detail. */
export function getNodeExecutionStatus(params: {
  nodeId: string
  orderedNodeIds: string[]
  artifactNodeIds: Set<string>
  executionStatus: GraphExecutionStatus
  failedNodeId?: string | null
}): 'idle' | 'completed' | 'failed' | 'blocked' {
  const { nodeId, orderedNodeIds, artifactNodeIds, executionStatus, failedNodeId } = params

  if (artifactNodeIds.has(nodeId)) {
    return 'completed'
  }

  if (executionStatus !== 'failed') {
    return 'idle'
  }

  if (failedNodeId) {
    if (failedNodeId === nodeId) {
      return 'failed'
    }

    const failedIndex = orderedNodeIds.indexOf(failedNodeId)
    const nodeIndex = orderedNodeIds.indexOf(nodeId)
    return failedIndex !== -1 && nodeIndex > failedIndex ? 'blocked' : 'idle'
  }

  const firstMissingExecutedNode = orderedNodeIds.find((orderedNodeId) => !artifactNodeIds.has(orderedNodeId))
  if (!firstMissingExecutedNode) {
    return 'idle'
  }

  if (firstMissingExecutedNode === nodeId) {
    return 'failed'
  }

  const failedIndex = orderedNodeIds.indexOf(firstMissingExecutedNode)
  const nodeIndex = orderedNodeIds.indexOf(nodeId)
  return nodeIndex > failedIndex ? 'blocked' : 'idle'
}

/** Resolve one module port from a node/handle pair. */
export function findNodePort(node: ModuleGraphNode | undefined, direction: 'in' | 'out', portKey?: string | null): ModulePortDefinition | null {
  if (!node || !portKey) {
    return null
  }

  const portList = direction === 'out' ? node.data.module.output_ports : node.data.module.exposed_inputs
  return portList.find((port) => port.key === portKey) ?? null
}

/** Build a minimal colored edge style so graph wiring stays readable without extra labels. */
export function buildModuleEdgePresentation(sourcePort: ModulePortDefinition | null, targetPort: ModulePortDefinition | null) {
  const dataType = sourcePort?.data_type ?? targetPort?.data_type ?? null
  const accentColor = dataType ? getPortTypeColor(dataType) : '#94a3b8'

  return {
    label: '',
    style: {
      stroke: accentColor,
      strokeWidth: 2.5,
    },
  }
}

/** Clamp per-port handle offsets so small nodes stay readable. */
export function getPortOffset(index: number, total: number) {
  if (total <= 1) {
    return '50%'
  }

  const step = 100 / (total + 1)
  return `${step * (index + 1)}%`
}

/** Convert a saved graph workflow into React Flow nodes and edges. */
export function buildFlowFromGraphRecord(graph: GraphWorkflowRecord, modules: ModuleDefinitionRecord[]) {
  const moduleMap = new Map(modules.map((module) => [module.id, module]))

  const nodes: ModuleGraphNode[] = graph.graph.nodes
    .map((node) => {
      const module = moduleMap.get(node.module_id)
      if (!module) {
        return null
      }

      return {
        id: node.id,
        type: 'module',
        position: node.position,
        data: {
          module,
          inputValues: node.input_values || {},
        },
      }
    })
    .filter((node): node is ModuleGraphNode => node !== null)

  const edges: ModuleGraphEdge[] = graph.graph.edges.map((edge) => {
    const sourceNode = nodes.find((node) => node.id === edge.source_node_id)
    const targetNode = nodes.find((node) => node.id === edge.target_node_id)
    const sourcePort = findNodePort(sourceNode, 'out', edge.source_port_key)
    const targetPort = findNodePort(targetNode, 'in', edge.target_port_key)

    return {
      id: edge.id,
      source: edge.source_node_id,
      target: edge.target_node_id,
      sourceHandle: buildHandleId('out', edge.source_port_key),
      targetHandle: buildHandleId('in', edge.target_port_key),
      markerEnd: { type: MarkerType.ArrowClosed },
      ...buildModuleEdgePresentation(sourcePort, targetPort),
    }
  })

  return { nodes, edges }
}

/** Build a graph-workflow payload from the current React Flow state. */
export function buildGraphPayload(nodes: ModuleGraphNode[], edges: ModuleGraphEdge[], metadata?: GraphWorkflowMetadata) {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      module_id: node.data.module.id,
      label: node.data.module.name,
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
