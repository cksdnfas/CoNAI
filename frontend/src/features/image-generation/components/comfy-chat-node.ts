import { applyMiniMaxDirectorResolutionBounds, copyChatPageData, validateChatPageArguments, type ChatPageData, type ChatPageSchema } from '@conai/shared'
import { pageArray, pageChoice, pageNumber, pageObject, pageText, pageRecord } from '@/features/codex-chat/page-action-helpers'
import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { buildPowerLoraNodeItemsFromInputs, isPowerLoraLoaderEntryValue } from './power-lora-loader-utils'
import { buildMiniMaxH3DirectorNodeValue, isMiniMaxH3DirectorInputLink, normalizeMiniMaxH3DirectorBuilderState, normalizeMiniMaxH3DirectorNodeValue, parseMiniMaxH3DirectorTimeline, validateMiniMaxH3DirectorNodeValue, MINIMAX_H3_DIRECTOR_MODES, MINIMAX_H3_DIRECTOR_ASPECT_OPTIONS, MINIMAX_H3_DIRECTOR_INPUT_SCALING_OPTIONS, MINIMAX_H3_DIRECTOR_RESOLUTION_PRESETS, MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS, type MiniMaxH3DirectorTimeline } from './minimax-h3-director-dasiwa-utils'

const resolution = pageObject({ aspect: pageChoice(MINIMAX_H3_DIRECTOR_ASPECT_OPTIONS.map(([key]) => key)), resolution: pageChoice(['auto', 'custom', ...Object.keys(MINIMAX_H3_DIRECTOR_RESOLUTION_PRESETS)]), input_scaling: pageChoice([...MINIMAX_H3_DIRECTOR_INPUT_SCALING_OPTIONS]), custom_aspect_w: pageNumber(1, 10000), custom_aspect_h: pageNumber(1, 10000), custom_mode: pageChoice(['mp', 'fixed']), custom_mp: pageNumber(0.01, 64), custom_width: pageNumber(16, 8192, true), custom_height: pageNumber(16, 8192, true) })
const prompt = pageObject({ mode: pageChoice(['simple', 'structured']), simple_prompt: pageText(), imd: pageText(), soundscape: pageText(), music: pageText(), subject_definitions: pageText(), summary: pageText(), retention_analysis: pageText(), detailed_description: pageText() })
const postprocess = pageObject({ simple: pageObject({ enabled: { type: 'boolean' } }), model: pageObject({ enabled: { type: 'boolean' }, model_name: pageText(300) }), rtx: pageObject({ enabled: { type: 'boolean' }, denoise: { type: 'boolean' }, denoise_quality: pageChoice(['Low', 'Medium', 'High', 'Ultra']), deblur: { type: 'boolean' }, deblur_quality: pageChoice(['Low', 'Medium', 'High', 'Ultra']), upscale: pageChoice(['Off', 'VSR', 'High Bitrate']), upscale_quality: pageChoice(['Low', 'Medium', 'High', 'Ultra']), resize_type: pageChoice(['Keep Ratio', 'Manual', 'Preset Ratio', 'Same Size', 'Scale']), scale: pageNumber(1, 4), megapixels: pageNumber(0.01, 64) }) })
const timelineItems = pageArray(pageObject({ id: pageText(100), enabled: { type: 'boolean' }, slot: pageNumber(0, 8, true), start: pageNumber(0, 60), duration: pageNumber(0.1, 60), trim_start: pageNumber(0, 3600), trim_end: pageNumber(0, 3600), prompt: pageText(), remove: { type: 'boolean' } }, ['id']), 32)
const promptBlocks = pageArray(pageObject({ id: pageText(100), text: pageText(), enabled: { type: 'boolean' }, start: pageNumber(0, 60), duration: pageNumber(0.1, 60) }, ['text', 'start', 'duration']), 64)
export const COMFY_NODE_PATCH_SCHEMA = pageObject({ mode: pageChoice([...MINIMAX_H3_DIRECTOR_MODES]), width: pageNumber(32, 8192, true), height: pageNumber(32, 8192, true), duration: pageNumber(1, 60, true), frame_rate: pageNumber(0.1, 240), ref_image_size: pageChoice(['match', 'max']), prompt, resolution, postprocess, timelineItems, promptBlocks, loras: pageArray(pageObject({ key: pageText(100), lora: pageText(300), on: { type: 'boolean' }, strength: pageNumber(-100, 100) }, ['key', 'lora', 'on', 'strength']), 64) })

export function comfyNodeChatSchema(field: WorkflowMarkedField, value: unknown): ChatPageSchema {
  if (field.node_editor === 'power_lora_loader_rgthree') return pageObject({ loras: COMFY_NODE_PATCH_SCHEMA.properties!.loras }, ['loras'])
  const node = normalizeMiniMaxH3DirectorNodeValue(value)
  const visible = field.node_visible_fields ?? [...MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS]
  const properties = structuredClone(Object.fromEntries(Object.entries(COMFY_NODE_PATCH_SCHEMA.properties!).filter(([key]) => {
    if (key === 'loras') return false
    if (key === 'prompt') return visible.includes('prompt') && !isMiniMaxH3DirectorInputLink(node.builder_state) && !isMiniMaxH3DirectorInputLink(node.prompt)
    if (['resolution', 'postprocess', 'timelineItems', 'promptBlocks'].includes(key)) return visible.includes('timeline_data') && !isMiniMaxH3DirectorInputLink(node.timeline_data) && !field.node_hidden_controls?.includes(key)
    return visible.includes(key) && !isMiniMaxH3DirectorInputLink(node[key])
  })))
  for (const hidden of field.node_hidden_controls ?? []) {
    const parts = hidden.split('.')
    let parent: ChatPageSchema | undefined = { type: 'object', properties }
    for (const part of parts.slice(0, -1)) parent = parent?.properties?.[part]
    if (parent?.properties) delete parent.properties[parts.at(-1)!]
  }
  for (const [key, bounds] of Object.entries(field.node_numeric_bounds ?? {})) {
    if (properties[key]?.type === 'number') properties[key] = { ...properties[key], ...(bounds.min !== undefined ? { minimum: bounds.min } : {}), ...(bounds.max !== undefined ? { maximum: bounds.max } : {}) }
  }
  return pageObject(properties)
}

export function comfyNodeChatData(field: WorkflowMarkedField, value: unknown): ChatPageData {
  const base = { fieldId: field.id, label: field.label, editor: field.node_editor ?? '', schema: comfyNodeChatSchema(field, value) }
  if (field.node_editor === 'power_lora_loader_rgthree') {
    const node = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    return copyChatPageData({ ...base, loras: buildPowerLoraNodeItemsFromInputs(node).map((item) => { const entry = node[item.key] as { on: boolean; lora: string; strength: number }; return { key: item.key, on: entry.on, lora: entry.lora, strength: entry.strength } }) })
  }
  const node = normalizeMiniMaxH3DirectorNodeValue(value)
  const { timeline } = parseMiniMaxH3DirectorTimeline(node.timeline_data)
  const builder = normalizeMiniMaxH3DirectorBuilderState(node.builder_state, timeline, typeof node.mode === 'string' ? node.mode : 'FL2VA', typeof node.duration === 'number' ? node.duration : 5, typeof node.prompt === 'string' ? node.prompt : '')
  return copyChatPageData({ ...base, mode: node.mode, width: node.width, height: node.height, duration: node.duration, frame_rate: node.frame_rate, ref_image_size: node.ref_image_size,
    prompt: { mode: builder.prompt_mode, simple_prompt: builder.simple_prompt, imd: builder.imd, soundscape: builder.soundscape, music: builder.music, subject_definitions: builder.ref.subject_definitions, summary: builder.ref.summary, retention_analysis: builder.ref.retention_analysis, detailed_description: builder.ref.detailed_description }, resolution: timeline.resolution ?? {}, postprocess: timeline.postprocess ?? {},
    timelineItems: timeline.items.map((item) => ({ id: item.id, type: item.type, name: /^(?:data:|blob:|https?:)/i.test(item.value) ? item.type : item.value.split(/[\\/]/).pop() ?? '', enabled: item.enabled, slot: item.slot, start: item.start, duration: item.duration })), promptBlocks: timeline.prompt_blocks.map((item) => ({ id: item.id, text: item.text, enabled: item.enabled, start: item.start, duration: item.duration })), issues: validateMiniMaxH3DirectorNodeValue(node).map((issue) => issue.ko) })
}

export function applyComfyChatNode(field: WorkflowMarkedField, value: unknown, input: ChatPageData, loraOptions: string[] = []): Record<string, unknown> {
  const patch = pageRecord(validateChatPageArguments(comfyNodeChatSchema(field, value), input))
  if (!Object.keys(patch).length) throw new Error('변경할 노드 입력이 없어.')
  if (field.node_editor === 'power_lora_loader_rgthree') {
    const node = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    const next = Object.fromEntries(Object.entries(node).filter(([, item]) => !isPowerLoraLoaderEntryValue(item)))
    const seen = new Set<string>()
    const knownLoras = new Set([...loraOptions, ...Object.values(node).filter(isPowerLoraLoaderEntryValue).map((entry) => entry.lora)])
    for (const raw of patch.loras as ChatPageData[]) { const item = pageRecord(raw); const key = String(item.key); if (!/^lora_\d+$/i.test(key) || seen.has(key)) throw new Error('LoRA 입력 키가 올바르지 않아.'); if (item.lora && !knownLoras.has(String(item.lora))) throw new Error('현재 LoRA 선택 목록에 없는 항목이야.'); seen.add(key); next[key] = { lora: item.lora, on: item.on, strength: item.strength } }
    return next
  }
  const node = normalizeMiniMaxH3DirectorNodeValue(value)
  const original = parseMiniMaxH3DirectorTimeline(node.timeline_data).timeline
  const timeline: MiniMaxH3DirectorTimeline = structuredClone(original)
  if (patch.resolution) timeline.resolution = { ...timeline.resolution, ...pageRecord(patch.resolution) } as MiniMaxH3DirectorTimeline['resolution']
  if (patch.postprocess) {
    const p = pageRecord(patch.postprocess)
    timeline.postprocess = { simple: { enabled: false, ...timeline.postprocess?.simple, ...(p.simple ? pageRecord(p.simple) : {}) }, model: { enabled: false, model_name: '', ...timeline.postprocess?.model, ...(p.model ? pageRecord(p.model) : {}) }, rtx: { ...timeline.postprocess?.rtx, ...(p.rtx ? pageRecord(p.rtx) : {}) } } as MiniMaxH3DirectorTimeline['postprocess']
  }
  if (patch.timelineItems) {
    const seen = new Set<string>()
    for (const raw of patch.timelineItems as ChatPageData[]) {
      const item = pageRecord(raw); const id = String(item.id)
      if (seen.has(id) || !timeline.items.some((entry) => entry.id === id)) throw new Error('타임라인 미디어 ID가 없거나 중복됐어.')
      seen.add(id)
      const { remove, ...values } = item
      timeline.items = remove ? timeline.items.filter((entry) => entry.id !== id) : timeline.items.map((entry) => entry.id === id ? { ...entry, ...values } as typeof entry : entry)
    }
  }
  if (patch.promptBlocks) timeline.prompt_blocks = (patch.promptBlocks as ChatPageData[]).map((raw, index) => ({ enabled: true, ...pageRecord(raw), id: String(pageRecord(raw).id ?? crypto.randomUUID()), order: index })) as MiniMaxH3DirectorTimeline['prompt_blocks']
  const basic = Object.fromEntries(Object.entries(patch).filter(([key]) => ['mode', 'width', 'height', 'duration', 'frame_rate', 'ref_image_size'].includes(key)))
  let builder = normalizeMiniMaxH3DirectorBuilderState(node.builder_state, timeline, (basic.mode ?? node.mode) as typeof MINIMAX_H3_DIRECTOR_MODES[number], Number(basic.duration ?? node.duration), typeof node.prompt === 'string' ? node.prompt : '')
  if (patch.prompt) {
    const p = pageRecord(patch.prompt)
    const refs = Object.fromEntries(Object.entries(p).filter(([key]) => ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'soundscape', 'music'].includes(key)))
    builder = { ...builder, ...p, prompt_mode: (p.mode ?? builder.prompt_mode) as 'simple' | 'structured', mode: (basic.mode ?? builder.mode) as typeof builder.mode, ref: { ...builder.ref, ...refs } } as typeof builder
  }
  const updatesTimeline = ['resolution', 'postprocess', 'timelineItems', 'promptBlocks'].some((key) => patch[key] !== undefined)
  const built = buildMiniMaxH3DirectorNodeValue(node, basic, updatesTimeline ? timeline : undefined, undefined, builder)
  const next = updatesTimeline || basic.width !== undefined || basic.height !== undefined ? applyMiniMaxDirectorResolutionBounds(built, field.node_numeric_bounds) : built
  const issues = validateMiniMaxH3DirectorNodeValue(next).filter((issue) => issue.code !== 'selected-model-connection')
  if (issues.length) throw new Error(issues[0].ko)
  return next
}
