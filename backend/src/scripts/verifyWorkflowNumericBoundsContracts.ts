import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { substituteComfyPromptData } from '../services/comfyui/workflowSubstitution'
import {
  getWorkflowNumericFieldDefinitionError,
  normalizeWorkflowNumericPromptValues,
  WorkflowNumericFieldValidationError,
} from '../services/workflowNumericFieldPolicy'
import type { MarkedField } from '../types/workflow'

const projectRoot = path.resolve(process.cwd(), '..')
const fields: MarkedField[] = [{
  id: 'length',
  label: 'Length',
  jsonPath: '6.inputs.length',
  type: 'number',
  default_value: 73,
  min: 32,
  max: 128,
  step: 32,
}]
const directorField: MarkedField = {
  id: 'director',
  label: 'MiniMax H3 Director',
  jsonPath: '42.inputs',
  type: 'node',
  node_editor: 'minimax_h3_director_dasiwa',
  node_numeric_bounds: {
    width: { min: 512, max: 2048 },
    height: { min: 512, max: 2048 },
    duration: { min: 1, max: 10 },
  },
}

assert.deepEqual(normalizeWorkflowNumericPromptValues(fields, { length: 9000, prompt: 'keep' }), {
  length: 128,
  prompt: 'keep',
})
assert.equal(normalizeWorkflowNumericPromptValues(fields, { length: -1 }).length, 32)
assert.equal(normalizeWorkflowNumericPromptValues(fields, { length: '96' }).length, 96)
const normalizedDefault: Record<string, unknown> = normalizeWorkflowNumericPromptValues(fields, {})
assert.equal(normalizedDefault.length, 73)
assert.throws(
  () => normalizeWorkflowNumericPromptValues(fields, { length: 'not-a-number' }),
  WorkflowNumericFieldValidationError,
)

const normalizedDirector = normalizeWorkflowNumericPromptValues([directorField], {
  director: {
    width: 256,
    height: 4096,
    duration: 12,
    prompt: 'keep',
    ref2va_model: ['11', 0],
  },
}).director
assert.equal(normalizedDirector.width, 512)
assert.equal(normalizedDirector.height, 2048)
assert.equal(normalizedDirector.duration, 10)
assert.equal(normalizedDirector.prompt, 'keep')
assert.deepEqual(normalizedDirector.ref2va_model, ['11', 0])
assert.deepEqual(
  normalizeWorkflowNumericPromptValues([directorField], { director: { width: ['72', 0] } }).director.width,
  ['72', 0],
  'connected Director inputs must not be normalized as local numbers',
)
assert.equal(
  normalizeWorkflowNumericPromptValues([{ ...directorField, node_numeric_bounds: undefined }], { director: { duration: 1000 } }).director.duration,
  60,
  'Director duration must retain its one-minute hard maximum without workflow overrides',
)

const substituted = substituteComfyPromptData(
  JSON.stringify({ 6: { inputs: { length: 73 } } }),
  fields,
  { length: 9000 },
)
assert.equal(substituted['6'].inputs.length, 128)

const substitutedDirector = substituteComfyPromptData(
  JSON.stringify({ 42: { inputs: { width: 1344, height: 768, duration: 5 } } }),
  [directorField],
  { director: { width: 256, height: 4096, duration: 12 } },
)
assert.deepEqual(substitutedDirector['42'].inputs, { width: 512, height: 2048, duration: 10 })

assert.match(getWorkflowNumericFieldDefinitionError([{ ...fields[0], min: 129, max: 128 }]) ?? '', /min less than or equal to max/)
assert.match(getWorkflowNumericFieldDefinitionError([{ ...fields[0], step: 0 }]) ?? '', /step greater than zero/)
assert.match(getWorkflowNumericFieldDefinitionError([{ ...fields[0], min: Number.NaN }]) ?? '', /invalid min constraint/)
assert.equal(getWorkflowNumericFieldDefinitionError(fields), null)
assert.match(
  getWorkflowNumericFieldDefinitionError([{
    ...directorField,
    node_numeric_bounds: { width: { min: 2049, max: 2048 } },
  }]) ?? '',
  /min less than or equal to max/,
)
assert.match(
  getWorkflowNumericFieldDefinitionError([{
    ...directorField,
    node_numeric_bounds: { duration: { max: 61 } },
  }]) ?? '',
  /max between 1 and 60/,
)
assert.match(
  getWorkflowNumericFieldDefinitionError([{
    ...directorField,
    node_numeric_bounds: { duration: { min: Number.NaN } },
  }]) ?? '',
  /invalid min constraint/,
)
assert.equal(getWorkflowNumericFieldDefinitionError([directorField]), null)

const sourceContracts = [
  ['backend/src/routes/generation-queue/queue-action-routes.ts', 'normalizeWorkflowNumericPromptValues(workflowMarkedFields, promptData)'],
  ['backend/src/routes/public-workflows.routes.ts', 'normalizeWorkflowNumericPromptValues(parseMarkedFields(workflow.marked_fields), promptData'],
  ['backend/src/routes/workflows/execution.routes.ts', 'normalizedPromptData = normalizeWorkflowNumericPromptValues'],
  ['backend/src/services/graph-workflow-executor/execute-comfy.ts', 'return normalizeWorkflowNumericPromptValues(markedFields, promptData)'],
  ['backend/src/services/comfyui/workflowSubstitution.ts', 'const normalizedPromptData = normalizeWorkflowNumericPromptValues'],
  ['backend/src/routes/workflows/crud.routes.ts', 'getWorkflowNumericFieldDefinitionError(marked_fields)'],
] as const

for (const [relativePath, requiredSource] of sourceContracts) {
  const source = fs.readFileSync(path.resolve(projectRoot, relativePath), 'utf8')
  assert.ok(source.includes(requiredSource), `${relativePath} must include ${requiredSource}`)
}

console.log('Workflow numeric bounds contracts verified')
