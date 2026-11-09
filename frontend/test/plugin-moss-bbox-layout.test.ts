import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addRegion, buildLayout, buildPromptData, guessFieldMapping, mappingIssues, newDraft, optionProblem, parseLayoutPrompt, parseRatio, ratioValue, setOptionValue,
  sizeFromRatio, splitOptionFields, stringifyLayout, withDropdownOptions,
} from '../../plugins/moss-bbox-studio/layout.js'

// MOSS-Image USERGUIDE: on a 1536×1024 canvas the editable draft box [176,224,800,864] (xyxy, from the top-left)
// is [-288,-592,352,32] in the model prompt (yxyx, from the centre).
const MOSS_DRAFT_BOX = [176 / 1536, 224 / 1024, 800 / 1536, 864 / 1024]

test('boxes are written in the model coordinate system', () => {
  const draft = newDraft([1536, 1024])
  draft.summary = 'A poster.'
  addRegion(draft, { label: 'text', caption: 'A title.', text: 'EXPLORE', box: MOSS_DRAFT_BOX })
  const layout = buildLayout(draft)
  assert.deepEqual(layout.items[0].bbox, [-288, -592, 352, 32])
  assert.equal(layout.items[0].text, 'EXPLORE')
  assert.equal(layout.bbox_format, 'yxyx')
  assert.equal(layout.bbox_coord_space, 'abs_centralized')
})

test('a layout written by the plugin reads back to the same boxes, and other box formats are understood', () => {
  const draft = newDraft([1088, 1920])
  draft.summary = 'Two women.'
  draft.meta = ['illustration']
  addRegion(draft, { label: 'character', caption: 'A blonde woman.', box: [0, 0.08, 0.49, 0.98] })
  addRegion(draft, { label: 'object', caption: 'A ring.', box: [0.02, 0.03, 0.98, 0.43] })
  const read = parseLayoutPrompt(stringifyLayout(draft), draft.size)
  assert.ok(read)
  assert.equal(read.draft.summary, 'Two women.')
  assert.deepEqual(read.draft.meta, ['illustration'])
  read.draft.items.forEach((item: { label: string; caption: string; box: number[] }, index: number) => {
    assert.equal(item.label, draft.items[index].label)
    assert.equal(item.caption, draft.items[index].caption)
    item.box.forEach((value: number, corner: number) => assert.ok(Math.abs(value - draft.items[index].box[corner]) < 0.002))
  })

  const relative = parseLayoutPrompt(JSON.stringify({ summary: { caption: 'x' }, bbox_format: 'xywh', bbox_coord_space: 'relative', items: [{ type: 'text', caption: 'WAR', bbox: [0.68, 0.1, 0.25, 0.1] }] }), [1280, 720])
  assert.deepEqual(relative?.draft.items[0].box.map((value: number) => Number(value.toFixed(2))), [0.68, 0.1, 0.93, 0.2])
  assert.equal(relative?.draft.items[0].label, 'text')
})

test('text that is not a layout document is not read as one', () => {
  assert.equal(parseLayoutPrompt('1girl, solo, blue hair', [1024, 1024]), null)
  assert.equal(parseLayoutPrompt('{"a":1}', [1024, 1024]), null)
  assert.equal(parseLayoutPrompt('{broken', [1024, 1024]), null)
})

test('marked fields are matched by role and the request carries only what is connected', () => {
  const fields = [
    { id: 'f1', label: 'Negative prompt', type: 'textarea' },
    { id: 'f2', label: 'Layout prompt (JSON)', type: 'textarea' },
    { id: 'f3', label: 'Width', type: 'number' },
    { id: 'f4', label: 'Height', type: 'number' },
    { id: 'f5', label: 'Seed', type: 'number' },
  ]
  const mapping = guessFieldMapping(fields)
  assert.deepEqual(mapping, { sizeMode: 'size', prompt: 'f2', negative: 'f1', width: 'f3', height: 'f4', seed: 'f5', ratio: '', megapixels: '' })
  assert.deepEqual(mappingIssues(fields, mapping), [])
  assert.deepEqual(mappingIssues(fields, { ...mapping, prompt: 'gone' }).length, 2)

  const draft = newDraft([1024, 1024])
  const data = buildPromptData(mapping, { draft, negative: 'bad anatomy', seed: '' })
  assert.deepEqual(Object.keys(data).sort(), ['f1', 'f2', 'f3', 'f4'])
  assert.equal(data.f3, 1024)
  assert.equal(buildPromptData(mapping, { draft, seed: '42' }).f5, 42)
  assert.equal('f5' in buildPromptData(mapping, { draft, seed: '-1' }), false)
})

test('a workflow that takes an aspect ratio and megapixels gets those instead of width and height', () => {
  const fields = [
    { id: 'p', label: 'Layout prompt', type: 'textarea' },
    { id: 'r', label: 'Aspect ratio', type: 'select', options: ['1:1 (square)', '9:16 (portrait)', '16:9 (wide)'] },
    { id: 'm', label: 'Megapixels', type: 'number' },
  ]
  const mapping = guessFieldMapping(fields)
  assert.deepEqual([mapping.sizeMode, mapping.prompt, mapping.ratio, mapping.megapixels], ['ratio', 'p', 'r', 'm'])
  assert.deepEqual(mappingIssues(fields, mapping, [1088, 1920]), [])

  const draft = newDraft([1088, 1920])
  const data = buildPromptData(mapping, { draft, fields })
  assert.deepEqual(data, { p: stringifyLayout(draft), r: '9:16 (portrait)', m: 2.09 })
  assert.equal(mappingIssues(fields, mapping, [1024, 1536]).length, 1, 'a canvas no option fits is reported')
  assert.deepEqual(sizeFromRatio(parseRatio('9:16 (portrait)') as number, 2.09), [1088, 1920])

  const textRatio = [{ id: 'r', label: 'Ratio', type: 'text' }]
  assert.equal(ratioValue(textRatio[0], [1920, 1088]), '16:9')
  assert.equal(ratioValue({ id: 'r', type: 'number' }, [1024, 1024]), 1)
})

test('a select that takes its choices from a dropdown list sends the list text, and untouched fields are left to the workflow', () => {
  const lists = [{ name: '종횡비', items: ['1:1 (Square)', '4:3 (Standard)', '16:9 (Widescreen)'] }]
  const fields = withDropdownOptions([
    { id: 'p', label: '긍정프롬', type: 'textarea' },
    { id: 'n', label: '부정프롬', type: 'textarea' },
    { id: 'r', label: '종횡비', type: 'select', dropdown_list_name: '종횡비' },
    { id: 'm', label: 'Megapixels', type: 'number', min: 1, max: 4 },
    { id: 'steps', label: '스텝', type: 'number', min: 2, max: 10 },
    { id: 'lora', label: '로라', type: 'node' },
  ], lists)
  const mapping = guessFieldMapping(fields)
  assert.deepEqual([mapping.sizeMode, mapping.prompt, mapping.negative, mapping.ratio, mapping.megapixels], ['ratio', 'p', 'n', 'r', 'm'])
  const draft = newDraft([1536, 1152])
  assert.equal(buildPromptData(mapping, { draft, fields }).r, '4:3 (Standard)')

  const { adjustable, fixed } = splitOptionFields(fields, mapping)
  assert.deepEqual(adjustable.map((field: { id: string }) => field.id), ['steps'])
  assert.deepEqual(fixed.map((field: { id: string }) => field.id), ['lora'])
  assert.equal('steps' in buildPromptData(mapping, { draft, fields }), false)

  const steps = adjustable[0]
  const options = setOptionValue({}, steps, '6')
  assert.equal(buildPromptData(mapping, { draft, fields, options }).steps, 6)
  assert.deepEqual(setOptionValue(options, steps, ''), {}, 'a blank entry hands the field back to the workflow')
  assert.match(optionProblem(steps, '99'), /2~10/)
  assert.equal(optionProblem(steps, '6'), '')
  assert.match(optionProblem(fields[2], '4:3'), /4:3 \(Standard\)/, 'a refused select value names the choices that contain it')

  const negative = fields[1]
  assert.deepEqual(setOptionValue({}, negative, ''), { n: '' }, 'a text field can be emptied on purpose')
})
