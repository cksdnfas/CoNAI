import type { SpriteExtractOptions, SpriteImageFormat, SpriteRect, SpriteVideoInfo } from '@/lib/api-sprite'
import {
  planSpriteSampling,
  SPRITE_MAX_SHEET_DIMENSION as MAX_SHEET_DIMENSION,
  SPRITE_MAX_KEY_COLORS as MAX_KEY_COLORS,
  SPRITE_DEFAULT_ALPHA_THRESHOLD,
  SPRITE_KEY_DEFAULT_TOLERANCE,
  SPRITE_KEY_DEFAULT_SOFTNESS,
  SPRITE_DESPILL_DEFAULT_TOLERANCE,
  SPRITE_DESPILL_DEFAULT_SOFTNESS,
} from '@conai/shared'
export { MAX_SPRITE_FRAMES } from '@conai/shared'

/** Shared with the server; form-only defaults stay in this module. */
export { MAX_SHEET_DIMENSION, MAX_KEY_COLORS }
export const KEY_DEFAULTS = { tolerance: SPRITE_KEY_DEFAULT_TOLERANCE, softness: SPRITE_KEY_DEFAULT_SOFTNESS }
export const DESPILL_DEFAULTS = { tolerance: SPRITE_DESPILL_DEFAULT_TOLERANCE, softness: SPRITE_DESPILL_DEFAULT_SOFTNESS }
export const MAGENTA = '#FF00FF'

export type IntervalUnit = 'seconds' | 'frames'
export type SamplingMode = 'interval' | 'count'
/** full = every video from start to end; common = the same start/end seconds for every video. */
export type RangeMode = 'full' | 'common'

/** Form state: what the left column edits. Interval can be typed in seconds or frames. */
export interface ExtractForm {
  rangeMode: RangeMode
  startTime: number
  /** null = the last frame. */
  endTime: number | null
  samplingMode: SamplingMode
  intervalValue: number
  intervalUnit: IntervalUnit
  sampleCount: number
  removeDuplicateFrames: boolean
  /** Percent, 1..100. */
  similarityPercent: number
  keyColors: string[]
  /** Percent. */
  tolerancePercent: number
  softnessPercent: number
  despill: boolean
  edgeCleanup: boolean
  autoCrop: boolean
  alphaThreshold: number
  preCrop: SpriteRect | null
  resizeMode: SpriteExtractOptions['resizeMode']
  outputWidth: number
  outputHeight: number
}

export interface OutputForm {
  /** 0 = automatic layout. */
  columns: number
  spacing: number
  format: SpriteImageFormat
  quality: number
}

export const DEFAULT_OUTPUT: OutputForm = { columns: 0, spacing: 0, format: 'png', quality: 90 }

/** Where the sheets go: a library group path (null = "스프라이트") and whether a ZIP is downloaded too. */
export interface SaveForm {
  groupPath: string | null
  zip: boolean
}

export const DEFAULT_SAVE: SaveForm = { groupPath: null, zip: false }

export function defaultExtractForm(info?: SpriteVideoInfo | null): ExtractForm {
  return {
    rangeMode: 'full',
    startTime: 0,
    endTime: null,
    samplingMode: 'interval',
    intervalValue: info ? Math.max(1, Math.round(Math.max(1 / info.fps, info.lastFrameTime / 63) * info.fps)) : 2,
    intervalUnit: 'frames',
    sampleCount: info ? Math.max(2, Math.min(64, info.frameCount)) : 16,
    removeDuplicateFrames: false,
    similarityPercent: 99,
    keyColors: [MAGENTA],
    tolerancePercent: DESPILL_DEFAULTS.tolerance * 100,
    softnessPercent: DESPILL_DEFAULTS.softness * 100,
    despill: true,
    edgeCleanup: true,
    autoCrop: true,
    alphaThreshold: SPRITE_DEFAULT_ALPHA_THRESHOLD,
    preCrop: null,
    resizeMode: 'none',
    outputWidth: info?.width ?? 0,
    outputHeight: info?.height ?? 0,
  }
}

/** Turning despill on keeps one colour and swaps tolerance/softness to that method's defaults, and back. */
export function withDespill(form: ExtractForm, despill: boolean): ExtractForm {
  const defaults = despill ? DESPILL_DEFAULTS : KEY_DEFAULTS
  return {
    ...form,
    despill,
    keyColors: despill ? form.keyColors.slice(0, 1) : form.keyColors,
    tolerancePercent: defaults.tolerance * 100,
    softnessPercent: defaults.softness * 100,
  }
}

export function intervalSeconds(form: ExtractForm, fps: number) {
  return form.intervalUnit === 'frames' ? form.intervalValue / Math.max(1, fps) : form.intervalValue
}

export function resolvedStartTime(form: ExtractForm) {
  return form.rangeMode === 'full' ? 0 : form.startTime
}

export function resolvedEndTime(form: ExtractForm, info: SpriteVideoInfo | null | undefined) {
  return (form.rangeMode === 'full' ? null : form.endTime) ?? info?.lastFrameTime ?? 0
}

/** Same selection as the server (exact interval sampling by frame index, D3). */
export function estimateFrameSelection(form: ExtractForm, info: SpriteVideoInfo | null | undefined) {
  if (!info || info.frameCount < 1) return null
  return planSpriteSampling(info, resolvedStartTime(form), resolvedEndTime(form, info),
    form.samplingMode === 'count' ? form.sampleCount : 0, Number(intervalSeconds(form, info.fps).toFixed(6)))
}

export function toExtractOptions(form: ExtractForm, info: SpriteVideoInfo | null | undefined, output: OutputForm): Partial<SpriteExtractOptions> {
  const fps = info?.fps ?? 30
  return {
    startTime: resolvedStartTime(form),
    endTime: form.rangeMode === 'full' ? null : form.endTime,
    intervalSeconds: Number(intervalSeconds(form, fps).toFixed(6)),
    sampleCount: form.samplingMode === 'count' ? form.sampleCount : 0,
    backgroundMode: 'key',
    keyColors: form.despill ? form.keyColors.slice(0, 1) : form.keyColors,
    tolerance: form.tolerancePercent / 100,
    softness: form.softnessPercent / 100,
    despill: form.despill,
    edgeCleanup: form.edgeCleanup,
    autoCrop: form.autoCrop,
    alphaThreshold: form.alphaThreshold,
    cropX: form.preCrop?.x ?? 0,
    cropY: form.preCrop?.y ?? 0,
    cropWidth: form.preCrop?.width ?? 0,
    cropHeight: form.preCrop?.height ?? 0,
    resizeMode: form.resizeMode,
    outputWidth: form.resizeMode === 'none' ? 0 : form.outputWidth,
    outputHeight: form.resizeMode === 'none' ? 0 : form.outputHeight,
    removeDuplicateFrames: form.removeDuplicateFrames,
    frameSimilarityThreshold: form.similarityPercent / 100,
    columns: output.columns,
    spacing: output.spacing,
    outputFormat: output.format,
    outputQuality: output.quality,
  }
}

/** What a build depends on: a different signature means the shown result is stale. Layout/format re-render instead. */
export function extractSignature(videoHash: string | null, form: ExtractForm) {
  return JSON.stringify({ videoHash, ...form })
}

/** The web original's automatic layout: the most square sheet within the size limit. */
export function autoSheetLayout(frameCount: number, frameWidth: number, frameHeight: number, spacing: number) {
  let best: { columns: number; rows: number; width: number; height: number } | null = null
  for (let columns = 1; columns <= Math.min(64, Math.max(1, frameCount)); columns += 1) {
    const rows = Math.ceil(frameCount / columns)
    const width = columns * frameWidth + (columns - 1) * spacing
    const height = rows * frameHeight + (rows - 1) * spacing
    if (width > MAX_SHEET_DIMENSION || height > MAX_SHEET_DIMENSION) continue
    if (!best || Math.max(width, height) < Math.max(best.width, best.height)) best = { columns, rows, width, height }
  }
  return best
}

export function sheetLayout(frameCount: number, frameWidth: number, frameHeight: number, columns: number, spacing: number) {
  if (columns <= 0) return autoSheetLayout(frameCount, frameWidth, frameHeight, spacing)
  const effective = Math.max(1, Math.min(columns, frameCount))
  const rows = Math.ceil(frameCount / effective)
  return { columns: effective, rows, width: effective * frameWidth + (effective - 1) * spacing, height: rows * frameHeight + (rows - 1) * spacing }
}

/** Cell dimensions after spacing; exact only when both dimensions are positive integers. */
export function cellSize(width: number, height: number, columns: number, rows: number, spacing: number) {
  const cellWidth = (width - (columns - 1) * spacing) / columns
  const cellHeight = (height - (rows - 1) * spacing) / rows
  return { cellWidth, cellHeight, exact: Number.isInteger(cellWidth) && Number.isInteger(cellHeight) && cellWidth > 0 && cellHeight > 0 }
}

export function normalizeHex(value: string) {
  const trimmed = value.trim().replace(/^#?/, '#')
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toUpperCase() : null
}

export function formatSeconds(value: number) {
  const minutes = Math.floor(value / 60)
  const seconds = value - minutes * 60
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`
}

/**
 * Stored options (a preset or a saved sheet's settings) back into the form. Interval comes back in seconds since the
 * options keep seconds; output size falls back to the selected video's when the options had none.
 */
export function formFromOptions(options: Partial<SpriteExtractOptions>, info?: SpriteVideoInfo | null): { form: ExtractForm; output: OutputForm } {
  const base = defaultExtractForm(info)
  const keyColors = (options.keyColors ?? base.keyColors).map((color) => normalizeHex(color)).filter((color): color is string => Boolean(color))
  const despill = options.despill ?? base.despill
  const hasCrop = (options.cropWidth ?? 0) > 0 && (options.cropHeight ?? 0) > 0
  const startTime = options.startTime ?? 0
  const endTime = options.endTime ?? null
  return {
    form: {
      ...base,
      rangeMode: startTime > 0 || endTime !== null ? 'common' : 'full',
      startTime,
      endTime,
      samplingMode: (options.sampleCount ?? 0) > 0 ? 'count' : 'interval',
      intervalUnit: 'seconds',
      intervalValue: options.intervalSeconds ?? Number((base.intervalValue / Math.max(1, info?.fps ?? 30)).toFixed(4)),
      sampleCount: (options.sampleCount ?? 0) > 0 ? options.sampleCount! : base.sampleCount,
      removeDuplicateFrames: options.removeDuplicateFrames ?? base.removeDuplicateFrames,
      similarityPercent: options.frameSimilarityThreshold !== undefined ? options.frameSimilarityThreshold * 100 : base.similarityPercent,
      keyColors: keyColors.length ? (despill ? keyColors.slice(0, 1) : keyColors.slice(0, MAX_KEY_COLORS)) : base.keyColors,
      tolerancePercent: options.tolerance !== undefined ? options.tolerance * 100 : base.tolerancePercent,
      softnessPercent: options.softness !== undefined ? options.softness * 100 : base.softnessPercent,
      despill,
      edgeCleanup: options.edgeCleanup ?? base.edgeCleanup,
      autoCrop: options.autoCrop ?? base.autoCrop,
      alphaThreshold: options.alphaThreshold ?? base.alphaThreshold,
      preCrop: hasCrop ? { x: options.cropX ?? 0, y: options.cropY ?? 0, width: options.cropWidth!, height: options.cropHeight! } : null,
      resizeMode: options.resizeMode ?? base.resizeMode,
      outputWidth: options.outputWidth || base.outputWidth,
      outputHeight: options.outputHeight || base.outputHeight,
    },
    output: {
      columns: options.columns ?? DEFAULT_OUTPUT.columns,
      spacing: options.spacing ?? DEFAULT_OUTPUT.spacing,
      format: options.outputFormat ?? DEFAULT_OUTPUT.format,
      quality: options.outputQuality ?? DEFAULT_OUTPUT.quality,
    },
  }
}
