import { applyBuiltinNodeVariant } from '@conai/shared'
import type { ModuleDefinitionRecord } from '@/lib/api-module-graph'
import { buildGraphPayload } from './module-graph-flow'
import type { ModuleGraphEdge, ModuleGraphNode } from './module-graph-types'
import { deriveWorkflowExposedInputsFromNodes } from './module-graph-workflow-inputs'

/** Apply the same lossless transition as chat proposals against complete local values (including private inputs). */
export function changeModuleGraphNodeVariant(
  nodes: ModuleGraphNode[],
  edges: ModuleGraphEdge[],
  modules: ModuleDefinitionRecord[],
  nodeId: string,
  variantId: string,
) {
  const graph = buildGraphPayload(nodes, edges, { exposed_inputs: deriveWorkflowExposedInputsFromNodes(nodes) })
  const next = applyBuiltinNodeVariant(graph, modules, nodeId, variantId)
  const changed = next.nodes.find((node) => node.id === nodeId)!
  const module = modules.find((entry) => entry.id === changed.module_id)!
  return nodes.map((node) => node.id === nodeId ? {
    ...node,
    data: {
      module,
      label: changed.label,
      disabled: node.data.disabled,
      inputValues: changed.input_values,
    },
  } : node)
}
