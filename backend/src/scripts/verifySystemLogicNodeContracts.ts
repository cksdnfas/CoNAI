import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ExecutionContext, ParsedModuleDefinition } from '../services/graph-workflow-executor/shared'
import { executeLogicCompareNode, executeLogicConditionSelectNode } from '../services/graph-workflow-executor/system-logic-operations'
import { validateGraphTypes } from '../services/graph-workflow-executor/validate'
import type { GraphWorkflowNode } from '../types/moduleGraph'

let executionId = 1

function createExecutionContext(): ExecutionContext {
  return {
    executionId,
    workflow: {
      id: 0,
      name: 'system-logic-node-contracts',
      version: 1,
      graph: { nodes: [], edges: [] },
    },
    modulesById: new Map(),
    artifactsByNode: new Map(),
    debugMode: false,
  }
}

const compareNode: GraphWorkflowNode = {
  id: 'node-compare',
  module_id: 1,
  position: { x: 0, y: 0 },
}

const conditionSelectNode: GraphWorkflowNode = {
  id: 'node-condition-select',
  module_id: 2,
  position: { x: 120, y: 0 },
}

const compareModuleDefinition = {
  id: 1,
  name: '비교',
  engine_type: 'system',
  authoring_source: 'manual',
  category: 'logic',
  template_defaults: {},
  exposed_inputs: [
    { key: 'left', label: '왼쪽 값', direction: 'input', data_type: 'any', required: true, multiple: false },
    { key: 'right', label: '오른쪽 값', direction: 'input', data_type: 'any', required: true, multiple: false },
  ],
  output_ports: [
    { key: 'result', label: '결과', direction: 'output', data_type: 'boolean', required: true, multiple: false },
  ],
  internal_fixed_values: { operation_key: 'system.logic_compare' },
  ui_schema: [],
  version: 1,
  is_active: true,
  created_date: new Date(0).toISOString(),
  updated_date: new Date(0).toISOString(),
} satisfies ParsedModuleDefinition

const conditionSelectModuleDefinition = {
  id: 2,
  name: '조건 선택',
  engine_type: 'system',
  authoring_source: 'manual',
  category: 'logic',
  template_defaults: {},
  exposed_inputs: [
    { key: 'condition', label: '조건', direction: 'input', data_type: 'boolean', required: true, multiple: false },
    { key: 'true_value', label: '참 값', direction: 'input', data_type: 'any', required: true, multiple: false },
    { key: 'false_value', label: '거짓 값', direction: 'input', data_type: 'any', required: true, multiple: false },
  ],
  output_ports: [
    { key: 'value', label: '값', direction: 'output', data_type: 'any', required: true, multiple: false },
  ],
  internal_fixed_values: { operation_key: 'system.logic_condition_select' },
  ui_schema: [],
  version: 1,
  is_active: true,
  created_date: new Date(0).toISOString(),
  updated_date: new Date(0).toISOString(),
} satisfies ParsedModuleDefinition

function verifyConditionSelectExecution() {
  const trueContext = createExecutionContext()
  executeLogicConditionSelectNode(trueContext, conditionSelectNode, conditionSelectModuleDefinition, {
    condition: true,
    true_value: 42,
    false_value: 7,
  })
  const trueArtifact = trueContext.artifactsByNode.get(conditionSelectNode.id)?.value
  assert.equal(trueArtifact?.type, 'any', 'condition select should emit a generic value artifact')
  assert.equal(trueArtifact?.value, 42, 'condition select should forward the true value when condition is true')
  assert.equal(trueArtifact?.metadata?.selectedBranch, 'true', 'condition select should record the selected true branch')

  const falseContext = createExecutionContext()
  executeLogicConditionSelectNode(falseContext, conditionSelectNode, conditionSelectModuleDefinition, {
    condition: false,
    true_value: 'A',
    false_value: 'B',
  })
  const falseArtifact = falseContext.artifactsByNode.get(conditionSelectNode.id)?.value
  assert.equal(falseArtifact?.value, 'B', 'condition select should forward the false value when condition is false')
  assert.equal(falseArtifact?.metadata?.selectedBranch, 'false', 'condition select should record the selected false branch')
}

function verifyCompareToConditionSelectFlow() {
  const context = createExecutionContext()
  executeLogicCompareNode(context, compareNode, compareModuleDefinition, {
    left: 5,
    right: 3,
    operator: 'greater_than',
  })
  const comparison = context.artifactsByNode.get(compareNode.id)?.result.value
  executeLogicConditionSelectNode(context, conditionSelectNode, conditionSelectModuleDefinition, {
    condition: comparison,
    true_value: 'larger',
    false_value: 'smaller',
  })

  assert.equal(comparison, true, 'comparison node should output a boolean result')
  assert.equal(
    context.artifactsByNode.get(conditionSelectNode.id)?.value.value,
    'larger',
    'condition select should consume comparison results without duplicating downstream nodes',
  )
}

function verifyConditionSelectGraphTypes() {
  const targetModule: ParsedModuleDefinition = {
    ...conditionSelectModuleDefinition,
    id: 3,
    name: '숫자',
    exposed_inputs: [
      { key: 'number', label: '숫자', direction: 'input', data_type: 'number', required: true, multiple: false },
    ],
    output_ports: [],
    internal_fixed_values: {},
  }

  validateGraphTypes(
    {
      nodes: [
        { id: compareNode.id, module_id: compareModuleDefinition.id, position: { x: 0, y: 0 } },
        { id: conditionSelectNode.id, module_id: conditionSelectModuleDefinition.id, position: { x: 100, y: 0 } },
        { id: 'target-node', module_id: targetModule.id, position: { x: 200, y: 0 } },
      ],
      edges: [
        { id: 'edge-compare-condition', source_node_id: compareNode.id, source_port_key: 'result', target_node_id: conditionSelectNode.id, target_port_key: 'condition' },
        { id: 'edge-select-number', source_node_id: conditionSelectNode.id, source_port_key: 'value', target_node_id: 'target-node', target_port_key: 'number' },
      ],
    },
    new Map([
      [compareModuleDefinition.id, compareModuleDefinition],
      [conditionSelectModuleDefinition.id, conditionSelectModuleDefinition],
      [targetModule.id, targetModule],
    ]),
  )
}

async function main() {
  const tempBasePath = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-system-logic-node-contracts-'))
  process.env.RUNTIME_BASE_PATH = tempBasePath
  let closeUserSettingsDb: (() => void) | null = null

  try {
    const userSettings = await import('../database/userSettingsDb')
    userSettings.initializeUserSettingsDb()
    closeUserSettingsDb = userSettings.closeUserSettingsDb

    const db = userSettings.getUserSettingsDb()
    const workflowId = db.prepare(`
      INSERT INTO graph_workflows (name, graph_json, version)
      VALUES (?, ?, ?)
    `).run('system-logic-node-contracts', JSON.stringify({ nodes: [], edges: [] }), 1).lastInsertRowid as number
    executionId = db.prepare(`
      INSERT INTO graph_executions (graph_workflow_id, graph_version, status)
      VALUES (?, ?, ?)
    `).run(workflowId, 1, 'running').lastInsertRowid as number

    verifyConditionSelectExecution()
    verifyCompareToConditionSelectFlow()
    verifyConditionSelectGraphTypes()
  } finally {
    closeUserSettingsDb?.()
    fs.rmSync(tempBasePath, { recursive: true, force: true })
  }

  console.log('System logic node contracts verified.')
}

void main()
