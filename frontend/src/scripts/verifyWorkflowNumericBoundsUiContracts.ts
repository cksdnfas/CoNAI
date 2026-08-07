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
const stepperSource = fs.readFileSync(path.resolve(sourceRoot, 'components/ui/number-stepper-input.tsx'), 'utf8')
const authoringSource = fs.readFileSync(path.resolve(sourceRoot, 'features/image-generation/components/comfy-workflow-authoring-modal.tsx'), 'utf8')
const publicWorkflowSource = fs.readFileSync(path.resolve(sourceRoot, 'features/image-generation/public-comfy-workflow-page.tsx'), 'utf8')

const productFiles = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const absolutePath = path.resolve(directory, entry.name)
  if (entry.isDirectory()) return entry.name === 'scripts' ? [] : productFiles(absolutePath)
  return /\.(ts|tsx)$/.test(entry.name) ? [absolutePath] : []
})
const productSource = productFiles(sourceRoot).map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n')

const retiredDragInputNames = [
  'Scrubbable' + 'NumberInput',
  'scrubbable-number' + '-input',
  'scrub' + 'Ratio',
]
assert.equal(fs.existsSync(path.resolve(sourceRoot, 'components/ui', `${retiredDragInputNames[1]}.tsx`)), false)
for (const retiredName of retiredDragInputNames) assert.equal(productSource.includes(retiredName), false)
assert.doesNotMatch(productSource, /type=["']number["']/)
assert.doesNotMatch(stepperSource, /onPointerMove|setPointerCapture|touch-none|cursor-ew-resize/)
assert.match(stepperSource, /type="text"/)
assert.match(stepperSource, /const \[draft, setDraft\] = React\.useState/)
assert.match(stepperSource, /onBlur=\{\(event\) => \{[\s\S]*commitDraft\(event\.currentTarget\.value\)/)
assert.match(stepperSource, /event\.key === 'Enter'[\s\S]*commitDraft\(event\.currentTarget\.value\)/)
assert.match(stepperSource, /event\.key === 'Escape'[\s\S]*setDraft\(lastCommittedRef\.current\)/)
assert.match(stepperSource, /event\.key === 'ArrowDown'[\s\S]*stepBy\(-1\)/)
assert.match(stepperSource, /event\.key === 'ArrowUp'[\s\S]*stepBy\(1\)/)
assert.match(stepperSource, /min-h-11 min-w-11/)
assert.equal((productSource.match(/<NumberStepperInput\b/g) ?? []).length, 132)
assert.match(authoringSource, /getMarkedFieldNumericDefinitionError\(markedFields\)/)
assert.match(publicWorkflowSource, /findInvalidWorkflowNumberField\(workflowFields/)

console.log('Workflow numeric bounds UI contracts verified')
