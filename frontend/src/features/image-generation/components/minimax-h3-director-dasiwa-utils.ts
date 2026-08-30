import {
  WORKFLOW_INPUT_ASSET_REF_KIND,
  type WorkflowInputAssetRef,
} from '@/lib/api-workflow-input-assets'

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

export const MINIMAX_H3_DIRECTOR_RESOLUTION_PRESETS = {
  '144p': 0.0352,
  '240p': 0.0977,
  '360p': 0.22,
  '480p': 0.391,
  '540p': 0.494,
  '576p': 0.396,
  '720p': 0.879,
  '900p': 1.373,
  '1024p': 1,
  '1080p': 1.978,
  '1152p': 2.25,
  '1440p': 3.516,
  '2160p': 7.91,
  '2K': 3.906,
  '4K': 7.91,
  '0.26 MP - Preview': 0.26,
  '0.36 MP - Small': 0.36,
  '0.52 MP - SD': 0.52,
  '0.65 MP - Balanced': 0.65,
  '0.83 MP - HD': 0.83,
  '1.00 MP - 1024p': 1,
  '1.05 MP - HD+': 1.05,
  '1.20 MP - HD++': 1.2,
  '1.35 MP - 2K lite': 1.35,
  '1.55 MP - 2K': 1.55,
  '1.65 MP - 2K+': 1.65,
  '1.75 MP - QHD': 1.75,
  '2.10 MP - FHD': 2.1,
  '3.30 MP - QHD+': 3.3,
  '4.75 MP - 2K Pro': 4.75,
  '6.50 MP - Production': 6.5,
  '8.30 MP - UHD': 8.3,
} as const

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

const DEFAULT_TIMELINE: MiniMaxH3DirectorTimeline = {
  version: 1,
  items: [],
  prompt_blocks: [],
}

const DEFAULT_REF_BUILDER_STATE: MiniMaxH3DirectorBuilderRefState = {
  subject_definitions: '',
  summary: '',
  retention_analysis: '',
  detailed_description: '',
  soundscape: '',
  music: '',
}

const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'jxl', 'png', 'tif', 'tiff', 'webp'])
const VIDEO_EXTENSIONS = new Set(['3gp', 'avi', 'flv', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'mts', 'ts', 'webm', 'wmv'])
const AUDIO_EXTENSIONS = new Set(['aac', 'aif', 'aiff', 'alac', 'amr', 'ape', 'caf', 'flac', 'm4a', 'mka', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'weba', 'wma'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Match the ordinary Comfy API-workflow input link shape. */
export function isMiniMaxH3DirectorInputLink(value: unknown): value is MiniMaxH3DirectorInputLink {
  return Array.isArray(value)
    && value.length >= 2
    && (typeof value[0] === 'string' || typeof value[0] === 'number')
    && typeof value[1] === 'number'
    && Number.isInteger(value[1])
}

function asFiniteNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function isMiniMaxAspect(value: unknown): value is MiniMaxH3DirectorAspect {
  return typeof value === 'string' && MINIMAX_H3_DIRECTOR_ASPECT_OPTIONS.some(([candidate]) => candidate === value)
}

function isMiniMaxResolutionPreset(value: unknown): value is MiniMaxH3DirectorResolutionPreset {
  return value === 'auto'
    || value === 'custom'
    || (typeof value === 'string' && Object.prototype.hasOwnProperty.call(MINIMAX_H3_DIRECTOR_RESOLUTION_PRESETS, value))
}

function isMiniMaxInputScaling(value: unknown): value is MiniMaxH3DirectorInputScaling {
  return typeof value === 'string' && MINIMAX_H3_DIRECTOR_INPUT_SCALING_OPTIONS.includes(value as MiniMaxH3DirectorInputScaling)
}

export function normalizeMiniMaxH3DirectorResolution(value: unknown): MiniMaxH3DirectorResolutionState {
  const source = isRecord(value) ? value : {}
  return {
    aspect: isMiniMaxAspect(source.aspect) ? source.aspect : DEFAULT_MINIMAX_H3_DIRECTOR_RESOLUTION.aspect,
    resolution: isMiniMaxResolutionPreset(source.resolution) ? source.resolution : DEFAULT_MINIMAX_H3_DIRECTOR_RESOLUTION.resolution,
    input_scaling: isMiniMaxInputScaling(source.input_scaling) ? source.input_scaling : DEFAULT_MINIMAX_H3_DIRECTOR_RESOLUTION.input_scaling,
    custom_aspect_w: Math.max(1, asFiniteNumber(source.custom_aspect_w, DEFAULT_MINIMAX_H3_DIRECTOR_RESOLUTION.custom_aspect_w)),
    custom_aspect_h: Math.max(1, asFiniteNumber(source.custom_aspect_h, DEFAULT_MINIMAX_H3_DIRECTOR_RESOLUTION.custom_aspect_h)),
    custom_mode: source.custom_mode === 'fixed' ? 'fixed' : 'mp',
    custom_mp: Math.max(0.01, asFiniteNumber(source.custom_mp, DEFAULT_MINIMAX_H3_DIRECTOR_RESOLUTION.custom_mp)),
    custom_width: Math.max(16, asFiniteNumber(source.custom_width, DEFAULT_MINIMAX_H3_DIRECTOR_RESOLUTION.custom_width)),
    custom_height: Math.max(16, asFiniteNumber(source.custom_height, DEFAULT_MINIMAX_H3_DIRECTOR_RESOLUTION.custom_height)),
  }
}

export function normalizeMiniMaxH3DirectorPostprocess(value: unknown): MiniMaxH3DirectorPostprocessState {
  const source = isRecord(value) ? value : {}
  const simple = isRecord(source.simple) ? source.simple : {}
  const model = isRecord(source.model) ? source.model : {}
  const rtx = isRecord(source.rtx) ? source.rtx : {}
  const quality = (candidate: unknown) => candidate === 'Low' || candidate === 'Medium' || candidate === 'High' || candidate === 'Ultra' ? candidate : 'Ultra'
  return {
    simple: { enabled: simple.enabled === true },
    model: {
      enabled: model.enabled === true,
      model_name: typeof model.model_name === 'string' && model.model_name.trim()
        ? model.model_name
        : DEFAULT_MINIMAX_H3_DIRECTOR_POSTPROCESS.model.model_name,
    },
    rtx: {
      enabled: rtx.enabled === true,
      denoise: rtx.denoise !== false,
      denoise_quality: quality(rtx.denoise_quality),
      deblur: rtx.deblur !== false,
      deblur_quality: quality(rtx.deblur_quality),
      upscale: rtx.upscale === 'Off' || rtx.upscale === 'High Bitrate' ? rtx.upscale : 'VSR',
      upscale_quality: quality(rtx.upscale_quality),
      resize_type: rtx.resize_type === 'Keep Ratio' || rtx.resize_type === 'Manual' || rtx.resize_type === 'Preset Ratio' || rtx.resize_type === 'Same Size' ? rtx.resize_type : 'Scale',
      scale: Math.min(4, Math.max(1, asFiniteNumber(rtx.scale, DEFAULT_MINIMAX_H3_DIRECTOR_POSTPROCESS.rtx.scale))),
      megapixels: Math.min(64, Math.max(0.01, asFiniteNumber(rtx.megapixels, DEFAULT_MINIMAX_H3_DIRECTOR_POSTPROCESS.rtx.megapixels))),
      width: Math.min(8192, Math.max(64, asFiniteNumber(rtx.width, DEFAULT_MINIMAX_H3_DIRECTOR_POSTPROCESS.rtx.width))),
      height: Math.min(8192, Math.max(64, asFiniteNumber(rtx.height, DEFAULT_MINIMAX_H3_DIRECTOR_POSTPROCESS.rtx.height))),
      divisible_by: rtx.divisible_by === '8' || rtx.divisible_by === '16' || rtx.divisible_by === '64' || rtx.divisible_by === '128' ? rtx.divisible_by : '32',
      ratio_preset: rtx.ratio_preset === '1:1' || rtx.ratio_preset === '4:3' || rtx.ratio_preset === '3:2' || rtx.ratio_preset === '21:9' ? rtx.ratio_preset : '16:9',
      resize_method: rtx.resize_method === 'Letterbox (Fit)' ? 'Letterbox (Fit)' : 'Center Crop (Fill)',
      device_id: Math.min(8, Math.max(0, Math.trunc(asFiniteNumber(rtx.device_id, DEFAULT_MINIMAX_H3_DIRECTOR_POSTPROCESS.rtx.device_id)))),
      empty_cache: rtx.empty_cache === true,
      use_mmap: rtx.use_mmap === true,
      auto_unload_models: rtx.auto_unload_models !== false,
    },
  }
}

function snapMiniMaxCanvas(value: number) {
  return Math.max(MINIMAX_H3_DIRECTOR_CANVAS_MULTIPLE, Math.round(value / MINIMAX_H3_DIRECTOR_CANVAS_MULTIPLE) * MINIMAX_H3_DIRECTOR_CANVAS_MULTIPLE)
}

function getMiniMaxH3DirectorSourceAspect(timeline: MiniMaxH3DirectorTimeline) {
  const source = timeline.items
    .filter((item) => item.enabled !== false && (item.type === 'image' || item.type === 'video') && Number(item.source_width) > 0 && Number(item.source_height) > 0)
    .sort((left, right) => left.slot - right.slot || left.order - right.order)[0]
  return source ? Number(source.source_width) / Number(source.source_height) : null
}

/** Resolve the Director canvas exactly like DaSiWa's v0.4.30 resolution panel. */
export function resolveMiniMaxH3DirectorCanvas(
  timeline: MiniMaxH3DirectorTimeline,
  resolutionValue: unknown = timeline.resolution,
): [number, number] {
  const settings = normalizeMiniMaxH3DirectorResolution(resolutionValue)
  if (settings.resolution === 'custom' && settings.custom_mode === 'fixed') {
    return [snapMiniMaxCanvas(settings.custom_width), snapMiniMaxCanvas(settings.custom_height)]
  }

  const aspect = settings.aspect === 'auto'
    ? getMiniMaxH3DirectorSourceAspect(timeline) ?? 4 / 3
    : settings.aspect === 'custom'
      ? settings.custom_aspect_w / settings.custom_aspect_h
      : (() => {
          const [width, height] = settings.aspect.split(':').map(Number)
          return width / height
        })()
  if (settings.resolution === 'auto') {
    const shortSide = 768
    return aspect >= 1
      ? [snapMiniMaxCanvas(shortSide * aspect), shortSide]
      : [shortSide, snapMiniMaxCanvas(shortSide / aspect)]
  }

  const megapixels = settings.resolution === 'custom'
    ? settings.custom_mp
    : MINIMAX_H3_DIRECTOR_RESOLUTION_PRESETS[settings.resolution]
  const pixels = megapixels * 1024 * 1024
  const height = Math.sqrt(pixels / aspect)
  return [snapMiniMaxCanvas(height * aspect), snapMiniMaxCanvas(height)]
}

/** Reduce intrinsic media dimensions to a readable width:height ratio. */
export function formatMiniMaxH3DirectorAspectRatio(width: number, height: number) {
  const normalizedWidth = Math.round(width)
  const normalizedHeight = Math.round(height)
  if (!Number.isFinite(normalizedWidth) || !Number.isFinite(normalizedHeight) || normalizedWidth <= 0 || normalizedHeight <= 0) {
    return null
  }

  let left = normalizedWidth
  let right = normalizedHeight
  while (right !== 0) {
    const remainder = left % right
    left = right
    right = remainder
  }

  return `${normalizedWidth / left}:${normalizedHeight / left}`
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function isMiniMaxH3DirectorMode(value: unknown): value is MiniMaxH3DirectorMode {
  return typeof value === 'string' && MINIMAX_H3_DIRECTOR_MODES.includes(value as MiniMaxH3DirectorMode)
}

function parseBuilderStateRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) {
    return value
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Return a fresh DaSiWa-compatible prompt-builder state. */
export function createMiniMaxH3DirectorBuilderState(
  mode: MiniMaxH3DirectorMode = 'FL2VA',
  duration = 5,
): MiniMaxH3DirectorBuilderState {
  return {
    version: mode === 'REF2VA' ? 2 : 1,
    mode,
    duration,
    prompt_mode: 'structured',
    simple_prompt: '',
    imd: '',
    soundscape: '',
    music: '',
    ref: {
      ...structuredClone(DEFAULT_REF_BUILDER_STATE),
      ...(mode === 'REF2VA' ? {} : {
        subject_defs: [],
        summary_types: ['reference generation'],
        summary_text: '',
        retention: [],
        style_line: '',
        detail: '',
      }),
    },
  }
}

function buildLegacyPrompt(prompt: unknown, timeline: MiniMaxH3DirectorTimeline) {
  const assembled = [
    typeof prompt === 'string' ? prompt.trim() : '',
    ...timeline.prompt_blocks
      .filter((block) => block.enabled !== false && block.text.trim().length > 0)
      .sort((left, right) => left.start - right.start || left.order - right.order)
      .map((block) => block.text.trim()),
  ].filter(Boolean).join('\n')
  for (const candidate of [timeline.resolved_prompt, timeline.full_prompt, assembled]) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim()
  }
  return ''
}

export const DEFAULT_MINIMAX_H3_DIRECTOR_RESOLUTION: MiniMaxH3DirectorResolutionState = {
  aspect: 'auto',
  resolution: 'auto',
  input_scaling: 'Auto',
  custom_aspect_w: 16,
  custom_aspect_h: 9,
  custom_mode: 'mp',
  custom_mp: 1,
  custom_width: 1344,
  custom_height: 768,
}

export const DEFAULT_MINIMAX_H3_DIRECTOR_POSTPROCESS: MiniMaxH3DirectorPostprocessState = {
  simple: { enabled: false },
  model: { enabled: false, model_name: '2x-AnimeSharpV4_RCAN.safetensors' },
  rtx: {
    enabled: false,
    denoise: true,
    denoise_quality: 'Ultra',
    deblur: true,
    deblur_quality: 'Ultra',
    upscale: 'VSR',
    upscale_quality: 'Ultra',
    resize_type: 'Scale',
    scale: 2,
    megapixels: 2,
    width: 1920,
    height: 1080,
    divisible_by: '32',
    ratio_preset: '16:9',
    resize_method: 'Center Crop (Fill)',
    device_id: 0,
    empty_cache: false,
    use_mmap: false,
    auto_unload_models: true,
  },
}

export function hasMiniMaxH3DirectorBuilderContent(state: MiniMaxH3DirectorBuilderState) {
  if (state.simple_prompt.trim().length > 0) return true
  if (state.mode === 'REF2VA') {
    return [
      state.ref.subject_definitions,
      state.ref.summary,
      state.ref.retention_analysis,
      state.ref.detailed_description,
      state.ref.soundscape,
      state.ref.music,
    ].some((value) => value.trim().length > 0)
  }
  return [state.imd, state.soundscape, state.music]
    .some((value) => value.trim().length > 0)
}

/**
 * Read builder state using the node input first, then the timeline copy, then a
 * lossless legacy-prompt conversion. Unknown future keys are retained.
 */
export function normalizeMiniMaxH3DirectorBuilderState(
  value: unknown,
  timeline: MiniMaxH3DirectorTimeline,
  mode: MiniMaxH3DirectorMode,
  duration: number,
  legacyPrompt: unknown = '',
): MiniMaxH3DirectorBuilderState {
  const source = parseBuilderStateRecord(value)
    ?? parseBuilderStateRecord(timeline.builder_state)
    ?? {}
  const sourceRef = isRecord(source.ref) ? source.ref : {}
  const defaults = createMiniMaxH3DirectorBuilderState(mode, duration)
  const normalized: MiniMaxH3DirectorBuilderState = {
    ...defaults,
    ...source,
    version: mode === 'REF2VA' ? 2 : 1,
    mode,
    duration,
    prompt_mode: source.prompt_mode === 'simple' || source.prompt_mode === 'structured' ? source.prompt_mode : 'structured',
    simple_prompt: asString(source.simple_prompt),
    imd: asString(source.imd),
    soundscape: asString(source.soundscape),
    music: typeof source.music === 'string' ? source.music : '',
    ref: {
      ...defaults.ref,
      ...sourceRef,
      subject_definitions: asString(sourceRef.subject_definitions),
      summary: asString(sourceRef.summary),
      retention_analysis: asString(sourceRef.retention_analysis),
      detailed_description: asString(sourceRef.detailed_description),
      soundscape: asString(sourceRef.soundscape),
      music: typeof sourceRef.music === 'string' ? sourceRef.music : '',
    },
  }

  if (!normalized.ref.subject_definitions.trim() && Array.isArray(normalized.ref.subject_defs)) {
    normalized.ref.subject_definitions = normalized.ref.subject_defs
      .flatMap((definition) => isRecord(definition) && typeof definition.text === 'string' ? [definition.text.trim()] : [])
      .filter(Boolean)
      .join('\n')
  }
  if (!normalized.ref.summary.trim() && typeof normalized.ref.summary_text === 'string' && normalized.ref.summary_text.trim()) {
    const types = Array.isArray(normalized.ref.summary_types)
      ? normalized.ref.summary_types.filter((type): type is string => typeof type === 'string' && type.trim().length > 0)
      : []
    normalized.ref.summary = `[${types.join(' + ') || 'reference generation'}] ${normalized.ref.summary_text.trim()}`
  }
  if (!normalized.ref.retention_analysis.trim() && Array.isArray(normalized.ref.retention)) {
    normalized.ref.retention_analysis = normalized.ref.retention
      .flatMap((entry) => {
        if (!isRecord(entry)) return []
        const label = asString(entry.label).trim()
        const marker = asString(entry.marker).trim()
        if (!label || !marker) return []
        const context = asString(entry.context).trim()
        const note = asString(entry.note).trim()
        return [`${label}${context ? ` (${context})` : ''}: ${marker} - ${note}`]
      })
      .join('\n')
  }
  if (!normalized.ref.detailed_description.trim()) {
    normalized.ref.detailed_description = [normalized.ref.style_line, normalized.ref.detail]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .map((part) => part.trim())
      .join('\n')
  }

  const legacy = buildLegacyPrompt(legacyPrompt, timeline)
  if (legacy && !hasMiniMaxH3DirectorBuilderContent(normalized)) {
    normalized.prompt_mode = 'simple'
    normalized.simple_prompt = legacy
  }
  return normalized
}

function alignMiniMaxFrameCount(frameCount: number) {
  let aligned = Math.max(5, Math.trunc(frameCount))
  while (aligned % 17 !== 5) aligned += 1
  return aligned
}

function formatMiniMaxAlignedSeconds(duration: number) {
  const seconds = alignMiniMaxFrameCount(Math.trunc(duration * 24)) / 24
  return (Math.round(seconds * 100) / 100).toFixed(2)
}

/** Build the same canonical prompt text as DaSiWa's Python prompt helper. */
export function buildMiniMaxH3DirectorPrompt(state: MiniMaxH3DirectorBuilderState) {
  if (state.prompt_mode === 'simple') {
    return state.simple_prompt.trim()
  }

  if (state.mode === 'REF2VA') {
    return [
      `subject_definitions:\n${state.ref.subject_definitions.trim()}`,
      `summary:\n${state.ref.summary.trim()}`,
      `retention_analysis:\n${state.ref.retention_analysis.trim()}`,
      `detailed_description:\n${state.ref.detailed_description.trim()}`,
      `overall_soundscape:\n${state.ref.soundscape.trim()}`,
      `non_diegetic_music:\n${state.ref.music.trim() || 'N/A'}`,
    ].join('\n\n')
  }

  const end = formatMiniMaxAlignedSeconds(state.duration)
  const alignment = state.mode === 'I2VA'
    ? 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'
    : state.mode === 'FL2VA'
      ? `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 2) aligns with the ${end}-second mark of the target video.`
      : state.mode === 'L2VA'
        ? `How the reference pictures align with the target video — <Picture 1> (from [Shot 1]) aligns with the ${end}-second mark of the target video.`
        : ''
  const body = [
    `integrated_multimodal_description: ${state.imd.trim()}`,
    `overall_soundscape: ${state.soundscape.trim()}`,
    `non_diegetic_music: ${state.music.trim() || 'N/A'}`,
  ].join('\n\n')
  return alignment ? `${alignment}\n\n${body}` : body
}

/** Prefill REF2VA labels from the actual streams that the Director will consume. */
export function prefillMiniMaxH3DirectorRefBuilder(
  state: MiniMaxH3DirectorBuilderState,
  items: MiniMaxH3DirectorTimelineItem[],
): MiniMaxH3DirectorBuilderState {
  const ordered = items.filter((item) => item.enabled !== false).sort((left, right) => left.order - right.order)
  const pictures = ordered.filter((item) => item.type === 'image')
  const videos = ordered.filter((item) => item.type === 'video' && item.media_mode !== 'audio')
  const audios = ordered.filter((item) => item.type === 'audio' || (item.type === 'video' && item.media_mode !== 'video'))
  const definitions = [
    ...pictures.map((_, index) => `<Picture ${index + 1}> is the opening-frame anchor.`),
    ...videos.map((_, index) => `<Video ${index + 1}> provides the camera path and pacing structure.`),
    ...audios.map((_, index) => `<Audio ${index + 1}> is the voice-timbre and audio reference.`),
  ]
  const refs = [
    ...pictures.map((_, index) => `<Picture ${index + 1}>`),
    ...videos.map((_, index) => `<Video ${index + 1}>`),
    ...audios.map((_, index) => `<Audio ${index + 1}>`),
  ]
  const taskTypes = [
    pictures.length > 0 ? 'reference generation' : '',
    videos.length > 0 ? 'video editing' : '',
    audios.length > 0 ? 'audio reference' : '',
  ].filter(Boolean)
  return {
    ...state,
    ref: {
      ...state.ref,
      subject_definitions: definitions.join('\n'),
      summary: `${taskTypes.length > 0 ? `[${taskTypes.join(' + ')}] ` : ''}Use ${refs.join(', ')}.`,
    },
  }
}

function isTimelineItem(value: unknown): value is MiniMaxH3DirectorTimelineItem {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.id === 'string'
    && (value.type === 'image' || value.type === 'video' || value.type === 'audio')
    && typeof value.value === 'string'
}

function isWorkflowInputAssetRef(value: unknown): value is WorkflowInputAssetRef {
  return isRecord(value)
    && value.__ref === WORKFLOW_INPUT_ASSET_REF_KIND
    && typeof value.id === 'string'
    && typeof value.fileName === 'string'
    && typeof value.bytes === 'number'
}

/** Parse one DaSiWa timeline_data string while preserving unknown compatible fields. */
export function parseMiniMaxH3DirectorTimeline(value: unknown): { timeline: MiniMaxH3DirectorTimeline; error: string | null } {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { timeline: structuredClone(DEFAULT_TIMELINE), error: null }
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (!isRecord(parsed)) {
      return { timeline: structuredClone(DEFAULT_TIMELINE), error: 'timeline_data must contain an object' }
    }

    const items = Array.isArray(parsed.items)
      ? parsed.items.filter(isTimelineItem).map((item, index) => ({
          ...item,
          enabled: item.enabled !== false,
          order: asFiniteNumber(item.order, index),
          slot: asFiniteNumber(item.slot, index),
          start: asFiniteNumber(item.start, 0),
          duration: asFiniteNumber(item.duration, item.type === 'image' ? 1 : 2),
        }))
      : []
    const promptBlocks = Array.isArray(parsed.prompt_blocks)
      ? parsed.prompt_blocks.filter(isRecord).map((block, index) => ({
          id: typeof block.id === 'string' ? block.id : `block-${index}`,
          text: typeof block.text === 'string' ? block.text : '',
          enabled: block.enabled !== false,
          start: asFiniteNumber(block.start, 0),
          duration: asFiniteNumber(block.duration, 1),
          order: asFiniteNumber(block.order, index),
        }))
      : []

    const { builder_state: rawBuilderState, ...timelineSource } = parsed
    const resolution = normalizeMiniMaxH3DirectorResolution(parsed.resolution)
    const postprocess = normalizeMiniMaxH3DirectorPostprocess(parsed.postprocess)
    return {
      timeline: {
        ...timelineSource,
        version: 1,
        items,
        prompt_blocks: promptBlocks,
        resolution,
        postprocess,
        ...(isRecord(rawBuilderState) ? { builder_state: rawBuilderState } : {}),
      },
      error: null,
    }
  } catch (error) {
    return {
      timeline: structuredClone(DEFAULT_TIMELINE),
      error: error instanceof Error ? error.message : 'Invalid timeline_data JSON',
    }
  }
}

/** Read the CoNAI-only asset references attached to one Director node draft. */
export function getMiniMaxH3DirectorAssets(value: unknown) {
  if (!isRecord(value) || !isRecord(value[MINIMAX_H3_DIRECTOR_META_KEY])) {
    return {}
  }

  const rawAssets = (value[MINIMAX_H3_DIRECTOR_META_KEY] as Record<string, unknown>).assets
  if (!isRecord(rawAssets)) {
    return {}
  }

  return Object.fromEntries(Object.entries(rawAssets).filter((entry): entry is [string, WorkflowInputAssetRef] => isWorkflowInputAssetRef(entry[1])))
}

/** Normalize visible Director inputs without discarding model links or unknown workflow values. */
export function normalizeMiniMaxH3DirectorNodeValue(value: unknown): Record<string, unknown> & {
  mode: MiniMaxH3DirectorMode | MiniMaxH3DirectorInputLink
  prompt: string | MiniMaxH3DirectorInputLink
  width: number | MiniMaxH3DirectorInputLink
  height: number | MiniMaxH3DirectorInputLink
  duration: number | MiniMaxH3DirectorInputLink
  frame_rate: number | MiniMaxH3DirectorInputLink
  ref_image_size: 'match' | 'max' | MiniMaxH3DirectorInputLink
  timeline_data: string | MiniMaxH3DirectorInputLink
  builder_state: string | MiniMaxH3DirectorInputLink
} {
  const source = isRecord(value) ? value : {}
  return {
    ...source,
    mode: isMiniMaxH3DirectorInputLink(source.mode) ? source.mode : isMiniMaxH3DirectorMode(source.mode) ? source.mode : 'FL2VA',
    prompt: isMiniMaxH3DirectorInputLink(source.prompt) ? source.prompt : typeof source.prompt === 'string' ? source.prompt : '',
    width: isMiniMaxH3DirectorInputLink(source.width) ? source.width : asFiniteNumber(source.width, 1344),
    height: isMiniMaxH3DirectorInputLink(source.height) ? source.height : asFiniteNumber(source.height, 768),
    duration: isMiniMaxH3DirectorInputLink(source.duration) ? source.duration : asFiniteNumber(source.duration, 5),
    frame_rate: isMiniMaxH3DirectorInputLink(source.frame_rate) ? source.frame_rate : asFiniteNumber(source.frame_rate, 24),
    ref_image_size: isMiniMaxH3DirectorInputLink(source.ref_image_size) ? source.ref_image_size : source.ref_image_size === 'max' ? 'max' : 'match',
    timeline_data: isMiniMaxH3DirectorInputLink(source.timeline_data)
      ? source.timeline_data
      : typeof source.timeline_data === 'string'
        ? source.timeline_data
        : JSON.stringify(DEFAULT_TIMELINE),
    builder_state: isMiniMaxH3DirectorInputLink(source.builder_state)
      ? source.builder_state
      : typeof source.builder_state === 'string'
        ? source.builder_state
        : '',
  }
}

/** Rebuild attached prompt blocks in the exact order consumed by the DaSiWa node. */
export function syncMiniMaxH3DirectorPromptBlocks(timeline: MiniMaxH3DirectorTimeline): MiniMaxH3DirectorTimeline {
  const items = timeline.items.map((item, index) => ({ ...item, order: index }))
  const promptBlocks = items
    .filter((item) => String(item.prompt ?? '').trim().length > 0)
    .map((item, index) => ({
      id: `attached-${item.id}`,
      text: String(item.prompt).trim(),
      enabled: item.enabled !== false,
      start: asFiniteNumber(item.start, 0),
      duration: asFiniteNumber(item.duration, 1),
      order: index,
    }))

  return {
    ...timeline,
    version: 1,
    items,
    prompt_blocks: promptBlocks,
  }
}

/** Build a new Director node value while retaining original MODEL links and unknown inputs. */
export function buildMiniMaxH3DirectorNodeValue(
  currentValue: unknown,
  inputPatch: Record<string, unknown>,
  timeline?: MiniMaxH3DirectorTimeline,
  assets?: Record<string, WorkflowInputAssetRef>,
  builderState?: MiniMaxH3DirectorBuilderState,
): Record<string, unknown> {
  const current = normalizeMiniMaxH3DirectorNodeValue(currentValue)
  const currentMeta = isRecord(current[MINIMAX_H3_DIRECTOR_META_KEY]) ? current[MINIMAX_H3_DIRECTOR_META_KEY] : {}
  const nextModeValue = inputPatch.mode ?? current.mode
  const nextMode = isMiniMaxH3DirectorMode(nextModeValue)
    ? nextModeValue
    : builderState?.mode ?? 'FL2VA'
  const nextDurationValue = inputPatch.duration ?? current.duration
  const nextDuration = isMiniMaxH3DirectorInputLink(nextDurationValue)
    ? builderState?.duration ?? 5
    : asFiniteNumber(nextDurationValue, 5)
  const currentTimeline = isMiniMaxH3DirectorInputLink(current.timeline_data)
    ? structuredClone(DEFAULT_TIMELINE)
    : parseMiniMaxH3DirectorTimeline(current.timeline_data).timeline
  const nextTimeline = timeline ? syncMiniMaxH3DirectorPromptBlocks(timeline) : currentTimeline
  const nextPrompt = inputPatch.prompt ?? current.prompt
  const normalizedBuilder = normalizeMiniMaxH3DirectorBuilderState(
    builderState
      ?? ('builder_state' in inputPatch ? inputPatch.builder_state : null)
      ?? (isMiniMaxH3DirectorInputLink(current.builder_state) ? null : current.builder_state),
    nextTimeline,
    nextMode,
    nextDuration,
    isMiniMaxH3DirectorInputLink(nextPrompt) ? '' : nextPrompt,
  )
  const timelineData = isMiniMaxH3DirectorInputLink(current.timeline_data) && !timeline
    ? current.timeline_data
    : JSON.stringify({ ...nextTimeline, builder_state: normalizedBuilder })
  const builderStateValue = isMiniMaxH3DirectorInputLink(current.builder_state) && !builderState && !('builder_state' in inputPatch)
    ? current.builder_state
    : JSON.stringify(normalizedBuilder)
  const promptValue = isMiniMaxH3DirectorInputLink(nextPrompt)
    ? nextPrompt
    : buildMiniMaxH3DirectorPrompt(normalizedBuilder)
  const canvasPatch = timeline && nextTimeline.resolution
    ? (() => {
        const [width, height] = resolveMiniMaxH3DirectorCanvas(nextTimeline)
        return { width, height }
      })()
    : {}

  return {
    ...current,
    ...canvasPatch,
    ...inputPatch,
    prompt: promptValue,
    timeline_data: timelineData,
    builder_state: builderStateValue,
    [MINIMAX_H3_DIRECTOR_META_KEY]: {
      ...currentMeta,
      assets: assets ?? getMiniMaxH3DirectorAssets(current),
    },
  }
}

/** Return items that the DaSiWa backend will consume for the selected mode. */
export function getMiniMaxH3DirectorActiveItems(value: unknown) {
  const nodeValue = normalizeMiniMaxH3DirectorNodeValue(value)
  if (isMiniMaxH3DirectorInputLink(nodeValue.timeline_data)) {
    return []
  }
  const items = parseMiniMaxH3DirectorTimeline(nodeValue.timeline_data).timeline.items
    .filter((item) => item.enabled !== false)
    .sort((left, right) => left.order - right.order)

  if (isMiniMaxH3DirectorInputLink(nodeValue.mode) || nodeValue.mode === 'REF2VA') {
    return items
  }
  if (nodeValue.mode === 'T2VA') {
    return []
  }
  if (nodeValue.mode === 'Image Inpaint') {
    return items.filter((item) => item.type === 'image').slice(0, 1)
  }
  const frameSlots = nodeValue.mode === 'I2VA' ? [0] : nodeValue.mode === 'L2VA' ? [1] : [0, 1]
  return items
    .filter((item) => item.type === 'image' && frameSlots.includes(item.slot))
    .sort((left, right) => left.slot - right.slot)
    .slice(0, frameSlots.length)
}

function getSelectedDuration(item: MiniMaxH3DirectorTimelineItem) {
  if (item.type === 'image') {
    return 0
  }

  const trimStart = asFiniteNumber(item.trim_start, 0)
  const trimEnd = item.trim_end == null ? asFiniteNumber(item.source_duration, item.duration) : asFiniteNumber(item.trim_end, item.duration)
  return trimEnd - trimStart
}

/** Validate Director inputs against the current DaSiWa Director contract. */
export function validateMiniMaxH3DirectorNodeValue(value: unknown): MiniMaxH3DirectorIssue[] {
  const nodeValue = normalizeMiniMaxH3DirectorNodeValue(value)
  const issues: MiniMaxH3DirectorIssue[] = []
  const timelineLinked = isMiniMaxH3DirectorInputLink(nodeValue.timeline_data)

  if (!isMiniMaxH3DirectorInputLink(nodeValue.duration) && (
    !Number.isInteger(nodeValue.duration)
    || nodeValue.duration < MINIMAX_H3_DIRECTOR_DURATION_MIN_SECONDS
    || nodeValue.duration > MINIMAX_H3_DIRECTOR_DURATION_MAX_SECONDS
  )) {
    issues.push({ code: 'duration-range', field: 'duration', ko: '영상 길이는 1~60초 정수여야 해.', en: 'Duration must be an integer from 1 to 60 seconds.' })
  }

  if (!isMiniMaxH3DirectorInputLink(nodeValue.frame_rate) && (
    nodeValue.frame_rate < MINIMAX_H3_DIRECTOR_FRAME_RATE_MIN
    || nodeValue.frame_rate > MINIMAX_H3_DIRECTOR_FRAME_RATE_MAX
  )) {
    issues.push({ code: 'frame-rate-range', field: 'frame_rate', ko: '프레임 레이트는 0.1~240 범위여야 해.', en: 'Frame rate must be from 0.1 to 240.' })
  }

  const staticMode = isMiniMaxH3DirectorInputLink(nodeValue.mode) ? null : nodeValue.mode
  const selectedModelInput = staticMode === 'REF2VA' ? nodeValue.ref2va_model : staticMode ? nodeValue.fl2va_model : null
  if (staticMode && !isMiniMaxH3DirectorInputLink(selectedModelInput)) {
    issues.push({
      code: 'selected-model-connection',
      ko: `워크플로 수정 필요: ${nodeValue.mode} 모델 연결이 없어.`,
      en: `Workflow update required: the ${nodeValue.mode} model is not connected.`,
    })
  }

  if (timelineLinked) {
    return issues
  }

  const parsedTimeline = parseMiniMaxH3DirectorTimeline(nodeValue.timeline_data)
  if (parsedTimeline.error) {
    issues.push({ code: 'timeline-json', field: 'timeline', ko: '타임라인 데이터가 올바른 JSON이 아니야.', en: 'Timeline data is not valid JSON.' })
    return issues
  }

  const activeItems = getMiniMaxH3DirectorActiveItems(nodeValue)
  for (const item of activeItems) {
    if (!item.value.trim()) {
      issues.push({ code: 'missing-value', itemId: item.id, ko: '참조 미디어 파일이 비어 있어.', en: 'A reference media file is missing.' })
    }
  }

  if (staticMode && !isMiniMaxH3DirectorInputLink(nodeValue.builder_state)) {
    const builderRaw = nodeValue.builder_state.trim()
    if (builderRaw) {
      try {
        if (!isRecord(JSON.parse(builderRaw))) throw new Error('builder_state must contain an object')
      } catch {
        issues.push({ code: 'builder-json', field: 'prompt', ko: '프롬프트 빌더 데이터가 올바른 JSON이 아니야.', en: 'Prompt builder data is not valid JSON.' })
      }
    }
  }

  if (staticMode === 'Image Inpaint') {
    const enabledItems = parsedTimeline.timeline.items.filter((item) => item.enabled !== false)
    const imageItems = enabledItems.filter((item) => item.type === 'image')
    if (imageItems.length !== 1) {
      issues.push({ code: 'inpaint-image-count', field: 'timeline', ko: 'Image Inpaint에는 활성 이미지가 정확히 1개 필요해.', en: 'Image Inpaint requires exactly one enabled image.' })
    }
    for (const item of enabledItems.filter((item) => item.type !== 'image')) {
      issues.push({ code: 'inpaint-media-type', itemId: item.id, ko: 'Image Inpaint에서는 영상·오디오 참조를 사용할 수 없어.', en: 'Image Inpaint does not support video or audio references.' })
    }
    return issues
  }

  if (staticMode === null || staticMode !== 'REF2VA') {
    return issues
  }

  const imageItems = activeItems.filter((item) => item.type === 'image')
  const videoItems = activeItems.filter((item) => item.type === 'video')
  const audioItems = activeItems.filter((item) => item.type === 'audio')
  const visualVideos = videoItems.filter((item) => item.media_mode !== 'audio')
  const embeddedAudioVideos = videoItems.filter((item) => item.media_mode === 'audio' || item.media_mode === 'video_audio')
  const audioReferenceCount = audioItems.length + embeddedAudioVideos.length
  const visualReferenceCount = imageItems.length + visualVideos.length

  if (imageItems.length > 9) {
    issues.push({ code: 'image-count', ko: 'REF2VA 이미지는 최대 9개까지 사용할 수 있어.', en: 'REF2VA supports at most nine images.' })
  }
  if (videoItems.length > 3) {
    issues.push({ code: 'video-count', ko: 'REF2VA 영상 참조는 최대 3개까지 사용할 수 있어.', en: 'REF2VA supports at most three video references.' })
  }
  if (audioReferenceCount > 3) {
    issues.push({ code: 'audio-count', ko: 'REF2VA 오디오 참조는 최대 3개까지 사용할 수 있어.', en: 'REF2VA supports at most three audio references.' })
  }
  if (imageItems.length + visualVideos.length + audioReferenceCount > 12) {
    issues.push({ code: 'reference-count', ko: 'REF2VA 참조는 합계 12개를 넘을 수 없어.', en: 'REF2VA supports at most 12 references in total.' })
  }
  if (audioReferenceCount > 0 && visualReferenceCount === 0) {
    issues.push({ code: 'audio-needs-visual', ko: '오디오 참조에는 이미지 또는 영상 참조가 하나 이상 필요해.', en: 'Audio references require at least one image or visual video reference.' })
  }

  let videoDurationTotal = 0
  let audioDurationTotal = 0
  for (const item of [...videoItems, ...audioItems]) {
    const selectedDuration = getSelectedDuration(item)
    if (selectedDuration < 2 || selectedDuration > 15) {
      issues.push({ code: 'media-duration', itemId: item.id, ko: '영상·오디오 참조 구간은 2~15초여야 해.', en: 'Video and audio reference ranges must be from 2 to 15 seconds.' })
    }
    if (item.type === 'video' && item.media_mode !== 'audio') {
      videoDurationTotal += selectedDuration
    }
    if (item.type === 'audio' || (item.type === 'video' && item.media_mode !== 'video')) {
      audioDurationTotal += selectedDuration
    }
  }
  if (videoDurationTotal > 15) {
    issues.push({ code: 'video-duration-total', ko: '영상 참조 구간 합계는 15초를 넘을 수 없어.', en: 'Total video reference duration cannot exceed 15 seconds.' })
  }
  if (audioDurationTotal > 15) {
    issues.push({ code: 'audio-duration-total', ko: '오디오 참조 구간 합계는 15초를 넘을 수 없어.', en: 'Total audio reference duration cannot exceed 15 seconds.' })
  }

  return issues
}

/** Infer the Director reference type from browser MIME metadata and filename. */
export function inferMiniMaxH3DirectorMediaType(file: File): MiniMaxH3DirectorMediaType | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio'
  return null
}

/** Allocate a collision-resistant timeline item id without exposing local paths. */
export function createMiniMaxH3DirectorItemId(type: MiniMaxH3DirectorMediaType) {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${type}-${suffix}`
}
