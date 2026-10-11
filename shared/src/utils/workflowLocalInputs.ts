import { applyBuiltinNodeVariant, type VariantWorkflowGraph, type VariantWorkflowModule } from './workflowNodeVariantTransition'
import type { ChatWorkflowOperation } from '../types/chatWorkflow'

/** Replay already-validated chat operations against private local inputs before committing any editor state. */
export function replayWorkflowLocalInputs(graph: VariantWorkflowGraph, modules: readonly VariantWorkflowModule[], operations: readonly ChatWorkflowOperation[]) {
  let current: VariantWorkflowGraph = {
    nodes: graph.nodes.map((node) => ({ ...node, input_values: { ...node.input_values }, run_input: node.run_input && { ...node.run_input } })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  }
  for (const operation of operations) {
    if (operation.type === 'add_node') {
      current.nodes.push({ id: operation.nodeId, module_id: operation.moduleId, input_values: {} })
    } else if (operation.type === 'remove_node') {
      current.nodes = current.nodes.filter((node) => node.id !== operation.nodeId)
      current.edges = current.edges.filter((edge) => edge.source_node_id !== operation.nodeId && edge.target_node_id !== operation.nodeId)
    } else if (operation.type === 'disconnect') {
      current.edges = current.edges.filter((edge) => edge.id !== operation.edgeId)
    } else if (operation.type === 'connect') {
      current.edges.push({ id: operation.edgeId, source_node_id: operation.sourceNodeId, source_port_key: operation.sourcePort, target_node_id: operation.targetNodeId, target_port_key: operation.targetPort })
    } else if (operation.type === 'set_variant') {
      current = applyBuiltinNodeVariant(current, modules, operation.nodeId, operation.variantId)
    } else if (operation.type === 'set_input' || operation.type === 'clear_input' || operation.type === 'set_run_input') {
      const node = current.nodes.find((entry) => entry.id === operation.nodeId)
      if (!node) throw new Error('편집할 노드가 없어.')
      const values = node.input_values ??= {}
      if (operation.type === 'set_input') values[operation.key] = operation.value
      else if (operation.type === 'clear_input') delete values[operation.key]
      else {
        node.run_input = { enabled: operation.enabled }
        values.__workflow_input_enabled = operation.enabled
        values.__workflow_input_label = operation.label ?? ''
        values.__workflow_input_description = operation.description ?? ''
        values.__workflow_input_required = true
      }
    }
  }
  return current
}
