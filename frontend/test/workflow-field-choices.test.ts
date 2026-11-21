import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CustomDropdownList, WorkflowMarkedField } from '../src/lib/api-image-generation-types'
import {
  autoSelectChoices,
  findWorkflowFieldChoice,
  isHiddenWorkflowField,
  partitionDropdownListsByValue,
  resolveVisibleWorkflowFields,
  resolveWorkflowMarkedField,
  workflowFieldChoices,
} from '../src/features/image-generation/workflow-field-choices'
import { addMarkedFieldOptionLines, applyMarkedFieldPatch } from '../src/features/image-generation/components/comfy-workflow-marked-field-utils'

const list = (id: number, name: string, items: string[], auto = false): CustomDropdownList => ({
  id, name, items, is_auto_collected: auto, source_path: auto ? 'comfyui-default-server-api' : null,
})
const field = (patch: Partial<WorkflowMarkedField>): WorkflowMarkedField => ({ id: 'f', label: 'F', jsonPath: '1.inputs.x', type: 'select', ...patch })

test('effective choices: a dropdown list replaces the options (random first, preview folder); a gone list falls back to them', () => {
  const moss = list(1, 'diffusion_models/MOSS', ['MOSS/a.safetensors', '', 'MOSS/b.safetensors'], true)
  const byName = new Map([[moss.name, moss]])
  const listed = resolveWorkflowMarkedField(field({ dropdown_list_name: moss.name, options: ['manual'] }), byName)
  assert.deepEqual(workflowFieldChoices(listed), ['__random__', 'MOSS/a.safetensors', 'MOSS/b.safetensors'])
  assert.equal(listed.model_preview_folder, 'diffusion_models')
  const gone = resolveWorkflowMarkedField(field({ dropdown_list_name: 'deleted list', options: ['manual'] }), byName)
  assert.deepEqual(workflowFieldChoices(gone), ['manual'], 'the runtime falls back to the field options, without a random pick')
  assert.deepEqual(workflowFieldChoices(field({ type: 'text', options: ['x'] })), [], 'only a select offers choices')
  assert.deepEqual(workflowFieldChoices(field({})), [])
})

test('the default matches a choice regardless of path separators; lists holding it come first', () => {
  const choices = ['__random__', 'MOSS/a.safetensors', 'MOSS/b.safetensors']
  assert.equal(findWorkflowFieldChoice(choices, 'MOSS/b.safetensors'), 'MOSS/b.safetensors')
  assert.equal(findWorkflowFieldChoice(choices, 'MOSS\\b.safetensors'), 'MOSS/b.safetensors', 'a tolerant match stands for the list item')
  assert.equal(findWorkflowFieldChoice(choices, 'MOSS\\gone.safetensors'), null, 'a stale value matches nothing')
  assert.equal(findWorkflowFieldChoice(choices, ''), null)
  assert.equal(findWorkflowFieldChoice(choices, 3), null)
  const lists = [list(1, 'a', ['x']), list(2, 'b', ['MOSS\\b.safetensors']), list(3, 'c', ['y']), list(4, 'd', ['MOSS/b.safetensors'])]
  const parts = partitionDropdownListsByValue(lists, 'MOSS/b.safetensors')
  assert.deepEqual(parts.holding.map((entry) => entry.name), ['b', 'd'])
  assert.deepEqual(parts.others.map((entry) => entry.name), ['a', 'c'])
  assert.deepEqual(partitionDropdownListsByValue(lists, undefined).holding, [])
})

test('hidden fields: only text, textarea, number and select hide; the form gets the visible ones resolved', () => {
  const fields = [
    field({ id: 'text', type: 'text', hidden: true }),
    field({ id: 'area', type: 'textarea', hidden: true }),
    field({ id: 'num', type: 'number', hidden: true }),
    field({ id: 'sel', type: 'select', hidden: true }),
    field({ id: 'img', type: 'image', hidden: true }),
    field({ id: 'node', type: 'node', hidden: true }),
    field({ id: 'shown', type: 'select', dropdown_list_name: 'l' }),
  ]
  assert.deepEqual(fields.filter(isHiddenWorkflowField).map((entry) => entry.id), ['text', 'area', 'num', 'sel'])
  const visible = resolveVisibleWorkflowFields(fields, new Map([['l', list(1, 'l', ['one'])]]))
  assert.deepEqual(visible.map((entry) => entry.id), ['img', 'node', 'shown'])
  assert.deepEqual(visible[2].options, ['__random__', 'one'])
})

test('marked field patches drop hidden when the type can no longer hide', () => {
  const hidden = field({ type: 'text', hidden: true, default_value: 'fixed' })
  assert.equal(applyMarkedFieldPatch(hidden, { type: 'select' }).hidden, true)
  assert.equal(applyMarkedFieldPatch(hidden, { type: 'number' }).hidden, true)
  assert.equal('hidden' in applyMarkedFieldPatch(hidden, { type: 'image' }), false)
  assert.equal('hidden' in applyMarkedFieldPatch(hidden, { type: 'node' }), false)
  assert.equal(applyMarkedFieldPatch(hidden, { label: 'renamed' }).hidden, true)
})

test('a multi-line paste adds one option per line; blanks and duplicates are skipped, commas kept', () => {
  assert.deepEqual(addMarkedFieldOptionLines(['euler'], 'euler\r\ndpmpp_2m, karras\n\n  uni_pc  \ndpmpp_2m, karras\n'), ['euler', 'dpmpp_2m, karras', 'uni_pc'])
  assert.deepEqual(addMarkedFieldOptionLines(undefined, 'one'), ['one'])
})

test('a newly marked combo becomes a select of the server choices only when small and not a model path', async () => {
  assert.deepEqual(autoSelectChoices('sampler_name', 'euler', ['euler', 'dpmpp_2m']), ['euler', 'dpmpp_2m'])
  assert.equal(autoSelectChoices('ckpt_name', 'a.safetensors', ['a.safetensors']), null)
  assert.equal(autoSelectChoices('sampler_name', 'euler', Array.from({ length: 101 }, (_, index) => 's' + index)), null)
  assert.equal(autoSelectChoices('sampler_name', 'euler', []), null)
  assert.equal(autoSelectChoices('sampler_name', 'euler', undefined), null, 'the server check is not in yet')
  assert.equal(autoSelectChoices('steps', 20, ['20']), null, 'only a string input is a combo')

  const { buildWorkflowMarkedFieldFromInput, suggestWorkflowMarkedFields } = await import('../src/features/image-generation/components/comfy-workflow-authoring-graph')
  const choices = { '3.inputs.sampler_name': ['euler', 'dpmpp_2m'], '3.inputs.ckpt_name': ['a.safetensors'] }
  const sampler = buildWorkflowMarkedFieldFromInput('3', 'KSampler', 'KSampler', { key: 'sampler_name', label: 'Sampler name', value: 'euler', inferredType: 'text' }, choices)
  assert.equal(sampler.type, 'select')
  assert.deepEqual(sampler.options, ['euler', 'dpmpp_2m'])
  assert.equal(sampler.default_value, 'euler')
  const unchanged = buildWorkflowMarkedFieldFromInput('3', 'KSampler', 'KSampler', { key: 'sampler_name', label: 'Sampler name', value: 'euler', inferredType: 'text' })
  assert.equal(unchanged.type, 'text', 'without the check the inferred type stays')
  assert.equal(unchanged.options, undefined)
  const model = buildWorkflowMarkedFieldFromInput('3', 'Loader', 'CheckpointLoaderSimple', { key: 'ckpt_name', label: 'Ckpt name', value: 'a.safetensors', inferredType: 'text' }, choices)
  assert.equal(model.type, 'text')
  const graph = {
    hasComfyPositions: false,
    edges: [],
    nodes: [{ id: '3', type: 'comfyAuthoring' as const, position: { x: 0, y: 0 }, data: { title: 'KSampler', classType: 'KSampler', markedJsonPaths: [], onInputSelect: () => undefined, editableInputs: [{ key: 'steps', label: 'Steps', value: 20, inferredType: 'number' as const }] } }],
  }
  assert.deepEqual(suggestWorkflowMarkedFields(graph, new Set(), choices).map((entry) => [entry.id, entry.type]), [['3_steps', 'number']])
})
