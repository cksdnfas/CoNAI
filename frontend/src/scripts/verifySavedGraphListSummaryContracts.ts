import { deepEqual, equal } from 'node:assert/strict'
import type { GraphWorkflowRecord } from '../lib/api-module-graph'
import { hasAssignedFinalResult, resolveSavedGraphWorkflowSummary } from '../features/module-graph/saved-graph-list-summary'

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

console.log('Saved graph list summary contracts verified')
