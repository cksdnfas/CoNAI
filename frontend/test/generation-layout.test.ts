import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  GENERATION_LAYOUT_SURFACES,
  createDefaultGenerationLayoutPreset,
  generationLayoutBlocks,
  isGenerationLayoutRequiredBlock,
  normalizeGenerationLayoutPresets,
} from '@conai/shared'
import {
  addLayoutColumn,
  moveLayoutBlock,
  removeLayoutColumn,
  resizeLayoutColumn,
  resolveRecentStripPlacement,
  setLayoutBlockHidden,
  stackedLayoutBlocks,
  withPluginBlocks,
} from '../src/features/image-generation/layout/generation-layout-ops'

const allBlocks = (preset: { columns: Array<{ blocks: string[] }> }) => preset.columns.flatMap((column) => column.blocks).sort()

test('normalizing keeps every block once, recent beside result and action last', () => {
  const [preset] = normalizeGenerationLayoutPresets('nai', [{
    id: 'wide',
    name: '  와이드  ',
    columns: [
      { weight: 30, blocks: ['settings', 'action', 'settings', 'bogus', 'model'] },
      { weight: 999, blocks: ['prompt', 'recent'] },
      { weight: 50, blocks: ['result'] },
      { weight: 50, blocks: [] },
    ],
    hidden: ['result', 'vibes', 'vibes'],
  }])
  assert.equal(preset.name, '와이드')
  assert.deepEqual(allBlocks(preset), [...generationLayoutBlocks('nai')].sort(), 'other surfaces\' blocks are dropped')
  assert.equal(preset.columns[0].blocks[preset.columns[0].blocks.length - 1], 'action')
  assert.deepEqual(preset.columns.find((column) => column.blocks.includes('result'))!.blocks, ['result', 'recent'])
  assert.equal(preset.columns.length, 3, 'empty columns are dropped')
  assert.equal(preset.columns[1].weight, 100, 'weights are clamped')
  assert.deepEqual(preset.hidden, ['vibes'], 'required blocks cannot be hidden')
})

test('an empty or broken list falls back to the default preset', () => {
  assert.deepEqual(normalizeGenerationLayoutPresets('nai', null), [createDefaultGenerationLayoutPreset('nai')])
  const presets = normalizeGenerationLayoutPresets('nai', [{ id: 'same' }, { id: 'same' }])
  assert.deepEqual(presets.map((preset) => preset.id), ['same', 'same-2'])
})

test('every surface default is already normal and holds each of its blocks once', () => {
  for (const surface of GENERATION_LAYOUT_SURFACES) {
    const preset = createDefaultGenerationLayoutPreset(surface)
    assert.deepEqual(normalizeGenerationLayoutPresets(surface, [preset]), [preset], surface)
    assert.deepEqual(allBlocks(preset), [...generationLayoutBlocks(surface)].sort(), surface)
    assert.deepEqual(stackedLayoutBlocks(preset), preset.columns.flatMap((column) => column.blocks), surface)
  }
  assert.ok(isGenerationLayoutRequiredBlock('comfy', 'fields'))
  assert.ok(!isGenerationLayoutRequiredBlock('codex', 'images'))
  assert.ok(!isGenerationLayoutRequiredBlock('workflow-browse', 'outputs'))
})

test('moving blocks between columns and placing the filmstrip', () => {
  let preset = addLayoutColumn(createDefaultGenerationLayoutPreset('nai'))
  assert.equal(preset.columns.length, 3)
  preset = moveLayoutBlock('nai', preset, 'settings', { column: 2, index: 0 })
  assert.deepEqual(preset.columns[2].blocks, ['settings'])
  assert.ok(!preset.columns[0].blocks.includes('settings'))

  // Within one column the index counts the dragged block's old slot.
  preset = moveLayoutBlock('nai', preset, 'prompt', { column: 0, index: 3 })
  assert.deepEqual(preset.columns[0].blocks.slice(0, 3), ['characters', 'images', 'prompt'])

  // The filmstrip snaps back beside the result; above it means a top strip.
  preset = moveLayoutBlock('nai', preset, 'recent', { column: 1, index: 0 })
  assert.deepEqual(preset.columns[1].blocks, ['recent', 'result'])
  assert.equal(resolveRecentStripPlacement(preset), 'top')
  preset = moveLayoutBlock('nai', preset, 'recent', { column: 2, index: 0 })
  assert.deepEqual(preset.columns[1].blocks, ['result', 'recent'])
  assert.equal(resolveRecentStripPlacement(setLayoutBlockHidden(preset, 'recent', true)), 'hidden')

  // The generate button stays at the end of whichever column it lands in.
  preset = moveLayoutBlock('nai', preset, 'action', { column: 2, index: 0 })
  assert.deepEqual(preset.columns[2].blocks, ['settings', 'action'])
})

test('other surfaces move their own blocks; hidden ones leave the narrow stack', () => {
  let preset = moveLayoutBlock('codex', createDefaultGenerationLayoutPreset('codex'), 'images', { column: 1, index: 0 })
  assert.deepEqual(preset.columns[1].blocks, ['images', 'result', 'recent'])
  preset = setLayoutBlockHidden(preset, 'output', true)
  assert.deepEqual(stackedLayoutBlocks(preset), ['model', 'prompt', 'action', 'images', 'result', 'recent'])

  const browse = moveLayoutBlock('workflow-browse', createDefaultGenerationLayoutPreset('workflow-browse'), 'outputs', { column: 0, index: 0 })
  assert.deepEqual(browse.columns[0].blocks, ['outputs', 'list'])
})

test('resizing keeps the pair total and the minimum width; only empty columns can be removed', () => {
  const preset = createDefaultGenerationLayoutPreset('nai')
  assert.deepEqual(resizeLayoutColumn(preset.columns, 0, 70).map((column) => column.weight), [70, 30])
  assert.deepEqual(resizeLayoutColumn(preset.columns, 0, 99).map((column) => column.weight), [90, 10])
  assert.equal(removeLayoutColumn(preset, 0), preset)
  const withEmpty = addLayoutColumn(preset)
  assert.equal(removeLayoutColumn(withEmpty, 2).columns.length, 2)
})

test('plugin blocks survive normalizing, are never required and stay within the limit', () => {
  const extra = Array.from({ length: 10 }, (_, index) => `plugin:helper:block-${index}`)
  const [preset] = normalizeGenerationLayoutPresets('nai', [{
    id: 'plugins',
    name: '플러그인',
    columns: [{ weight: 50, blocks: ['prompt', 'plugin:helper:notes', 'plugin:helper:notes', 'plugin:Bad:x', 'plugin:helper'] }, { weight: 50, blocks: ['result', ...extra] }],
    hidden: ['plugin:helper:notes', 'plugin:nope'],
  }])
  const plugins = allBlocks(preset).filter((block) => block.startsWith('plugin:'))
  assert.equal(plugins.length, 8)
  assert.ok(plugins.includes('plugin:helper:notes'))
  assert.deepEqual(preset.hidden, ['plugin:helper:notes'])
  assert.equal(isGenerationLayoutRequiredBlock('nai', 'plugin:helper:notes'), false)
})

test('the plugin blocks on screen follow the installed plugins', () => {
  const preset = createDefaultGenerationLayoutPreset('nai')
  assert.equal(withPluginBlocks(preset, []), preset)
  const added = withPluginBlocks(preset, ['plugin:helper:notes'])
  // A new block joins the last column; one in a column with the Generate button would sit above it.
  assert.deepEqual(added.columns[1].blocks, ['result', 'recent', 'plugin:helper:notes'])
  const moved = moveLayoutBlock('nai', added, 'plugin:helper:notes', { column: 0, index: 0 })
  assert.deepEqual(withPluginBlocks(moved, ['plugin:helper:notes']), moved)
  const single = { ...preset, columns: [{ weight: 100, blocks: preset.columns.flatMap((column) => column.blocks).filter((block) => block !== 'action').concat('action') }] }
  assert.deepEqual(withPluginBlocks(single, ['plugin:helper:notes']).columns[0].blocks.slice(-2), ['plugin:helper:notes', 'action'])
  const gone = withPluginBlocks(setLayoutBlockHidden(moved, 'plugin:helper:notes', true), [])
  assert.equal(allBlocks(gone).some((block) => block.startsWith('plugin:')), false)
  assert.deepEqual(gone.hidden, [])
})
