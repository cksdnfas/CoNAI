import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  MINIMAX_H3_DIRECTOR_META_KEY,
  buildMiniMaxH3DirectorNodeValue,
  getMiniMaxH3DirectorActiveItems,
  parseMiniMaxH3DirectorTimeline,
  validateMiniMaxH3DirectorNodeValue,
  type MiniMaxH3DirectorTimeline,
  type MiniMaxH3DirectorTimelineItem,
} from '../features/image-generation/components/minimax-h3-director-dasiwa-utils'
import type { WorkflowInputAssetRef } from '../lib/api-workflow-input-assets'

function item(
  id: string,
  type: MiniMaxH3DirectorTimelineItem['type'],
  patch: Partial<MiniMaxH3DirectorTimelineItem> = {},
): MiniMaxH3DirectorTimelineItem {
  return {
    id,
    type,
    value: `${id}.bin`,
    enabled: true,
    order: 0,
    slot: 0,
    start: 0,
    duration: type === 'image' ? 1 : 2,
    ...patch,
  }
}

const asset: WorkflowInputAssetRef = {
  __ref: 'workflow-input-asset',
  id: '0123456789abcdef0123456789abcdef',
  fileName: 'opening.png',
  mimeType: 'image/png',
  bytes: 123,
}
const timeline: MiniMaxH3DirectorTimeline = {
  version: 1,
  items: [item('opening', 'image', { prompt: 'opening frame' })],
  prompt_blocks: [],
}
const original = {
  mode: 'FL2VA',
  prompt: 'global',
  width: 1344,
  height: 768,
  duration: 5,
  ref_image_size: 'match',
  timeline_data: JSON.stringify({ version: 1, items: [], prompt_blocks: [] }),
  fl2va_model: ['10', 0],
  ref2va_model: ['11', 0],
  future_input: { retained: true },
}

const built = buildMiniMaxH3DirectorNodeValue(original, { mode: 'REF2VA' }, timeline, { opening: asset })
assert.deepEqual(built.fl2va_model, ['10', 0], 'FL2VA MODEL links must remain untouched')
assert.deepEqual(built.ref2va_model, ['11', 0], 'REF2VA MODEL links must remain untouched')
assert.deepEqual(built.future_input, { retained: true }, 'unknown workflow inputs must remain untouched')
assert.deepEqual(
  (built[MINIMAX_H3_DIRECTOR_META_KEY] as { assets: Record<string, WorkflowInputAssetRef> }).assets.opening,
  asset,
  'Director media must persist as a small private asset reference',
)
const builtTimeline = parseMiniMaxH3DirectorTimeline(built.timeline_data).timeline
assert.equal(builtTimeline.prompt_blocks[0]?.text, 'opening frame', 'media prompts must synchronize to prompt_blocks')

const flWithPreservedRefImages = {
  ...original,
  timeline_data: JSON.stringify({
    version: 1,
    items: [item('one', 'image'), item('two', 'image', { slot: 1 }), item('three', 'image', { slot: 2 })],
    prompt_blocks: [],
  }),
}
assert.equal(getMiniMaxH3DirectorActiveItems(flWithPreservedRefImages).length, 2, 'FL2VA must consume only its first two image slots')
assert.equal(validateMiniMaxH3DirectorNodeValue(flWithPreservedRefImages).length, 0, 'hidden REF2VA media must not block FL2VA generation')

const audioWithoutVisual = {
  ...original,
  mode: 'REF2VA',
  timeline_data: JSON.stringify({
    version: 1,
    items: [item('voice', 'audio', { source_duration: 3, trim_start: 0, trim_end: 3, duration: 3 })],
    prompt_blocks: [],
  }),
}
assert.ok(validateMiniMaxH3DirectorNodeValue(audioWithoutVisual).some((issue) => issue.code === 'audio-needs-visual'))
assert.ok(
  validateMiniMaxH3DirectorNodeValue({ ...original, fl2va_model: undefined }).some((issue) => issue.code === 'selected-model-connection'),
  'the selected mode must highlight a missing workflow MODEL connection',
)

const authoringSource = readFileSync(resolve(process.cwd(), 'src/features/image-generation/components/comfy-workflow-authoring-graph.tsx'), 'utf8')
const fieldInputSource = readFileSync(resolve(process.cwd(), 'src/features/image-generation/components/workflow-field-input.tsx'), 'utf8')
assert.match(authoringSource, /classType === MINIMAX_H3_DIRECTOR_CLASS_TYPE/, 'only the exact DaSiWa class should select the Director editor')
assert.match(authoringSource, /jsonPath: `\$\{nodeId\}\.inputs`/, 'the Director must remain one ordinary composite workflow input')
assert.match(fieldInputSource, /MiniMaxH3DirectorDasiwaInput/, 'the composite input must render the CoNAI Director UI')

console.log('MiniMax H3 Director frontend contracts verified')
