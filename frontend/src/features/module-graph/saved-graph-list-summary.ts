import type { GraphWorkflowRecord, GraphWorkflowSummaryRecord, ModuleDefinitionRecord } from '../../lib/api-module-graph'

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

/**
 * Build one saved workflow summary from the server-computed structure counts (WF-1).
 *
 * 목록 응답에는 그래프 문서가 없다. 노드/엣지 개수는 서버가 SQL 로 계산해 주므로 여기서
 * 그래프를 다시 훑지 않는다. 전체 레코드(by-id)도 같은 카운트 필드를 갖고 있어 그대로 쓸 수 있다.
 */
export function resolveSavedGraphWorkflowSummary(graph: GraphWorkflowSummaryRecord, finalResultNodeCount: number): SavedGraphWorkflowSummary {
  return resolveGraphStructureSummary(graph.node_count, graph.edge_count, finalResultNodeCount)
}

/** Resolve the final-result node count for one list row from the server-computed value. */
export function resolveSavedGraphWorkflowFinalResultNodeCount(graph: GraphWorkflowSummaryRecord) {
  return Math.max(0, Math.floor(graph.final_result_node_count ?? 0))
}

/**
 * Count explicit final-result nodes from a fully loaded workflow document.
 * 선택된 워크플로우처럼 그래프를 이미 들고 있는 화면에서만 쓴다(목록은 서버 카운트를 쓴다).
 */
export function countGraphWorkflowFinalResultNodes(
  graph: GraphWorkflowRecord,
  moduleDefinitionById: Map<number, ModuleDefinitionRecord>,
  isFinalResult: (module: ModuleDefinitionRecord) => boolean,
) {
  return graph.graph.nodes.reduce((count, node) => {
    const module = moduleDefinitionById.get(node.module_id)
    return count + (module && isFinalResult(module) ? 1 : 0)
  }, 0)
}

export function hasAssignedFinalResult(summary: SavedGraphWorkflowSummary) {
  return summary.finalResultNodeCount > 0
}
