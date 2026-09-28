import type { WorkflowInputAssetRef } from '@/lib/api-workflow-input-assets'
import { MINIMAX_H3_DIRECTOR_RESOLUTION_PRESETS } from '@conai/shared'

// MiniMax H3 Director (DaSiWa) node constants and state types. Logic lives in
// minimax-h3-director-dasiwa-utils.ts, which re-exports everything here.
export const MINIMAX_H3_DIRECTOR_CLASS_TYPE = 'MiniMaxH3Director'
export const MINIMAX_H3_DIRECTOR_NODE_EDITOR = 'minimax_h3_director_dasiwa'
export const MINIMAX_H3_DIRECTOR_NODE_INPUT_KEY = '__minimax_h3_director_node__'
export const MINIMAX_H3_DIRECTOR_META_KEY = '__conai_minimax_h3_director'
export const MINIMAX_H3_DIRECTOR_DURATION_MIN_SECONDS = 1
export const MINIMAX_H3_DIRECTOR_DURATION_MAX_SECONDS = 60
export const MINIMAX_H3_DIRECTOR_FRAME_RATE_MIN = 0.1
export const MINIMAX_H3_DIRECTOR_FRAME_RATE_MAX = 240
export const MINIMAX_H3_DIRECTOR_CANVAS_MULTIPLE = 32

export const MINIMAX_H3_DIRECTOR_ASPECT_OPTIONS = [
  ['auto', 'Auto'],
  ['1:1', '1:1'],
  ['16:9', '16:9'],
  ['9:16', '9:16'],
  ['2:1', '2:1'],
  ['1:2', '1:2'],
  ['3:2', '3:2'],
  ['2:3', '2:3'],
  ['4:3', '4:3'],
  ['3:4', '3:4'],
  ['4:5', '4:5'],
  ['5:4', '5:4'],
  ['custom', 'CUSTOM'],
] as const

export { MINIMAX_H3_DIRECTOR_RESOLUTION_PRESETS } from '@conai/shared'

export const MINIMAX_H3_DIRECTOR_INPUT_SCALING_OPTIONS = [
  'Off',
  'Auto',
  'Target',
  'Fit',
  'Fill and crop',
  'Fit and pad',
  'Long side with divisible crop',
] as const

export const MINIMAX_H3_DIRECTOR_MODES = ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF2VA', 'Image Inpaint'] as const
export type MiniMaxH3DirectorMode = typeof MINIMAX_H3_DIRECTOR_MODES[number]
export type MiniMaxH3DirectorPromptMode = 'simple' | 'structured'
export type MiniMaxH3DirectorAspect = typeof MINIMAX_H3_DIRECTOR_ASPECT_OPTIONS[number][0]
export type MiniMaxH3DirectorResolutionPreset = 'auto' | 'custom' | keyof typeof MINIMAX_H3_DIRECTOR_RESOLUTION_PRESETS
export type MiniMaxH3DirectorInputScaling = typeof MINIMAX_H3_DIRECTOR_INPUT_SCALING_OPTIONS[number]
export type MiniMaxH3DirectorMediaType = 'image' | 'video' | 'audio'
export type MiniMaxH3DirectorVideoMode = 'video' | 'audio' | 'video_audio'
export type MiniMaxH3DirectorInputLink = [string | number, number]
export type MiniMaxH3DirectorGraphInputKey =
  | 'width'
  | 'height'
  | 'duration'
  | 'frame_rate'
  | 'ref_image_size'
  | 'start_image'
  | 'end_image'
  | 'reference_image'
  | 'reference_video'
  | 'reference_audio'
  | 'resolution.aspect'
  | 'resolution.resolution'
  | 'resolution.input_scaling'
  | 'resolution.custom_aspect_w'
  | 'resolution.custom_aspect_h'
  | 'resolution.custom_mode'
  | 'resolution.custom_mp'
  | 'resolution.custom_width'
  | 'resolution.custom_height'
  | 'postprocess.simple.enabled'
  | 'postprocess.model.enabled'
  | 'postprocess.model.model_name'
  | 'postprocess.rtx.enabled'
  | `postprocess.rtx.${string}`
  | 'prompt.mode'
  | 'prompt.simple_prompt'
  | 'prompt.imd'
  | 'prompt.subject_definitions'
  | 'prompt.summary'
  | 'prompt.retention_analysis'
  | 'prompt.detailed_description'
  | 'prompt.soundscape'
  | 'prompt.music'
export const MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS = [
  'mode',
  'width',
  'height',
  'duration',
  'frame_rate',
  'ref_image_size',
  'timeline_data',
  'prompt',
] as const
export type MiniMaxH3DirectorVisibleField = typeof MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS[number]

export type MiniMaxH3DirectorTimelineItem = {
  id: string
  type: MiniMaxH3DirectorMediaType
  value: string
  enabled: boolean
  order: number
  slot: number
  start: number
  duration: number
  source_duration?: number
  trim_start?: number
  trim_end?: number | null
  media_mode?: MiniMaxH3DirectorVideoMode
  audioSlot?: number
  prompt?: string
  waveform_peaks?: number[]
  source_width?: number
  source_height?: number
  [key: string]: unknown
}

export type MiniMaxH3DirectorResolutionState = {
  aspect: MiniMaxH3DirectorAspect
  resolution: MiniMaxH3DirectorResolutionPreset
  input_scaling: MiniMaxH3DirectorInputScaling
  custom_aspect_w: number
  custom_aspect_h: number
  custom_mode: 'mp' | 'fixed'
  custom_mp: number
  custom_width: number
  custom_height: number
}

export type MiniMaxH3DirectorRtxSettings = {
  enabled: boolean
  denoise: boolean
  denoise_quality: 'Low' | 'Medium' | 'High' | 'Ultra'
  deblur: boolean
  deblur_quality: 'Low' | 'Medium' | 'High' | 'Ultra'
  upscale: 'Off' | 'VSR' | 'High Bitrate'
  upscale_quality: 'Low' | 'Medium' | 'High' | 'Ultra'
  resize_type: 'Keep Ratio' | 'Manual' | 'Preset Ratio' | 'Scale' | 'Same Size'
  scale: number
  megapixels: number
  width: number
  height: number
  divisible_by: '8' | '16' | '32' | '64' | '128'
  ratio_preset: '1:1' | '4:3' | '3:2' | '16:9' | '21:9'
  resize_method: 'Center Crop (Fill)' | 'Letterbox (Fit)'
  device_id: number
  empty_cache: boolean
  use_mmap: boolean
  auto_unload_models: boolean
}

export type MiniMaxH3DirectorPostprocessState = {
  simple: { enabled: boolean }
  model: { enabled: boolean; model_name: string }
  rtx: MiniMaxH3DirectorRtxSettings
}

export type MiniMaxH3DirectorPromptBlock = {
  id: string
  text: string
  enabled: boolean
  start: number
  duration: number
  order: number
}

export type MiniMaxH3DirectorTimeline = {
  version: 1
  items: MiniMaxH3DirectorTimelineItem[]
  prompt_blocks: MiniMaxH3DirectorPromptBlock[]
  builder_state?: Record<string, unknown>
  resolution?: MiniMaxH3DirectorResolutionState
  postprocess?: MiniMaxH3DirectorPostprocessState
  [key: string]: unknown
}

export type MiniMaxH3DirectorBuilderRefState = {
  subject_definitions: string
  summary: string
  retention_analysis: string
  detailed_description: string
  soundscape: string
  music: string
  subject_defs?: unknown[]
  summary_types?: string[]
  summary_text?: string
  retention?: unknown[]
  style_line?: string
  detail?: string
  [key: string]: unknown
}

export type MiniMaxH3DirectorBuilderState = {
  version: number
  mode: MiniMaxH3DirectorMode
  duration: number
  prompt_mode: MiniMaxH3DirectorPromptMode
  simple_prompt: string
  imd: string
  soundscape: string
  music: string
  ref: MiniMaxH3DirectorBuilderRefState
  [key: string]: unknown
}

export type MiniMaxH3DirectorDraftMeta = {
  assets: Record<string, WorkflowInputAssetRef>
}

export type MiniMaxH3DirectorIssue = {
  code: string
  ko: string
  en: string
  field?: 'mode' | 'width' | 'height' | 'duration' | 'frame_rate' | 'timeline' | 'prompt'
  itemId?: string
}
