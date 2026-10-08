import { SpriteError } from './spriteErrors'

/**
 * Sprite extraction options, limits and validation.
 *
 * Ported from video-sprite-extractor (`app/media.py` SpriteOptions / _validate_options) with the integration plan's
 * deviations: one "key colour" background mode with despill as an option (D4), exact interval sampling by frame index
 * (D3), and the web UI defaults for both web and MCP callers (D5).
 */

export const MAX_SPRITE_FRAMES = 256
export const MAX_SHEET_DIMENSION = 16384
export const MAX_IMAGE_PIXELS = 64 * 1024 * 1024
/** Raw RGBA bytes one build may hold on disk at once (256 frames of 2048x2048). */
export const MAX_BUILD_RAW_BYTES = 4 * 1024 * 1024 * 1024
export const DEFAULT_ALPHA_THRESHOLD = 20
export const MAX_KEY_COLORS = 8

/** D5: the original web UI defaults, used for web and MCP alike (the original MCP used 0.18 / 0.12). */
export const KEY_DEFAULT_TOLERANCE = 0.1
export const KEY_DEFAULT_SOFTNESS = 0.05
export const DESPILL_DEFAULT_TOLERANCE = 0.08
export const DESPILL_DEFAULT_SOFTNESS = 0.92

export type SpriteBackgroundMode = 'none' | 'key'
export type SpriteResizeMode = 'none' | 'contain' | 'cover' | 'stretch'
export type SpriteImageFormat = 'png' | 'webp'

export interface SpriteVideoInfo {
  duration: number
  width: number
  height: number
  fps: number
  frameCount: number
  lastFrameTime: number
  formatName: string
}

export interface SpriteExtractOptions {
  startTime: number
  /** null = the last frame of the video. */
  endTime: number | null
  /** Interval sampling step in seconds; used when sampleCount is 0. */
  intervalSeconds: number
  /** 0 = interval sampling, 2..256 = evenly spread count. */
  sampleCount: number
  backgroundMode: SpriteBackgroundMode
  /** #RRGGBB, 1..8 colours; despill takes exactly one. */
  keyColors: string[]
  tolerance: number
  softness: number
  despill: boolean
  edgeCleanup: boolean
  autoCrop: boolean
  alphaThreshold: number
  /** Pre-crop in source pixels; width/height 0 = the whole frame. */
  cropX: number
  cropY: number
  cropWidth: number
  cropHeight: number
  resizeMode: SpriteResizeMode
  outputWidth: number
  outputHeight: number
  removeDuplicateFrames: boolean
  frameSimilarityThreshold: number
  /** 0 = pick the layout automatically (most square sheet within the size limit). */
  columns: number
  spacing: number
  outputFormat: SpriteImageFormat
  outputQuality: number
}

export type SpriteExtractOptionsInput = Partial<SpriteExtractOptions>

const HEX_COLOR = /^#?[0-9a-fA-F]{6}$/

export function parseHexColor(value: string): [number, number, number] {
  const trimmed = String(value ?? '').trim()
  if (!HEX_COLOR.test(trimmed)) {
    throw new SpriteError('배경 제거 색상은 #RRGGBB 형식이어야 합니다.')
  }
  const hex = trimmed.replace(/^#/, '')
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number]
}

export function normalizeHexColor(value: string): string {
  const [r, g, b] = parseHexColor(value)
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback
}

function integer(value: unknown, fallback: number): number {
  const parsed = finiteNumber(value, Number.NaN)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === '1' || value === 1) return true
  if (value === 'false' || value === '0' || value === 0) return false
  return fallback
}

/**
 * Fill every missing option with its default (the approved mockup: magenta key with despill on). Despill defaults to
 * on only for a single key colour, and tolerance/softness defaults follow the despill choice (D5).
 */
export function resolveExtractOptions(input: SpriteExtractOptionsInput = {}): SpriteExtractOptions {
  const endTime = input.endTime === null || input.endTime === undefined || (input.endTime as unknown) === ''
    ? null
    : finiteNumber(input.endTime, Number.NaN)
  const keyColors = Array.isArray(input.keyColors) && input.keyColors.length > 0
    ? input.keyColors.map((color) => String(color))
    : ['#FF00FF']
  const despill = bool(input.despill, keyColors.length === 1)
  return {
    startTime: finiteNumber(input.startTime, 0),
    endTime,
    intervalSeconds: finiteNumber(input.intervalSeconds, 0.1),
    sampleCount: integer(input.sampleCount, 0),
    backgroundMode: input.backgroundMode ?? 'key',
    keyColors,
    tolerance: finiteNumber(input.tolerance, despill ? DESPILL_DEFAULT_TOLERANCE : KEY_DEFAULT_TOLERANCE),
    softness: finiteNumber(input.softness, despill ? DESPILL_DEFAULT_SOFTNESS : KEY_DEFAULT_SOFTNESS),
    despill,
    edgeCleanup: bool(input.edgeCleanup, true),
    autoCrop: bool(input.autoCrop, true),
    alphaThreshold: integer(input.alphaThreshold, DEFAULT_ALPHA_THRESHOLD),
    cropX: integer(input.cropX, 0),
    cropY: integer(input.cropY, 0),
    cropWidth: integer(input.cropWidth, 0),
    cropHeight: integer(input.cropHeight, 0),
    resizeMode: input.resizeMode ?? 'none',
    outputWidth: integer(input.outputWidth, 0),
    outputHeight: integer(input.outputHeight, 0),
    removeDuplicateFrames: bool(input.removeDuplicateFrames, false),
    frameSimilarityThreshold: finiteNumber(input.frameSimilarityThreshold, 0.99),
    columns: integer(input.columns, 0),
    spacing: integer(input.spacing, 0),
    outputFormat: input.outputFormat ?? 'png',
    outputQuality: integer(input.outputQuality, 90),
  }
}

export interface ValidatedExtractPlan {
  options: SpriteExtractOptions
  endTime: number
  /** Decode-order source frame indices, deduplicated, in order. */
  frameIndices: number[]
  /** Size after pre-crop, before resize. */
  cropWidth: number
  cropHeight: number
  /** Size after resize (before contain padding is applied, it is the padded target). */
  frameWidth: number
  frameHeight: number
  keyRgb: Array<[number, number, number]>
}

/** Evenly spread sample indices (count mode); identical to the original `_sample_frame_indices`. */
export function sampleBounds(info: SpriteVideoInfo, startTime: number, endTime: number): [number, number] {
  const lastIndex = Math.max(0, info.frameCount - 1)
  const startIndex = Math.min(lastIndex, Math.max(0, Math.floor(startTime * info.fps + 0.5)))
  const endIndex = Math.min(lastIndex, Math.max(startIndex, Math.floor(endTime * info.fps + 0.5)))
  return [startIndex, endIndex]
}

export function countModeIndices(info: SpriteVideoInfo, startTime: number, endTime: number, count: number): number[] {
  const [startIndex, endIndex] = sampleBounds(info, startTime, endTime)
  const span = endIndex - startIndex
  return Array.from({ length: count }, (_, index) => Math.floor(startIndex + span * index / (count - 1) + 0.5))
}

export function intervalFrameCount(startTime: number, endTime: number, interval: number): number {
  return Math.floor((endTime - startTime + 1e-9) / interval) + 1
}

/**
 * D3: exact interval sampling. The original's `fps=…:round=near` filter picked the last source frame of each output
 * slot (one frame late); this picks the source frame nearest each sample time, deduplicated in order.
 */
export function intervalModeIndices(info: SpriteVideoInfo, startTime: number, endTime: number, interval: number): number[] {
  const count = intervalFrameCount(startTime, endTime, interval)
  const lastIndex = Math.max(0, info.frameCount - 1)
  const indices: number[] = []
  for (let k = 0; k < count; k += 1) {
    const index = Math.min(lastIndex, Math.max(0, Math.floor((startTime + k * interval) * info.fps + 0.5)))
    if (indices[indices.length - 1] !== index) indices.push(index)
  }
  return indices
}

/** Port of `_validate_options` plus the D3/D4 rules. Throws SpriteError with the original Korean messages. */
export function validateExtractOptions(info: SpriteVideoInfo, input: SpriteExtractOptions): ValidatedExtractPlan {
  const options = { ...input, keyColors: [...input.keyColors] }
  const endTime = options.endTime ?? info.lastFrameTime
  if (!Number.isFinite(options.startTime) || !Number.isFinite(endTime) || options.startTime < 0 || endTime < options.startTime) {
    throw new SpriteError('시작과 종료 시간을 확인하세요.')
  }
  if (endTime > info.lastFrameTime + Math.max(0.001, 0.5 / info.fps)) {
    throw new SpriteError('종료 시간이 영상의 마지막 프레임을 벗어났습니다.')
  }

  let frameIndices: number[]
  if (options.sampleCount) {
    if (options.sampleCount < 2 || options.sampleCount > MAX_SPRITE_FRAMES) {
      throw new SpriteError(`총 장수는 2~${MAX_SPRITE_FRAMES}장 사이여야 합니다.`)
    }
    if (endTime <= options.startTime) {
      throw new SpriteError('총 장수 추출은 시작과 종료 시간이 달라야 합니다.')
    }
    const [startIndex, endIndex] = sampleBounds(info, options.startTime, endTime)
    const available = endIndex - startIndex + 1
    if (options.sampleCount > available) {
      throw new SpriteError(`선택 구간에서는 중복 없이 최대 ${available}장까지 추출할 수 있습니다.`)
    }
    frameIndices = countModeIndices(info, options.startTime, endTime, options.sampleCount)
  } else {
    if (!Number.isFinite(options.intervalSeconds) || options.intervalSeconds <= 0) {
      throw new SpriteError('프레임 간격은 0보다 커야 합니다.')
    }
    const requested = intervalFrameCount(options.startTime, endTime, options.intervalSeconds)
    if (requested < 1 || requested > MAX_SPRITE_FRAMES) {
      throw new SpriteError(`한 번에 1~${MAX_SPRITE_FRAMES}프레임까지 추출할 수 있습니다.`)
    }
    frameIndices = intervalModeIndices(info, options.startTime, endTime, options.intervalSeconds)
  }

  if (options.backgroundMode !== 'none' && options.backgroundMode !== 'key') {
    throw new SpriteError('지원하지 않는 배경 제거 방식입니다.')
  }
  let keyRgb: Array<[number, number, number]> = []
  if (options.backgroundMode === 'key') {
    if (!Number.isFinite(options.tolerance) || options.tolerance < 0.01 || options.tolerance > 1) {
      throw new SpriteError('색상 허용 오차는 1%에서 100% 사이여야 합니다.')
    }
    if (!Number.isFinite(options.softness) || options.softness < 0 || options.softness > 1) {
      throw new SpriteError('경계 부드러움은 0%에서 100% 사이여야 합니다.')
    }
    if (options.keyColors.length < 1 || options.keyColors.length > MAX_KEY_COLORS) {
      throw new SpriteError(`제거 색상은 1개에서 ${MAX_KEY_COLORS}개까지 지정할 수 있습니다.`)
    }
    keyRgb = options.keyColors.map(parseHexColor)
    options.keyColors = options.keyColors.map(normalizeHexColor)
    if (options.despill) {
      if (options.keyColors.length !== 1) {
        throw new SpriteError('디스필은 색상 하나만 지정할 수 있습니다.')
      }
      if (options.softness <= 0) {
        throw new SpriteError('디스필의 경계 부드러움은 0보다 커야 합니다.')
      }
    }
  }
  if (options.autoCrop && (options.alphaThreshold < 1 || options.alphaThreshold > 255)) {
    throw new SpriteError('알파 임계값은 1에서 255 사이여야 합니다.')
  }

  const cropWidth = options.cropWidth || info.width
  const cropHeight = options.cropHeight || info.height
  if (Math.min(options.cropX, options.cropY, cropWidth, cropHeight) < 0) {
    throw new SpriteError('크롭 값은 음수일 수 없습니다.')
  }
  if (cropWidth <= 0 || cropHeight <= 0) {
    throw new SpriteError('크롭 너비와 높이는 0보다 커야 합니다.')
  }
  if (options.cropX + cropWidth > info.width || options.cropY + cropHeight > info.height) {
    throw new SpriteError('크롭 영역이 영상 프레임을 벗어났습니다.')
  }

  if (!['none', 'contain', 'cover', 'stretch'].includes(options.resizeMode)) {
    throw new SpriteError('지원하지 않는 리사이즈 방식입니다.')
  }
  let frameWidth = cropWidth
  let frameHeight = cropHeight
  if (options.resizeMode !== 'none') {
    if (options.outputWidth <= 0 || options.outputHeight <= 0) {
      throw new SpriteError('리사이즈 너비와 높이를 입력하세요.')
    }
    if (options.outputWidth > MAX_SHEET_DIMENSION || options.outputHeight > MAX_SHEET_DIMENSION) {
      throw new SpriteError(`리사이즈 크기는 ${MAX_SHEET_DIMENSION.toLocaleString('en-US')}px를 넘을 수 없습니다.`)
    }
    frameWidth = options.outputWidth
    frameHeight = options.outputHeight
  }

  if (options.columns < 0 || options.columns > 64) {
    throw new SpriteError('열 수는 1에서 64 사이여야 합니다.')
  }
  if (options.spacing < 0 || options.spacing > 64) {
    throw new SpriteError('프레임 간격은 0에서 64px 사이여야 합니다.')
  }
  if (!Number.isFinite(options.frameSimilarityThreshold) || options.frameSimilarityThreshold <= 0 || options.frameSimilarityThreshold > 1) {
    throw new SpriteError('프레임 일치율은 0% 초과 100% 이하여야 합니다.')
  }
  validateImageOutput(options.outputFormat, options.outputQuality)

  const frameCount = frameIndices.length
  if (frameCount < 1 || frameCount > MAX_SPRITE_FRAMES) {
    throw new SpriteError(`한 번에 1~${MAX_SPRITE_FRAMES}프레임까지 추출할 수 있습니다.`)
  }
  if (frameCount * frameWidth * frameHeight * 4 > MAX_BUILD_RAW_BYTES) {
    throw new SpriteError('추출할 프레임 전체 크기가 처리 한도를 넘었습니다. 구간·장수·크기를 줄이세요.')
  }
  if (!options.removeDuplicateFrames) {
    const layout = resolveSheetLayout(frameCount, frameWidth, frameHeight, options.columns, options.spacing)
    if (!layout) {
      throw new SpriteError(`스프라이트 시트의 한 변은 ${MAX_SHEET_DIMENSION.toLocaleString('en-US')}px를 넘을 수 없습니다.`)
    }
  }

  return { options, endTime, frameIndices, cropWidth, cropHeight, frameWidth, frameHeight, keyRgb }
}

export function validateImageOutput(format: string, quality: number): { format: SpriteImageFormat; quality: number } {
  const normalized = String(format).toLowerCase()
  if (normalized !== 'png' && normalized !== 'webp') {
    throw new SpriteError('출력 형식은 PNG 또는 WebP만 지원합니다.')
  }
  if (normalized === 'webp' && (!Number.isInteger(quality) || quality < 1 || quality > 100)) {
    throw new SpriteError('WebP 품질은 1에서 100 사이여야 합니다.')
  }
  return { format: normalized, quality: normalized === 'webp' ? quality : 100 }
}

export interface SheetLayout {
  columns: number
  rows: number
  width: number
  height: number
}

export function sheetSize(frameCount: number, frameWidth: number, frameHeight: number, columns: number, spacing: number): SheetLayout {
  const effectiveColumns = Math.min(columns, frameCount)
  const rows = Math.ceil(frameCount / effectiveColumns)
  return {
    columns: effectiveColumns,
    rows,
    width: effectiveColumns * frameWidth + (effectiveColumns - 1) * spacing,
    height: rows * frameHeight + (rows - 1) * spacing,
  }
}

/**
 * Columns 1..64 → the given layout; 0 → the web UI's automatic layout (`internalAtlasLayout`): the most square sheet
 * (smallest longer side) that fits the size limit. Returns null when nothing fits.
 */
export function resolveSheetLayout(frameCount: number, frameWidth: number, frameHeight: number, columns: number, spacing: number): SheetLayout | null {
  const fits = (layout: SheetLayout) => layout.width <= MAX_SHEET_DIMENSION && layout.height <= MAX_SHEET_DIMENSION
  if (columns > 0) {
    const layout = sheetSize(frameCount, frameWidth, frameHeight, columns, spacing)
    return fits(layout) ? layout : null
  }
  let best: SheetLayout | null = null
  for (let candidate = 1; candidate <= Math.min(64, frameCount); candidate += 1) {
    const layout = sheetSize(frameCount, frameWidth, frameHeight, candidate, spacing)
    if (!fits(layout)) continue
    if (!best || Math.max(layout.width, layout.height) < Math.max(best.width, best.height)) best = layout
  }
  return best
}
