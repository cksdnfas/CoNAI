import type {
  ModuleGraphClipboardEdge,
  ModuleGraphClipboardNode,
  ModuleGraphClipboardPayload,
  ModuleGraphEdge,
  ModuleGraphNode,
} from './module-graph-types'

/** Build one stable node id for locally created editor nodes. */
export function createModuleGraphNodeId() {
  return `module-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Build one stable edge id for locally created editor edges. */
export function createModuleGraphEdgeId() {
  return `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Deep-clone graph input values so duplicated nodes never share mutable data. */
export function cloneModuleGraphValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }

  if (value === undefined) {
    return value
  }

  return JSON.parse(JSON.stringify(value)) as T
}

/** Build one clipboard payload from the currently selected nodes and their internal edges. */
export function buildModuleGraphClipboardPayload(nodes: ModuleGraphNode[], edges: ModuleGraphEdge[]): ModuleGraphClipboardPayload {
  const selectedNodeIds = new Set(nodes.map((node) => node.id))

  return {
    kind: 'conai/module-graph-selection',
    version: 1,
    nodes: nodes.map((node) => ({
      id: node.id,
      moduleId: node.data.module.id,
      position: { x: node.position.x, y: node.position.y },
      label: node.data.label,
      disabled: node.data.disabled === true ? true : undefined,
      inputValues: cloneModuleGraphValue(node.data.inputValues || {}),
    })),
    edges: edges
      .filter((edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target))
      .map((edge) => ({
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      })),
  }
}

/** Serialize one graph-selection clipboard payload into plain text. */
export function serializeModuleGraphClipboardPayload(payload: ModuleGraphClipboardPayload) {
  return JSON.stringify(payload)
}

/** Parse one graph-selection clipboard payload from plain text when it matches this editor format. */
export function parseModuleGraphClipboardPayload(value: string): ModuleGraphClipboardPayload | null {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as Partial<ModuleGraphClipboardPayload>
    if (parsed.kind !== 'conai/module-graph-selection' || parsed.version !== 1 || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return null
    }

    const nodes = parsed.nodes.filter((node): node is ModuleGraphClipboardNode => (
      typeof node?.id === 'string'
      && typeof node?.moduleId === 'number'
      && typeof node?.position?.x === 'number'
      && typeof node?.position?.y === 'number'
      && (node.label === undefined || typeof node.label === 'string')
      && (node.disabled === undefined || typeof node.disabled === 'boolean')
      && typeof node.inputValues === 'object'
      && node.inputValues !== null
      && !Array.isArray(node.inputValues)
    ))

    const edges = parsed.edges.filter((edge): edge is ModuleGraphClipboardEdge => (
      typeof edge?.source === 'string'
      && typeof edge?.target === 'string'
      && (edge.sourceHandle === undefined || edge.sourceHandle === null || typeof edge.sourceHandle === 'string')
      && (edge.targetHandle === undefined || edge.targetHandle === null || typeof edge.targetHandle === 'string')
    ))

    if (nodes.length === 0 || nodes.length !== parsed.nodes.length || edges.length !== parsed.edges.length) {
      return null
    }

    return {
      kind: 'conai/module-graph-selection',
      version: 1,
      nodes,
      edges,
    }
  } catch {
    return null
  }
}
