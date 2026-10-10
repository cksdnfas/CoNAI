import { z } from 'zod'
import type { MarkedField } from '../../types/workflow'
import { parseMcpMarkedFields } from '../../mcp/tools/mcpComfyWorkflowService'
import { resolvePresetWorkflow, type ChatGenerationPreset } from './chatGenerationPresets'

/**
 * What a generation preset asks to be filled: the `generate_image` tool's input in `inline` presets, and the JSON the
 * prompt writer answers with in `after` presets (chatGenerationPrompting.ts). One schema for both, so a written
 * prompt is checked exactly like a tool call.
 */

export const SCENE_DESCRIPTION = 'What this moment shows, as comma-separated Danbooru-style tags: subject count, pose, action, expression, clothing, setting, lighting, camera angle. Do not add quality, artist or style tags and no negative tags; the preset already holds them.'

export type PresetInputShape = { shape: Record<string, z.ZodTypeAny>; fill: string; workflowName: string | null; problem: string | null }

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
export function presetInputShape(preset: ChatGenerationPreset): PresetInputShape {
  if (preset.kind === 'nai') {
    const sizes = preset.nai?.sizes ?? []
    const labels = sizes.map((size) => size.label)
    const shape: Record<string, z.ZodTypeAny> = { prompt: z.string().min(1).max(4000).describe(SCENE_DESCRIPTION) }
    if (labels.length > 1) {
      shape.size = z.enum(labels as [string, ...string[]]).optional().describe(`Picture size: ${sizes.map((size) => `${size.label} (${size.width}×${size.height})`).join(', ')}. Default ${labels[0]}.`)
    }
    return { shape, fill: labels.length > 1 ? 'Fill prompt and, when the composition calls for it, size.' : 'Fill only prompt.', workflowName: null, problem: null }
  }
  const config = preset.comfyui
  const { workflow, problem } = config ? resolvePresetWorkflow(config) : { workflow: null, problem: '워크플로가 없어.' }
  if (!config || !workflow) return { shape: {}, fill: '', workflowName: null, problem: problem ?? 'Workflow unavailable' }
  const exposed = parseMcpMarkedFields(workflow).filter((field) => config.exposedFieldIds.includes(field.id) && field.id !== config.referenceField)
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const field of exposed) {
    const covered = config.fixedInputs[field.id] !== undefined || field.default_value !== undefined
    shape[field.id] = fieldSchema(field, field.required === true && !covered)
  }
  const fill = exposed.length > 0 ? `Fill ${exposed.map((field) => `${field.id} (${field.label})`).join(', ')}.` : 'It takes no input.'
  return { shape, fill, workflowName: workflow.name, problem: null }
}
