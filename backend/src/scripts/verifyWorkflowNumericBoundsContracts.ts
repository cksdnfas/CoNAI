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

const substituted = substituteComfyPromptData(
  JSON.stringify({ 6: { inputs: { length: 73 } } }),
  fields,
  { length: 9000 },
)
assert.equal(substituted['6'].inputs.length, 128)

assert.match(getWorkflowNumericFieldDefinitionError([{ ...fields[0], min: 129, max: 128 }]) ?? '', /min less than or equal to max/)
assert.match(getWorkflowNumericFieldDefinitionError([{ ...fields[0], step: 0 }]) ?? '', /step greater than zero/)
assert.match(getWorkflowNumericFieldDefinitionError([{ ...fields[0], min: Number.NaN }]) ?? '', /invalid min constraint/)
assert.equal(getWorkflowNumericFieldDefinitionError(fields), null)

const sourceContracts = [
  ['backend/src/routes/generation-queue/queue-action-routes.ts', 'prompt_data: normalizeWorkflowNumericPromptValues'],
  ['backend/src/routes/public-workflows.routes.ts', 'prompt_data: normalizeWorkflowNumericPromptValues'],
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
