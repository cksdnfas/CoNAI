import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'
import {
  buildWorkflowPromptData,
  findInvalidWorkflowNumberField,
  isValidWorkflowNumberDraftValue,
} from '@/features/image-generation/image-generation-drafts'

const field: WorkflowMarkedField = {
  id: 'length',
  label: 'Length',
  jsonPath: '6.inputs.length',
  type: 'number',
  min: 32,
  max: 128,
  step: 32,
}

assert.deepEqual(buildWorkflowPromptData([field], { length: '9000' }), { length: 128 })
assert.deepEqual(buildWorkflowPromptData([field], { length: '-1' }), { length: 32 })
assert.deepEqual(buildWorkflowPromptData([field], { length: '96' }), { length: 96 })
assert.equal(isValidWorkflowNumberDraftValue('9000'), true)
assert.equal(isValidWorkflowNumberDraftValue('not-a-number'), false)
assert.equal(findInvalidWorkflowNumberField([field], { length: 'not-a-number' })?.id, 'length')

const sourceRoot = path.resolve(process.cwd(), 'src')
const scrubbableSource = fs.readFileSync(path.resolve(sourceRoot, 'components/ui/scrubbable-number-input.tsx'), 'utf8')
const authoringSource = fs.readFileSync(path.resolve(sourceRoot, 'features/image-generation/components/comfy-workflow-authoring-modal.tsx'), 'utf8')
const publicWorkflowSource = fs.readFileSync(path.resolve(sourceRoot, 'features/image-generation/public-comfy-workflow-page.tsx'), 'utf8')

assert.match(scrubbableSource, /onBlur=\{\(event\) => \{[\s\S]*commitValue\(\)/)
assert.match(scrubbableSource, /event\.key === 'Enter'[\s\S]*commitValue\(\)/)
assert.match(authoringSource, /getMarkedFieldNumericDefinitionError\(markedFields\)/)
assert.match(publicWorkflowSource, /findInvalidWorkflowNumberField\(workflowFields/)

console.log('Workflow numeric bounds UI contracts verified')
