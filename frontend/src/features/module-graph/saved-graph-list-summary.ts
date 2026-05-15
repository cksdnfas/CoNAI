import type { GraphWorkflowRecord } from '../../lib/api-module-graph'

export type SavedGraphWorkflowSummary = {
  nodeCount: number
  edgeCount: number
  finalResultNodeCount: number
}

export function resolveGraphStructureSummary(nodeCount: number, edgeCount: number, finalResultNodeCount: number): SavedGraphWorkflowSummary {
  return {
    nodeCount: Math.max(0, Math.floor(nodeCount)),
    edgeCount: Math.max(0, Math.floor(edgeCount)),
    finalResultNodeCount: Math.max(0, Math.floor(finalResultNodeCount)),
  }
}

export function resolveSavedGraphWorkflowSummary(graph: GraphWorkflowRecord, finalResultNodeCount: number): SavedGraphWorkflowSummary {
  return resolveGraphStructureSummary(graph.graph.nodes.length, graph.graph.edges.length, finalResultNodeCount)
}

export function hasAssignedFinalResult(summary: SavedGraphWorkflowSummary) {
  return summary.finalResultNodeCount > 0
}
