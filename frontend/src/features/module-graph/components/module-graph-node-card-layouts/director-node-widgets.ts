import {
  isMiniMaxH3DirectorInputLink,
  MINIMAX_H3_DIRECTOR_ASPECT_OPTIONS,
  MINIMAX_H3_DIRECTOR_DURATION_MAX_SECONDS,
  MINIMAX_H3_DIRECTOR_DURATION_MIN_SECONDS,
  MINIMAX_H3_DIRECTOR_FRAME_RATE_MAX,
  MINIMAX_H3_DIRECTOR_FRAME_RATE_MIN,
  MINIMAX_H3_DIRECTOR_INPUT_SCALING_OPTIONS,
  MINIMAX_H3_DIRECTOR_RESOLUTION_PRESETS,
  type MiniMaxH3DirectorBuilderState,
  type MiniMaxH3DirectorPostprocessState,
  type MiniMaxH3DirectorResolutionState,
  type MiniMaxH3DirectorRtxSettings,
  type MiniMaxH3DirectorTimeline,
} from '@/features/image-generation/components/minimax-h3-director-dasiwa-utils'
import { setMiniMaxH3DirectorPromptMode, type MiniMaxH3DirectorState } from '@/features/image-generation/components/minimax-h3-director-node-state'
import type { WorkflowNodeNumericBounds } from '@/lib/api-image-generation-types'
import type { useI18n } from '@/i18n'

type Translate = ReturnType<typeof useI18n>['t']
type Option = { value: string; label: string }

/** What one widget changes: plain inputs, the timeline (resolution, post-processing) and/or the prompt builder. */
export type DirectorWidgetPatch = {
  input?: Record<string, unknown>
  timeline?: MiniMaxH3DirectorTimeline
  builder?: MiniMaxH3DirectorBuilderState
}

/** The in-node control for one Director input key. */
export type DirectorWidgetSpec =
  | { kind: 'number'; value: number | ''; min?: number; max?: number; step: number; write: (value: number) => DirectorWidgetPatch }
  | { kind: 'select'; value: string; options: Option[]; write: (value: string) => DirectorWidgetPatch }
  | { kind: 'boolean'; value: boolean; write: (value: boolean) => DirectorWidgetPatch }
  | { kind: 'text'; value: string; write: (value: string) => DirectorWidgetPatch }
  | { kind: 'prompt'; value: string }
  | { kind: 'media' }

const QUALITY_OPTIONS = ['Low', 'Medium', 'High', 'Ultra']

const toOptions = (values: readonly string[]): Option[] => values.map((value) => ({ value, label: value }))

function numberValue(value: unknown): number | '' {
  return typeof value === 'number' && Number.isFinite(value) && !isMiniMaxH3DirectorInputLink(value) ? value : ''
}

function withResolution(state: MiniMaxH3DirectorState, patch: Partial<MiniMaxH3DirectorResolutionState>): DirectorWidgetPatch {
  return { timeline: { ...state.timeline, resolution: { ...state.resolution, ...patch } } }
}

function withPostprocess(state: MiniMaxH3DirectorState, next: MiniMaxH3DirectorPostprocessState): DirectorWidgetPatch {
  return { timeline: { ...state.timeline, postprocess: next } }
}

function withRtx(state: MiniMaxH3DirectorState, patch: Partial<MiniMaxH3DirectorRtxSettings>): DirectorWidgetPatch {
  return withPostprocess(state, { ...state.postprocess, rtx: { ...state.postprocess.rtx, ...patch } })
}

/** Number settings of the RTX chain: [min, max, step]. */
const RTX_NUMBERS: Partial<Record<keyof MiniMaxH3DirectorRtxSettings, [number, number, number]>> = {
  scale: [1, 4, 0.25],
  megapixels: [0.01, 64, 0.1],
  width: [64, 8192, 8],
  height: [64, 8192, 8],
  device_id: [0, 8, 1],
}

const RTX_SELECTS: Partial<Record<keyof MiniMaxH3DirectorRtxSettings, readonly string[]>> = {
  denoise_quality: QUALITY_OPTIONS,
  deblur_quality: QUALITY_OPTIONS,
  upscale: ['Off', 'VSR', 'High Bitrate'],
  upscale_quality: QUALITY_OPTIONS,
  resize_type: ['Scale', 'Keep Ratio', 'Preset Ratio', 'Manual', 'Same Size'],
  divisible_by: ['8', '16', '32', '64', '128'],
  ratio_preset: ['1:1', '4:3', '3:2', '16:9', '21:9'],
  resize_method: ['Center Crop (Fill)', 'Letterbox (Fit)'],
}

const RTX_BOOLEANS = new Set<keyof MiniMaxH3DirectorRtxSettings>(['enabled', 'denoise', 'deblur', 'empty_cache', 'use_mmap', 'auto_unload_models'])

const PROMPT_KEYS = new Set(['simple_prompt', 'imd', 'soundscape', 'music'])
const REF_PROMPT_KEYS = new Set(['subject_definitions', 'summary', 'retention_analysis', 'detailed_description'])

/** The same choices and limits the panel editor offers for this key, read from and written back to one Director value. */
export function getDirectorWidgetSpec(
  t: Translate,
  inputKey: string,
  state: MiniMaxH3DirectorState,
  bounds: WorkflowNodeNumericBounds | undefined,
): DirectorWidgetSpec | null {
  const { nodeValue, resolution, postprocess, builderState } = state

  switch (inputKey) {
    case 'width':
    case 'height':
      return { kind: 'number', value: numberValue(nodeValue[inputKey]), min: bounds?.[inputKey]?.min, max: bounds?.[inputKey]?.max, step: 32, write: (value) => ({ input: { [inputKey]: value } }) }
    case 'duration':
      return {
        kind: 'number',
        value: numberValue(nodeValue.duration),
        min: Math.max(MINIMAX_H3_DIRECTOR_DURATION_MIN_SECONDS, bounds?.duration?.min ?? MINIMAX_H3_DIRECTOR_DURATION_MIN_SECONDS),
        max: Math.min(MINIMAX_H3_DIRECTOR_DURATION_MAX_SECONDS, bounds?.duration?.max ?? MINIMAX_H3_DIRECTOR_DURATION_MAX_SECONDS),
        step: 1,
        write: (duration) => ({ input: { duration }, builder: { ...builderState, duration } }),
      }
    case 'frame_rate':
      return {
        kind: 'number',
        value: numberValue(nodeValue.frame_rate),
        min: Math.max(MINIMAX_H3_DIRECTOR_FRAME_RATE_MIN, bounds?.frame_rate?.min ?? MINIMAX_H3_DIRECTOR_FRAME_RATE_MIN),
        max: Math.min(MINIMAX_H3_DIRECTOR_FRAME_RATE_MAX, bounds?.frame_rate?.max ?? MINIMAX_H3_DIRECTOR_FRAME_RATE_MAX),
        step: 1,
        write: (frame_rate) => ({ input: { frame_rate } }),
      }
    case 'ref_image_size':
      return { kind: 'select', value: isMiniMaxH3DirectorInputLink(nodeValue.ref_image_size) ? '' : String(nodeValue.ref_image_size ?? ''), options: toOptions(['match', 'max']), write: (ref_image_size) => ({ input: { ref_image_size } }) }
    case 'resolution.aspect':
      return {
        kind: 'select',
        value: resolution.aspect,
        options: MINIMAX_H3_DIRECTOR_ASPECT_OPTIONS.map(([value, label]) => ({ value, label })),
        write: (aspect) => withResolution(state, { aspect: aspect as MiniMaxH3DirectorResolutionState['aspect'] }),
      }
    case 'resolution.resolution': {
      const mpBounds = bounds?.resolution_mp
      const presets = Object.entries(MINIMAX_H3_DIRECTOR_RESOLUTION_PRESETS)
        .filter(([, mp]) => mp >= (mpBounds?.min ?? 0) && mp <= (mpBounds?.max ?? Infinity))
        .map(([preset]) => ({ value: preset, label: preset }))
      return {
        kind: 'select',
        value: resolution.resolution,
        options: [{ value: 'auto', label: 'Auto' }, ...presets, { value: 'custom', label: 'CUSTOM' }],
        write: (next) => withResolution(state, { resolution: next as MiniMaxH3DirectorResolutionState['resolution'] }),
      }
    }
    case 'resolution.input_scaling':
      return { kind: 'select', value: resolution.input_scaling, options: toOptions(MINIMAX_H3_DIRECTOR_INPUT_SCALING_OPTIONS), write: (input_scaling) => withResolution(state, { input_scaling: input_scaling as MiniMaxH3DirectorResolutionState['input_scaling'] }) }
    case 'resolution.custom_aspect_w':
    case 'resolution.custom_aspect_h': {
      const key = inputKey === 'resolution.custom_aspect_w' ? 'custom_aspect_w' : 'custom_aspect_h'
      return { kind: 'number', value: resolution[key], min: 1, step: 1, write: (value) => withResolution(state, { [key]: Math.max(1, value) }) }
    }
    case 'resolution.custom_mode':
      return {
        kind: 'select',
        value: resolution.custom_mode,
        options: [{ value: 'mp', label: t({ ko: '메가픽셀', en: 'Megapixels' }) }, { value: 'fixed', label: t({ ko: '고정 픽셀', en: 'Fixed pixels' }) }],
        write: (mode) => withResolution(state, { custom_mode: mode === 'fixed' ? 'fixed' : 'mp' }),
      }
    case 'resolution.custom_mp':
      return { kind: 'number', value: resolution.custom_mp, min: bounds?.resolution_mp?.min ?? 0.01, max: bounds?.resolution_mp?.max, step: 0.1, write: (custom_mp) => withResolution(state, { custom_mp }) }
    case 'resolution.custom_width':
      return { kind: 'number', value: resolution.custom_width, min: bounds?.width?.min ?? 32, max: bounds?.width?.max, step: 32, write: (custom_width) => withResolution(state, { custom_width }) }
    case 'resolution.custom_height':
      return { kind: 'number', value: resolution.custom_height, min: bounds?.height?.min ?? 32, max: bounds?.height?.max, step: 32, write: (custom_height) => withResolution(state, { custom_height }) }
    case 'postprocess.simple.enabled':
      return { kind: 'boolean', value: postprocess.simple.enabled, write: (enabled) => withPostprocess(state, { ...postprocess, simple: { enabled } }) }
    case 'postprocess.model.enabled':
      return { kind: 'boolean', value: postprocess.model.enabled, write: (enabled) => withPostprocess(state, { ...postprocess, model: { ...postprocess.model, enabled } }) }
    case 'postprocess.model.model_name':
      return { kind: 'text', value: postprocess.model.model_name, write: (model_name) => withPostprocess(state, { ...postprocess, model: { ...postprocess.model, model_name } }) }
    case 'prompt.mode':
      return {
        kind: 'select',
        value: builderState.prompt_mode,
        options: [{ value: 'simple', label: t({ ko: '간단', en: 'Simple' }) }, { value: 'structured', label: t({ ko: '구조화', en: 'Structured' }) }],
        write: (mode) => ({ builder: setMiniMaxH3DirectorPromptMode(builderState, mode === 'simple' ? 'simple' : 'structured') }),
      }
    case 'start_image':
    case 'end_image':
    case 'reference_image':
    case 'reference_video':
    case 'reference_audio':
      return { kind: 'media' }
    default:
      break
  }

  if (inputKey.startsWith('postprocess.rtx.')) {
    const key = inputKey.slice('postprocess.rtx.'.length) as keyof MiniMaxH3DirectorRtxSettings
    if (RTX_BOOLEANS.has(key)) {
      return { kind: 'boolean', value: postprocess.rtx[key] === true, write: (value) => withRtx(state, { [key]: value }) }
    }
    const select = RTX_SELECTS[key]
    if (select) {
      return { kind: 'select', value: String(postprocess.rtx[key]), options: toOptions(select), write: (value) => withRtx(state, { [key]: value }) }
    }
    const range = RTX_NUMBERS[key]
    if (range) {
      const [min, max, step] = range
      return { kind: 'number', value: numberValue(postprocess.rtx[key]), min, max, step, write: (value) => withRtx(state, { [key]: key === 'device_id' ? Math.trunc(value) : value }) }
    }
    return null
  }

  if (inputKey.startsWith('prompt.')) {
    const key = inputKey.slice('prompt.'.length)
    // REF2VA's structured builder keeps its own soundscape and music under `ref`, like the panel shows them.
    const fromRef = REF_PROMPT_KEYS.has(key)
      || (builderState.mode === 'REF2VA' && builderState.prompt_mode !== 'simple' && (key === 'soundscape' || key === 'music'))
    if (fromRef) return { kind: 'prompt', value: String(builderState.ref[key] ?? '') }
    if (PROMPT_KEYS.has(key)) return { kind: 'prompt', value: String(builderState[key] ?? '') }
  }
  return null
}

/** Rows nested under a switch (RTX chain settings, the upscale model file) sit indented under it. */
export function isNestedDirectorWidget(inputKey: string) {
  return (inputKey.startsWith('postprocess.rtx.') && inputKey !== 'postprocess.rtx.enabled') || inputKey === 'postprocess.model.model_name'
}

/** Nested RTX rows drop the "RTX " their parent switch already says. */
export function getDirectorWidgetLabel(inputKey: string, label: string) {
  return inputKey.startsWith('postprocess.rtx.') && inputKey !== 'postprocess.rtx.enabled' ? label.replace(/^RTX\s+/, '') : label
}
