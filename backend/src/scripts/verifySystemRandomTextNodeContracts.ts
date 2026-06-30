import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ExecutionContext, ParsedModuleDefinition } from '../services/graph-workflow-executor/shared'
import { executeRandomTextChoiceNode } from '../services/graph-workflow-executor/system-text-operations'
import { validateGraphTypes } from '../services/graph-workflow-executor/validate'
import type { GraphWorkflowNode } from '../types/moduleGraph'

let executionId = 1

function createExecutionContext(): ExecutionContext {
  return {
    executionId,
    workflow: {
      id: 0,
      name: 'system-random-text-node-contracts',
      version: 1,
      graph: { nodes: [], edges: [] },
    },
    modulesById: new Map(),
    artifactsByNode: new Map(),
    debugMode: false,
  }
}

const node: GraphWorkflowNode = {
  id: 'node-random-text',
  module_id: 1,
  position: { x: 0, y: 0 },
}

const moduleDefinition = {
  id: 1,
  name: '랜덤 항목 출력',
  engine_type: 'system',
  authoring_source: 'manual',
  category: 'utility',
  template_defaults: {},
  exposed_inputs: [
    { key: 'options', label: '항목 후보', direction: 'input', data_type: 'json', required: false, multiple: false },
  ],
  output_ports: [
    { key: 'text', label: '값', direction: 'output', data_type: 'any', required: true, multiple: false },
  ],
  internal_fixed_values: { operation_key: 'system.random_text_choice' },
  ui_schema: [
    { key: 'output_type', label: '출력 타입', data_type: 'select', default_value: 'text', options: ['text', 'number', 'boolean', 'json', 'any'] },
  ],
  version: 1,
  is_active: true,
  created_date: new Date(0).toISOString(),
  updated_date: new Date(0).toISOString(),
} satisfies ParsedModuleDefinition

function executeRandomText(inputs: Record<string, unknown>) {
  const context = createExecutionContext()
  executeRandomTextChoiceNode(context, node, moduleDefinition, inputs)
  return context.artifactsByNode.get(node.id)?.text.value
}

function executeRandomTextArtifact(inputs: Record<string, unknown>) {
  const context = createExecutionContext()
  executeRandomTextChoiceNode(context, node, moduleDefinition, inputs)
  return context.artifactsByNode.get(node.id)?.text
}

function verifyRandomTextChoiceExecution() {
  const originalRandom = Math.random
  try {
    Math.random = () => 0
    assert.equal(
      executeRandomText({
      options: [
        { key: 'text_1', value: 'fallback-a' },
        { key: 'text_2', value: '' },
      ],
      'options.text_1': 'connected-a',
      'options.text_2': 'connected-b',
      }),
      'connected-a',
      'random index 0 should select the first connected dynamic candidate',
    )

    Math.random = () => 0.999
    assert.equal(
      executeRandomText({
        options: [
          { key: 'text_1', value: 'fallback-a' },
          { key: 'text_2', value: '' },
        ],
        'options.text_1': 'connected-a',
        'options.text_2': 'connected-b',
      }),
      'connected-b',
      'highest random value should select the last connected dynamic candidate',
    )

    Math.random = () => 0
    assert.equal(
      executeRandomText({
        options: [
          { key: 'text_1', value: 'fallback-a' },
          { key: 'text_2', value: 'fallback-b' },
        ],
        'options.text_2': 'connected-b',
      }),
      'fallback-a',
      'partially connected random text choices should preserve configured row order',
    )

    Math.random = () => 0.999
    assert.equal(
      executeRandomText({
        options: [
          { key: 'text_1', value: 'fallback-a' },
          { key: 'text_2', value: 'fallback-b' },
        ],
        'options.text_2': 'connected-b',
        'options.text_3': 'connected-c',
      }),
      'connected-c',
      'unlisted connected random text choices should append after configured rows',
    )

    assert.equal(executeRandomText({ options: [] }), '', 'empty candidate list should emit an empty text artifact')

    const numberArtifact = executeRandomTextArtifact({
      output_type: 'number',
      options: [
        { key: 'number_1', value: '3.5' },
        { key: 'number_2', value: 'not-number' },
      ],
    })
    assert.equal(numberArtifact?.type, 'number', 'number mode should emit a number artifact')
    assert.equal(numberArtifact?.value, 3.5, 'number mode should coerce valid numeric candidates')

    const booleanArtifact = executeRandomTextArtifact({
      output_type: 'boolean',
      options: [
        { key: 'boolean_1', value: 'false' },
      ],
    })
    assert.equal(booleanArtifact?.type, 'boolean', 'boolean mode should emit a boolean artifact')
    assert.equal(booleanArtifact?.value, false, 'boolean mode should preserve false as a selectable candidate')

    const jsonArtifact = executeRandomTextArtifact({
      output_type: 'json',
      options: [
        { key: 'json_1', value: '{"ok":true}' },
      ],
    })
    assert.equal(jsonArtifact?.type, 'json', 'json mode should emit a json artifact')
    assert.deepEqual(jsonArtifact?.value, { ok: true }, 'json mode should parse configured JSON candidate values')
  } finally {
    Math.random = originalRandom
  }
}

function verifyDynamicTextInputValidation() {
  const sourceModule: ParsedModuleDefinition = {
    ...moduleDefinition,
    id: 2,
    name: '숫자',
    exposed_inputs: [],
    internal_fixed_values: {},
    output_ports: [
      { key: 'number', label: '숫자', direction: 'output', data_type: 'number', required: true, multiple: false },
    ],
  }

  validateGraphTypes(
    {
      nodes: [
        { id: 'source-node', module_id: sourceModule.id, position: { x: 0, y: 0 } },
        { id: 'random-node', module_id: moduleDefinition.id, position: { x: 100, y: 0 } },
      ],
      edges: [
        { id: 'edge-number-random', source_node_id: 'source-node', source_port_key: 'number', target_node_id: 'random-node', target_port_key: 'options.text_1' },
      ],
    },
    new Map([
      [sourceModule.id, sourceModule],
      [moduleDefinition.id, moduleDefinition],
    ]),
  )
}

function verifyPartialRunReusePolicy() {
  const executorSource = fs.readFileSync(path.join(__dirname, '../services/graphWorkflowExecutor.ts'), 'utf8')
  assert(
    executorSource.includes("'system.random_text_choice'"),
    'random text choice nodes must be classified as volatile for partial-run cache reuse',
  )
  assert(
    executorSource.includes("'system.apply_wildcards'"),
    'wildcard transform nodes must be classified as volatile because wildcard expansion can be random',
  )
  assert(
    executorSource.includes('collectVolatileAffectedNodeIds'),
    'partial-run reuse should collect volatile nodes and their downstream dependents',
  )
  assert(
    executorSource.includes('!volatileAffectedNodeIds.has(nodeId)'),
    'partial-run reusable node list must exclude volatile nodes and downstream dependents',
  )
}

async function main() {
  const tempBasePath = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-system-random-text-node-contracts-'))
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
    `).run('system-random-text-node-contracts', JSON.stringify({ nodes: [], edges: [] }), 1).lastInsertRowid as number
    executionId = db.prepare(`
      INSERT INTO graph_executions (graph_workflow_id, graph_version, status)
      VALUES (?, ?, ?)
    `).run(workflowId, 1, 'running').lastInsertRowid as number

    verifyRandomTextChoiceExecution()
    verifyDynamicTextInputValidation()
    verifyPartialRunReusePolicy()
  } finally {
    closeUserSettingsDb?.()
    fs.rmSync(tempBasePath, { recursive: true, force: true })
  }

  console.log('System random text node contracts verified.')
}

void main()
