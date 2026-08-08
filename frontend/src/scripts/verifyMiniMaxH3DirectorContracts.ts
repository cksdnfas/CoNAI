import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  MINIMAX_H3_DIRECTOR_META_KEY,
  buildMiniMaxH3DirectorPrompt,
  buildMiniMaxH3DirectorNodeValue,
  createMiniMaxH3DirectorBuilderState,
  getMiniMaxH3DirectorActiveItems,
  isMiniMaxH3DirectorInputLink,
  normalizeMiniMaxH3DirectorBuilderState,
  parseMiniMaxH3DirectorTimeline,
  prefillMiniMaxH3DirectorRefBuilder,
  validateMiniMaxH3DirectorNodeValue,
  type MiniMaxH3DirectorTimeline,
  type MiniMaxH3DirectorTimelineItem,
} from '../features/image-generation/components/minimax-h3-director-dasiwa-utils'
import type { WorkflowInputAssetRef } from '../lib/api-workflow-input-assets'
import type { WorkflowMarkedField } from '../lib/api-image-generation-types'
import { buildWorkflowPromptData } from '../features/image-generation/image-generation-drafts'

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
assert.equal(builtTimeline.prompt_blocks[0]?.text, 'opening frame', 'legacy media prompts must remain synchronized to prompt_blocks')
assert.equal(typeof built.builder_state, 'string', 'the new required builder_state input must be serialized')
assert.equal(builtTimeline.builder_state?.mode, 'REF2VA', 'timeline_data must retain a builder_state compatibility copy')
assert.equal(
  (JSON.parse(String(built.builder_state)) as { ref: { detailed_description: string } }).ref.detailed_description,
  'global\nopening frame',
  'legacy REF2VA prompt text and attached media prompts must migrate without loss',
)

const connectedInputs = {
  ...original,
  mode: ['90', 0],
  prompt: ['91', 0],
  width: ['92', 0],
  height: ['93', 0],
  duration: ['94', 0],
  ref_image_size: ['95', 0],
  timeline_data: ['96', 0],
  builder_state: ['97', 0],
}
const connectedBuilt = buildMiniMaxH3DirectorNodeValue(
  connectedInputs,
  { width: 640 },
)
assert.equal(connectedBuilt.width, 640, 'an explicitly edited connected input must become a local value')
for (const key of ['mode', 'prompt', 'height', 'duration', 'ref_image_size', 'timeline_data', 'builder_state'] as const) {
  assert.deepEqual(connectedBuilt[key], connectedInputs[key], `${key} links must survive unrelated composite-field edits`)
  assert.equal(isMiniMaxH3DirectorInputLink(connectedBuilt[key]), true, `${key} must remain a Comfy input link`)
}
assert.equal(validateMiniMaxH3DirectorNodeValue(connectedBuilt).length, 0, 'connected inputs must not be validated as local scalar values')
assert.equal(
  validateMiniMaxH3DirectorNodeValue({ ...original, width: 1279, height: 719 }).length,
  0,
  'workflow-managed dimensions must not be rejected or rounded by the Director editor',
)

const connectedTimelineBuilt = buildMiniMaxH3DirectorNodeValue(connectedInputs, {}, timeline, { opening: asset })
assert.equal(typeof connectedTimelineBuilt.timeline_data, 'string', 'editing reference media must replace a connected timeline with local timeline data')
assert.deepEqual(connectedTimelineBuilt.mode, connectedInputs.mode, 'editing reference media must preserve unrelated connected inputs')

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
assert.equal(getMiniMaxH3DirectorActiveItems({ ...flWithPreservedRefImages, mode: 'T2VA' }).length, 0, 'T2VA must consume no media')
assert.equal(getMiniMaxH3DirectorActiveItems({ ...flWithPreservedRefImages, mode: 'I2VA' }).length, 1, 'I2VA must consume one opening image')
assert.equal(getMiniMaxH3DirectorActiveItems({ ...flWithPreservedRefImages, mode: 'L2VA' }).length, 1, 'L2VA must consume one closing image')
assert.equal(getMiniMaxH3DirectorActiveItems({ ...flWithPreservedRefImages, mode: 'REF2VA' }).length, 3, 'REF2VA must restore all preserved references')

const baseBuilder = normalizeMiniMaxH3DirectorBuilderState(
  createMiniMaxH3DirectorBuilderState('FL2VA', 5),
  timeline,
  'FL2VA',
  5,
)
baseBuilder.imd = '[Shot 1] A crane shot crosses the harbor.'
assert.match(buildMiniMaxH3DirectorPrompt(baseBuilder), /5\.17-second mark/, 'FL2VA preview must use DaSiWa frame-aligned duration text')
const refBuilder = prefillMiniMaxH3DirectorRefBuilder(
  createMiniMaxH3DirectorBuilderState('REF2VA', 5),
  [
    item('picture', 'image'),
    item('clip', 'video', { order: 1, media_mode: 'video_audio' }),
    item('voice', 'audio', { order: 2 }),
  ],
)
assert.match(refBuilder.ref.subject_definitions, /<Picture 1>/, 'REF prefill must define image labels')
assert.match(refBuilder.ref.subject_definitions, /<Video 1>/, 'REF prefill must define visual-video labels')
assert.match(refBuilder.ref.subject_definitions, /<Audio 2>/, 'REF prefill must count embedded and standalone audio references')
assert.match(buildMiniMaxH3DirectorPrompt(refBuilder), /^subject_definitions:/, 'REF preview must use the six-section DaSiWa format')
const normalizedLegacyRefBuilder = normalizeMiniMaxH3DirectorBuilderState({
  version: 1,
  mode: 'REF2VA',
  ref: {
    subject_defs: [{ text: '<Picture 1> is the keyframe.' }],
    summary_types: ['reference generation'],
    summary_text: 'Use <Picture 1>.',
    retention: [{ label: '<Picture 1>', marker: 'fully_preserved', note: 'Keep framing.' }],
    style_line: 'Cinematic realism.',
    detail: '[Shot 1] The camera pushes in.',
  },
}, timeline, 'REF2VA', 5)
assert.match(normalizedLegacyRefBuilder.ref.subject_definitions, /<Picture 1>/, 'legacy v1 subject definitions must normalize into the v2 editor')
assert.match(normalizedLegacyRefBuilder.ref.summary, /^\[reference generation\]/, 'legacy v1 summary must normalize into the v2 editor')
assert.match(normalizedLegacyRefBuilder.ref.retention_analysis, /fully_preserved/, 'legacy v1 retention rows must normalize into the v2 editor')
assert.match(normalizedLegacyRefBuilder.ref.detailed_description, /Cinematic realism/, 'legacy v1 detail fields must normalize into the v2 editor')
const partiallyPopulatedRefBuilder = normalizeMiniMaxH3DirectorBuilderState({
  version: 2,
  mode: 'REF2VA',
  ref: { subject_definitions: '<Picture 1> is the keyframe.' },
}, builtTimeline, 'REF2VA', 5)
assert.equal(
  partiallyPopulatedRefBuilder.ref.detailed_description,
  'opening frame',
  'legacy media prompts must migrate into an empty detailed_description even when other REF sections are populated',
)

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
assert.equal(
  validateMiniMaxH3DirectorNodeValue({ ...original, duration: 60 }).some((issue) => issue.code === 'duration-range'),
  false,
  'a one-minute Director request must remain valid',
)
assert.ok(
  validateMiniMaxH3DirectorNodeValue({ ...original, duration: 61 }).some((issue) => issue.code === 'duration-range'),
  'Director duration must reject requests longer than one minute',
)

const boundedDirectorField: WorkflowMarkedField = {
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
const boundedPrompt = buildWorkflowPromptData([boundedDirectorField], {
  director: { ...original, width: 256, height: 4096, duration: 12 },
})
assert.equal((boundedPrompt.director as Record<string, unknown>).width, 512, 'Director width must honor the workflow minimum')
assert.equal((boundedPrompt.director as Record<string, unknown>).height, 2048, 'Director height must honor the workflow maximum')
assert.equal((boundedPrompt.director as Record<string, unknown>).duration, 10, 'Director duration must honor the workflow maximum')
const defaultBoundedPrompt = buildWorkflowPromptData([{ ...boundedDirectorField, node_numeric_bounds: undefined }], {
  director: { ...original, duration: 1000 },
})
assert.equal((defaultBoundedPrompt.director as Record<string, unknown>).duration, 60, 'Director duration must retain its one-minute hard maximum')

const authoringSource = readFileSync(resolve(process.cwd(), 'src/features/image-generation/components/comfy-workflow-authoring-graph.tsx'), 'utf8')
const fieldInputSource = readFileSync(resolve(process.cwd(), 'src/features/image-generation/components/workflow-field-input.tsx'), 'utf8')
const markedFieldsEditorSource = readFileSync(resolve(process.cwd(), 'src/features/image-generation/components/comfy-workflow-marked-fields-editor.tsx'), 'utf8')
const directorInputSource = readFileSync(resolve(process.cwd(), 'src/features/image-generation/components/minimax-h3-director-dasiwa-input.tsx'), 'utf8')
const promptBuilderSource = readFileSync(resolve(process.cwd(), 'src/features/image-generation/components/minimax-h3-director-prompt-builder.tsx'), 'utf8')
const mediaCardSource = readFileSync(resolve(process.cwd(), 'src/features/image-generation/components/minimax-h3-director-media-card.tsx'), 'utf8')
assert.match(authoringSource, /classType === MINIMAX_H3_DIRECTOR_CLASS_TYPE/, 'only the exact DaSiWa class should select the Director editor')
assert.match(authoringSource, /jsonPath: `\$\{nodeId\}\.inputs`/, 'the Director must remain one ordinary composite workflow input')
assert.match(fieldInputSource, /MiniMaxH3DirectorDasiwaInput/, 'the composite input must render the CoNAI Director UI')
assert.match(fieldInputSource, /visibleFields=\{field\.node_visible_fields\}/, 'the workflow field configuration must reach the Director UI')
assert.match(fieldInputSource, /numericBounds=\{field\.node_numeric_bounds\}/, 'the workflow numeric bounds must reach the Director UI')
assert.match(markedFieldsEditorSource, /node_visible_fields/, 'workflow settings must configure visible Director fields')
assert.match(markedFieldsEditorSource, /node_numeric_bounds/, 'workflow settings must configure Director numeric bounds')
for (const field of ['width', 'height', 'duration']) {
  assert.match(directorInputSource, new RegExp(`numericBounds\\?\\.${field}\\?\\.(?:min|max)`), `${field} must consume configured workflow bounds`)
}
for (const field of ['mode', 'width', 'height', 'duration', 'ref_image_size', 'timeline_data', 'prompt']) {
  assert.match(directorInputSource, new RegExp(`isFieldVisible\\('${field}'\\)`), `${field} visibility must be configurable`)
}
assert.doesNotMatch(directorInputSource, /ConnectedBadge|timelineLocked|modeLocked/, 'connected inputs must not be automatically locked')
assert.match(directorInputSource, /시작 프레임/, 'FL2VA must expose an explicit start-frame slot')
assert.match(directorInputSource, /끝 프레임/, 'FL2VA must expose an explicit end-frame slot')
assert.match(directorInputSource, /clearLane\('visual'\)/, 'the visual lane must have an independent reset')
assert.match(directorInputSource, /clearLane\('audio'\)/, 'the audio lane must have an independent reset')
assert.doesNotMatch(directorInputSource, /미디어 프롬프트|Media prompt/, 'the retired per-media prompt UI must not compete with the new prompt builder')
assert.doesNotMatch(mediaCardSource, /promptLabel|onOpenPrompt|MessageSquareText/, 'media cards must not expose retired per-media prompt actions')
assert.match(directorInputSource, /import \{ FormField \}/, 'Director settings must reuse the shared image-generation field layout')
assert.match(promptBuilderSource, /import \{ FormField \}/, 'prompt sections must reuse the shared image-generation field layout')
for (const mode of ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF2VA']) {
  assert.match(directorInputSource, new RegExp(`['"]${mode}['"]`), `${mode} must be available in the CoNAI Director UI`)
}
assert.match(directorInputSource, /MiniMaxH3DirectorPromptBuilder/, 'the composite input must render the dedicated prompt builder')
assert.match(promptBuilderSource, /prefillMiniMaxH3DirectorRefBuilder/, 'REF2VA must expose label and summary prefill')
assert.match(promptBuilderSource, /buildMiniMaxH3DirectorPrompt/, 'the UI must preview the canonical DaSiWa prompt')
assert.match(mediaCardSource, /videoPoster/, 'video references must derive transient posters without persisting base64 in timeline_data')
assert.match(mediaCardSource, /LONG_PRESS_DELAY_MS/, 'media cards must support delayed pointer sorting')
assert.match(mediaCardSource, /onReplaceFile/, 'dropping a file on a media card must replace that card')
assert.doesNotMatch(mediaCardSource, /object-cover/, 'media previews must preserve their intrinsic aspect ratio')

console.log('MiniMax H3 Director frontend contracts verified')
