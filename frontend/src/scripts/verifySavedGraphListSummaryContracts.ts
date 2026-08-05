import { deepEqual, equal } from 'node:assert/strict'
import type { GraphWorkflowRecord, GraphWorkflowSummaryRecord, ModuleDefinitionRecord } from '../lib/api-module-graph'
import {
  countGraphWorkflowFinalResultNodes,
  hasAssignedFinalResult,
  resolveGraphStructureSummary,
  resolveSavedGraphWorkflowFinalResultNodeCount,
  resolveSavedGraphWorkflowSummary,
} from '../features/module-graph/saved-graph-list-summary'

/**
 * WF-1 계약: 목록 요약은 서버가 계산한 `node_count`/`edge_count`/`final_result_node_count` 만 읽는다.
 * 그래프 문서는 목록 응답에 존재하지 않으므로 요약 계산이 그래프에 의존해서는 안 된다.
 */
function makeWorkflow(nodeCount: number, edgeCount: number): GraphWorkflowRecord {
  return {
    id: 1,
    name: 'Workflow',
    description: null,
    graph: {
      nodes: Array.from({ length: nodeCount }, (_, index) => ({
        id: `node-${index}`,
        module_id: index + 1,
        position: { x: 0, y: 0 },
        input_values: {},
      })),
      edges: Array.from({ length: edgeCount }, (_, index) => ({
        id: `edge-${index}`,
        source_node_id: 'node-0',
        source_port_key: 'out',
        target_node_id: 'node-1',
        target_port_key: 'in',
      })),
    },
    folder_id: null,
    version: 1,
    is_active: true,
    node_count: nodeCount,
    edge_count: edgeCount,
    final_result_node_count: 0,
    created_date: '2026-05-16T00:00:00.000Z',
    updated_date: '2026-05-16T00:00:00.000Z',
  }
}

function makeSummary(nodeCount: number, edgeCount: number, finalResultNodeCount: number): GraphWorkflowSummaryRecord {
  return {
    id: 2,
    name: 'Summary only workflow',
    description: null,
    folder_id: null,
    version: 1,
    is_active: true,
    node_count: nodeCount,
    edge_count: edgeCount,
    final_result_node_count: finalResultNodeCount,
    created_date: '2026-05-16T00:00:00.000Z',
    updated_date: '2026-05-16T00:00:00.000Z',
  }
}

const populated = resolveSavedGraphWorkflowSummary(makeWorkflow(3, 2), 1)
deepEqual(populated, {
  nodeCount: 3,
  edgeCount: 2,
  finalResultNodeCount: 1,
})
equal(hasAssignedFinalResult(populated), true)

const missingFinal = resolveSavedGraphWorkflowSummary(makeWorkflow(1, 0), 0)
deepEqual(missingFinal, {
  nodeCount: 1,
  edgeCount: 0,
  finalResultNodeCount: 0,
})
equal(hasAssignedFinalResult(missingFinal), false)

const fractionalFinal = resolveSavedGraphWorkflowSummary(makeWorkflow(0, 0), 2.8)
deepEqual(fractionalFinal, {
  nodeCount: 0,
  edgeCount: 0,
  finalResultNodeCount: 2,
})
equal(hasAssignedFinalResult(fractionalFinal), true)

const negativeFinal = resolveSavedGraphWorkflowSummary(makeWorkflow(2, 1), -4)
deepEqual(negativeFinal, {
  nodeCount: 2,
  edgeCount: 1,
  finalResultNodeCount: 0,
})
equal(hasAssignedFinalResult(negativeFinal), false)

const currentDraftSummary = resolveGraphStructureSummary(4.9, 3.2, 1.8)
deepEqual(currentDraftSummary, {
  nodeCount: 4,
  edgeCount: 3,
  finalResultNodeCount: 1,
})
equal(hasAssignedFinalResult(currentDraftSummary), true)

const emptyDraftSummary = resolveGraphStructureSummary(-1, -3, 0)
deepEqual(emptyDraftSummary, {
  nodeCount: 0,
  edgeCount: 0,
  finalResultNodeCount: 0,
})
equal(hasAssignedFinalResult(emptyDraftSummary), false)

const moduleDefinitionById = new Map<number, ModuleDefinitionRecord>([
  [1, { id: 1, engine_type: 'system', name: 'final_result' } as unknown as ModuleDefinitionRecord],
  [2, { id: 2, engine_type: 'comfy', name: 'Sampler' } as unknown as ModuleDefinitionRecord],
])
const workflowWithFinalNodes = makeWorkflow(4, 2)
workflowWithFinalNodes.graph.nodes[0].module_id = 1
workflowWithFinalNodes.graph.nodes[1].module_id = 2
workflowWithFinalNodes.graph.nodes[2].module_id = 1
workflowWithFinalNodes.graph.nodes[3].module_id = 999
equal(
  countGraphWorkflowFinalResultNodes(workflowWithFinalNodes, moduleDefinitionById, (module) => module.name === 'final_result'),
  2,
)

// 목록 행은 그래프 없이 서버 카운트만으로 요약을 만들 수 있어야 한다(WF-1).
const summaryOnly = makeSummary(7, 5, 2)
deepEqual(resolveSavedGraphWorkflowSummary(summaryOnly, resolveSavedGraphWorkflowFinalResultNodeCount(summaryOnly)), {
  nodeCount: 7,
  edgeCount: 5,
  finalResultNodeCount: 2,
})
equal(resolveSavedGraphWorkflowFinalResultNodeCount(makeSummary(0, 0, -3)), 0)
equal(resolveSavedGraphWorkflowFinalResultNodeCount(makeSummary(0, 0, 2.9)), 2)
equal(
  'graph' in summaryOnly,
  false,
  'saved workflow list rows must not carry a graph document',
)

console.log('Saved graph list summary contracts verified')
