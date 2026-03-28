import {
  type GraphWorkflowDocument,
  type GraphWorkflowNode,
} from '../../types/moduleGraph'
import { type ParsedModuleDefinition } from './shared'

/** Ensure every required module input has a resolved value. */
export function validateRequiredInputs(node: GraphWorkflowNode, moduleDefinition: ParsedModuleDefinition, resolvedInputs: Record<string, any>) {
  const missing = moduleDefinition.exposed_inputs
    .filter((port) => port.required)
    .filter((port) => resolvedInputs[port.key] === undefined || resolvedInputs[port.key] === null || resolvedInputs[port.key] === '')

  if (missing.length > 0) {
    throw new Error(`Node ${node.id} is missing required inputs: ${missing.map((port) => port.key).join(', ')}`)
  }
}

/** Order graph nodes for execution and reject cyclic graphs. */
export function topologicalSort(graph: GraphWorkflowDocument) {
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const node of graph.nodes) {
    inDegree.set(node.id, 0)
    adjacency.set(node.id, [])
  }

  for (const edge of graph.edges) {
    adjacency.get(edge.source_node_id)?.push(edge.target_node_id)
    inDegree.set(edge.target_node_id, (inDegree.get(edge.target_node_id) ?? 0) + 1)
  }

  const queue = Array.from(inDegree.entries())
    .filter(([, degree]) => degree === 0)
    .map(([nodeId]) => nodeId)

  const ordered: string[] = []
  while (queue.length > 0) {
    const nodeId = queue.shift() as string
    ordered.push(nodeId)

    for (const nextId of adjacency.get(nodeId) ?? []) {
      const nextDegree = (inDegree.get(nextId) ?? 0) - 1
      inDegree.set(nextId, nextDegree)
      if (nextDegree === 0) {
        queue.push(nextId)
      }
    }
  }

  if (ordered.length !== graph.nodes.length) {
    throw new Error('Graph contains a cycle and cannot be executed')
  }

  return ordered
}

/** Validate graph edge references and port data-type compatibility. */
export function validateGraphTypes(graph: GraphWorkflowDocument, modulesById: Map<number, ParsedModuleDefinition>) {
  for (const edge of graph.edges) {
    const sourceNode = graph.nodes.find((node) => node.id === edge.source_node_id)
    const targetNode = graph.nodes.find((node) => node.id === edge.target_node_id)
    if (!sourceNode || !targetNode) {
      throw new Error(`Invalid edge ${edge.id}: source or target node not found`)
    }

    const sourceModule = modulesById.get(sourceNode.module_id)
    const targetModule = modulesById.get(targetNode.module_id)
    if (!sourceModule || !targetModule) {
      throw new Error(`Invalid edge ${edge.id}: source or target module not found`)
    }

    const sourcePort = sourceModule.output_ports.find((port) => port.key === edge.source_port_key)
    const targetPort = targetModule.exposed_inputs.find((port) => port.key === edge.target_port_key)
    if (!sourcePort || !targetPort) {
      throw new Error(`Invalid edge ${edge.id}: source or target port not found`)
    }

    if (sourcePort.data_type !== targetPort.data_type) {
      throw new Error(`Invalid edge ${edge.id}: port type mismatch (${sourcePort.data_type} -> ${targetPort.data_type})`)
    }
  }
}
