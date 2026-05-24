import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { GraphWorkflowDocument, ModulePortDefinition } from '../types/moduleGraph'
import { reconcileGraphForModuleDefinitionUpdate } from '../models/ModuleDefinition'

const textInput = (key: string): ModulePortDefinition => ({
  key,
  label: key,
  direction: 'input',
  data_type: 'text',
  required: false,
  multiple: false,
})

const textOutput = (key: string): ModulePortDefinition => ({
  key,
  label: key,
  direction: 'output',
  data_type: 'text',
  required: false,
  multiple: false,
})

function verifyStaleGraphReferencesArePruned() {
  const graph: GraphWorkflowDocument = {
    nodes: [
      {
        id: 'module-target',
        module_id: 10,
        position: { x: 0, y: 0 },
        input_values: {
          old_input: 'stale value',
          new_input: 'survives',
        },
      },
      {
        id: 'module-source',
        module_id: 10,
        position: { x: 200, y: 0 },
      },
      {
        id: 'module-other',
        module_id: 11,
        position: { x: 400, y: 0 },
        input_values: { old_input: 'unrelated module survives' },
      },
    ],
    edges: [
      {
        id: 'stale-target-port',
        source_node_id: 'module-source',
        source_port_key: 'new_output',
        target_node_id: 'module-target',
        target_port_key: 'old_input',
      },
      {
        id: 'stale-source-port',
        source_node_id: 'module-source',
        source_port_key: 'old_output',
        target_node_id: 'module-other',
        target_port_key: 'old_input',
      },
      {
        id: 'valid-edge',
        source_node_id: 'module-source',
        source_port_key: 'new_output',
        target_node_id: 'module-target',
        target_port_key: 'new_input',
      },
    ],
    metadata: {
      exposed_inputs: [
        {
          id: 'target-old-input',
          node_id: 'module-target',
          port_key: 'old_input',
          label: 'Old Input',
          data_type: 'text',
          module_id: 10,
        },
        {
          id: 'target-new-input',
          node_id: 'module-target',
          port_key: 'new_input',
          label: 'New Input',
          data_type: 'text',
          module_id: 10,
        },
        {
          id: 'other-old-input',
          node_id: 'module-other',
          port_key: 'old_input',
          label: 'Other Input',
          data_type: 'text',
          module_id: 11,
        },
      ],
    },
  }

  const result = reconcileGraphForModuleDefinitionUpdate(graph, 10, {
    exposed_inputs: [textInput('new_input')],
    output_ports: [textOutput('new_output')],
  })

  assert.equal(result.changed, true)
  assert.deepEqual(result.removedEdgeIds.sort(), ['stale-source-port', 'stale-target-port'])
  assert.deepEqual(result.prunedInputValueKeys, [
    { nodeId: 'module-target', keys: ['old_input'] },
  ])
  assert.deepEqual(result.removedExposedInputIds, ['target-old-input'])
  assert.deepEqual(result.graph.edges.map((edge) => edge.id), ['valid-edge'])
  assert.deepEqual(result.graph.nodes[0]?.input_values, { new_input: 'survives' })
  assert.deepEqual(result.graph.nodes[2]?.input_values, { old_input: 'unrelated module survives' })
  assert.deepEqual(result.graph.metadata?.exposed_inputs?.map((input) => input.id), ['target-new-input', 'other-old-input'])
}

function verifyBackgroundQueueFailureIsTerminal() {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/services/graphWorkflowExecutionQueue.ts'), 'utf8')
  assert.match(
    source,
    /try\s*{[\s\S]*await GraphWorkflowExecutor\.execute\(job\.workflowId,[\s\S]*}\s*catch \(error\)\s*{[\s\S]*GraphExecutionModel\.updateStatus\(job\.executionId, 'failed'/,
    'background graph queue must mark pre-execution validator errors as failed instead of leaving rows running',
  )
  assert.match(
    source,
    /eventType:\s*'execution_failed'/,
    'background graph queue failure fallback must write an execution_failed log entry',
  )
  assert.match(
    source,
    /if \(execution\.status === 'running'\) \{[\s\S]*GraphExecutionModel\.updateStatus\(executionId, 'failed', STRANDED_RUNNING_EXECUTION_MESSAGE\)/,
    'cancel on stranded running execution should mark it failed instead of returning already running',
  )
}

verifyStaleGraphReferencesArePruned()
verifyBackgroundQueueFailureIsTerminal()

console.log('✅ Module definition reconcile contracts verified')
