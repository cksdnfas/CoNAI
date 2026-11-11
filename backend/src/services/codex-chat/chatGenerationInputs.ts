import { z } from 'zod'
import { supportsNaiCharacterPrompts } from '@conai/shared'
import type { MarkedField, WorkflowRecord } from '../../types/workflow'
import { mcpDropdownChoices, parseMcpMarkedFields, requireDropdownChoice } from '../comfyui/comfyWorkflowInputs'
import { comfyAssetFields, resolvePresetWorkflow, type ChatComfyPresetConfig, type ChatGenerationPreset } from './chatGenerationPresets'

/**
 * What a generation preset asks to be filled: the `generate_image` tool's input in `inline` presets, and the JSON the
 * prompt writer answers with in `after` presets (chatGenerationPrompting.ts). One schema for both, so a written
 * prompt is checked exactly like a tool call.
 */

export const SCENE_DESCRIPTION = 'What this moment shows, as comma-separated Danbooru-style tags: subject count, pose, action, expression, clothing, setting, lighting, camera angle. Do not add quality, artist or style tags and no negative tags; the preset already holds them.'

const SHARED_SCENE_DESCRIPTION = 'Tags shared by the whole picture, comma-separated Danbooru-style: subject count (2girls, 1boy 1girl), setting, lighting, composition, camera angle. When the picture shows specific characters, put each one\'s looks, clothing, expression, pose and action in its own characters entry, not here. Do not add quality, artist or style tags and no negative tags; the preset already holds them.'

/** `self`: offered only to an inline speaker with appearance tags; the server adds those tags to that entry. */
function naiCharactersSchema(self: boolean) {
  return z.array(z.object({
    prompt: z.string().min(1).max(4000).describe('This character\'s own tags only: who it is, hair, eyes, body, clothing, expression, pose, action.'),
    uc: z.string().max(4000).optional().describe('Negative tags for this character only.'),
    center_x: z.number().min(0).max(1).optional().describe('Horizontal position from 0.1 (left) to 0.9 (right); 0.5 is the middle. Omit center_x and center_y on every entry to let NovelAI place the characters.'),
    center_y: z.number().min(0).max(1).optional().describe('Vertical position from 0.1 (top) to 0.9 (bottom); 0.5 is the middle.'),
    ...(self ? { self: z.boolean().optional().describe('true on the entry that is you, the speaking character: the server adds your saved appearance tags to it, so write only this moment there.') } : {}),
  })).max(6).optional().describe('One entry per character in the picture (NovelAI takes at most six), each with its own tags. Replaces the preset\'s fixed characters when not empty.')
}

function acceptsDropdownChoice(field: MarkedField, value: unknown) {
  try {
    requireDropdownChoice(field, value)
    return true
  } catch {
    return false
  }
}

/** `sceneField`: the filled text field holding the scene tags, where a character's appearance tags can go; null when none is filled. */
export type PresetInputShape = { shape: Record<string, z.ZodTypeAny>; fill: string; workflowName: string | null; problem: string | null; sceneField: string | null }

/**
 * One exposed ComfyUI field. `preset`: the value it gets when left out (the preset's fixed value, else the workflow's
 * saved one). Text is always asked for: the saved text is another picture's prompt, and the model cannot see it to
 * choose it. A dropdown or a number may be left out, and the description says what that keeps. `canSearch`: the
 * caller is offered search_custom_dropdown_items, so a list too long to send is looked up instead of guessed.
 */
function fieldSchema(field: MarkedField, preset: unknown, canSearch: boolean): z.ZodTypeAny {
  const choices = mcpDropdownChoices(field)
  const label = field.description ? `${field.label}: ${field.description}` : field.label
  const notes: string[] = []
  // A fixed value left on this field that its dropdown no longer offers cannot be kept: left out, the job is refused.
  let required = preset === undefined ? field.required === true : !acceptsDropdownChoice(field, preset)
  let schema: z.ZodTypeAny
  if (choices?.inline) {
    schema = z.enum(choices.options as [string, ...string[]])
  } else if (choices) {
    // Checked here as well as at queueing, so a wrong value comes back with the closest items wherever the input is read.
    schema = z.string().min(1).superRefine((value, ctx) => {
      try { requireDropdownChoice(field, value) } catch (error) { ctx.addIssue({ code: 'custom', message: (error as Error).message }) }
    })
    notes.push(`Takes one exact item of the dropdown list ${JSON.stringify(choices.listName)} (${choices.options.length} items)${canSearch ? ': find it with search_custom_dropdown_items first' : ''}; any other value is refused with the closest items.`)
  } else if (field.type === 'number') {
    let numeric = z.number()
    if (typeof field.min === 'number') numeric = numeric.min(field.min)
    if (typeof field.max === 'number') numeric = numeric.max(field.max)
    schema = numeric
  } else if (field.type === 'image') {
    schema = z.string().describe('A data URL of the image.')
  } else if (field.type === 'node') {
    schema = z.record(z.string(), z.unknown())
  } else {
    schema = z.string().min(1).max(8000)
    if (field.type !== 'select') required = true
  }
  if (!required && (choices || field.type === 'number' || field.type === 'select') && (typeof preset === 'string' || typeof preset === 'number')) {
    notes.push(`Leave out to keep the preset value ${field.type === 'number' ? String(preset) : JSON.stringify(preset)}.`)
  }
  schema = schema.describe(notes.length > 0 ? [/[.!?]$/.test(label) ? label : `${label}.`, ...notes].join(' ') : label)
  return required ? schema : schema.optional()
}

/**
 * A ComfyUI preset's workflow fields, or why it cannot run now. A fixed value its dropdown no longer offers is refused
 * at queueing, on every call and with nothing the model can change, so the preset says so up front (tool description,
 * settings list). Fields the model fills are left out of that: its value replaces the fixed one.
 */
function comfyPresetFields(preset: ChatGenerationPreset): { problem: string } | { config: ChatComfyPresetConfig; workflow: WorkflowRecord; marked: MarkedField[] } {
  const config = preset.comfyui
  const { workflow, problem } = config ? resolvePresetWorkflow(config) : { workflow: null, problem: '워크플로가 없어.' }
  if (!config || !workflow) return { problem: problem ?? 'Workflow unavailable' }
  let marked: MarkedField[]
  try {
    marked = parseMcpMarkedFields(workflow)
  } catch {
    return { problem: `워크플로 "${workflow.name}"의 입력 필드 설정을 읽을 수 없어. 워크플로를 다시 저장해줘.` }
  }
  const stale = marked.find((field) => !config.exposedFieldIds.includes(field.id) && config.fixedInputs[field.id] !== undefined && !acceptsDropdownChoice(field, config.fixedInputs[field.id]))
  if (stale) return { problem: `프리셋의 고정 값 ${JSON.stringify(config.fixedInputs[stale.id])}이(가) "${stale.label || stale.id}" 드롭다운에 없어. 프리셋 편집기에서 다시 골라줘.` }
  return { config, workflow, marked }
}

/** Why a preset's tool cannot run now (null: it can); what `presetInputShape` reports, without building the schema. */
export function presetProblem(preset: ChatGenerationPreset): string | null {
  if (preset.kind === 'nai') return null
  const fields = comfyPresetFields(preset)
  return 'problem' in fields ? fields.problem : null
}

/** The fields a preset's caller fills, and the sentence that says which; a ComfyUI preset that cannot run (workflow gone or unreadable, a fixed value outside its dropdown) has a `problem`. */
export function presetInputShape(preset: ChatGenerationPreset, options: { self?: boolean; canSearch?: boolean } = {}): PresetInputShape {
  if (preset.kind === 'nai') {
    const sizes = preset.nai?.sizes ?? []
    const labels = sizes.map((size) => size.label)
    const characters = supportsNaiCharacterPrompts(preset.nai?.model)
    // A field description sits closer to the value than the tool's guide, so it must defer to the guide by itself.
    const guided = Boolean(preset.prompting.guide || preset.prompting.guideSkill?.title)
    const scene = characters ? SHARED_SCENE_DESCRIPTION : SCENE_DESCRIPTION
    const shape: Record<string, z.ZodTypeAny> = { prompt: z.string().min(1).max(4000).describe(guided ? `${scene} Where the preset's prompt guide says otherwise, follow the guide.` : scene) }
    if (characters) shape.characters = naiCharactersSchema(options.self === true)
    if (labels.length > 1) {
      shape.size = z.enum(labels as [string, ...string[]]).optional().describe(`Picture size: ${sizes.map((size) => `${size.label} (${size.width}×${size.height})`).join(', ')}. Default ${labels[0]}.`)
    }
    const fill = `Fill prompt${characters ? ', characters for the characters in the picture' : ''}${labels.length > 1 ? ' and, when the composition calls for it, size' : ''}.`
    return { shape, fill: characters || labels.length > 1 ? fill : 'Fill only prompt.', workflowName: null, problem: null, sceneField: 'prompt' }
  }
  const fields = comfyPresetFields(preset)
  if ('problem' in fields) return { shape: {}, fill: '', workflowName: null, problem: fields.problem, sceneField: null }
  const { config, workflow, marked } = fields
  const exposed = marked.filter((field) => config.exposedFieldIds.includes(field.id) && field.id !== config.referenceField)
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const field of exposed) shape[field.id] = fieldSchema(field, config.fixedInputs[field.id] ?? field.default_value, options.canSearch === true)
  const fill = exposed.length > 0 ? `Fill ${exposed.map((field) => `${field.id} (${field.label})`).join(', ')}.` : 'It takes no input.'
  const promptField = comfyAssetFields(config, marked).promptField
  return { shape, fill, workflowName: workflow.name, problem: null, sceneField: promptField && shape[promptField] ? promptField : null }
}
