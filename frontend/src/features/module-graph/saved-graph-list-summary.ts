import type { GraphWorkflowRecord } from '../../lib/api-module-graph'

export type SavedGraphWorkflowSummary = {
  nodeCount: number
  edgeCount: number
  finalResultNodeCount: number
}

export function resolveSavedGraphWorkflowSummary(graph: GraphWorkflowRecord, finalResultNodeCount: number): SavedGraphWorkflowSummary {
  return {
    nodeCount: graph.graph.nodes.length,
    edgeCount: graph.graph.edges.length,
    finalResultNodeCount: Math.max(0, Math.floor(finalResultNodeCount)),
  }
}

export function hasAssignedFinalResult(summary: SavedGraphWorkflowSummary) {
  return summary.finalResultNodeCount > 0
}
