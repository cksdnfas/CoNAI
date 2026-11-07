import { z } from 'zod'
import { supportsNaiCharacterPrompts } from '@conai/shared'
import type { MarkedField } from '../../types/workflow'
import { parseMcpMarkedFields } from '../comfyui/comfyWorkflowInputs'
import { comfyAssetFields, resolvePresetWorkflow, type ChatGenerationPreset } from './chatGenerationPresets'

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

/** `sceneField`: the filled text field holding the scene tags, where a character's appearance tags can go; null when none is filled. */
export type PresetInputShape = { shape: Record<string, z.ZodTypeAny>; fill: string; workflowName: string | null; problem: string | null; sceneField: string | null }

function fieldSchema(field: MarkedField, required: boolean): z.ZodTypeAny {
  const label = field.description ? `${field.label}: ${field.description}` : field.label
  let schema: z.ZodTypeAny
  if (field.type === 'number') {
    let numeric = z.number()
    if (typeof field.min === 'number') numeric = numeric.min(field.min)
    if (typeof field.max === 'number') numeric = numeric.max(field.max)
    schema = numeric
  } else if (field.type === 'select' && field.options && field.options.length > 0) {
    schema = z.enum(field.options as [string, ...string[]])
  } else if (field.type === 'image') {
    schema = z.string().describe('A data URL of the image.')
  } else if (field.type === 'node') {
    schema = z.record(z.string(), z.unknown())
  } else {
    schema = z.string().max(8000)
  }
  schema = schema.describe(label)
  return required ? schema : schema.optional()
}

/** The fields a preset's caller fills, and the sentence that says which; a ComfyUI preset whose workflow is gone has a `problem`. */
export function presetInputShape(preset: ChatGenerationPreset, options: { self?: boolean } = {}): PresetInputShape {
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
  const config = preset.comfyui
  const { workflow, problem } = config ? resolvePresetWorkflow(config) : { workflow: null, problem: '워크플로가 없어.' }
  if (!config || !workflow) return { shape: {}, fill: '', workflowName: null, problem: problem ?? 'Workflow unavailable', sceneField: null }
  const marked = parseMcpMarkedFields(workflow)
  const exposed = marked.filter((field) => config.exposedFieldIds.includes(field.id) && field.id !== config.referenceField)
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const field of exposed) {
    const covered = config.fixedInputs[field.id] !== undefined || field.default_value !== undefined
    shape[field.id] = fieldSchema(field, field.required === true && !covered)
  }
  const fill = exposed.length > 0 ? `Fill ${exposed.map((field) => `${field.id} (${field.label})`).join(', ')}.` : 'It takes no input.'
  const promptField = comfyAssetFields(config, marked).promptField
  return { shape, fill, workflowName: workflow.name, problem: null, sceneField: promptField && shape[promptField] ? promptField : null }
}
