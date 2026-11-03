import { SpriteError } from './spriteErrors'
import { MAX_IMAGE_PIXELS, MAX_SHEET_DIMENSION, parseHexColor } from './spriteOptions'
import { cropFrame, pasteCell, roundHalfEven, type RgbaFrame } from './spritePixels'
import { pillowLanczosResize } from '../imageBatchResize/pillowResample'

export interface SourceNormalizationOptions {
  input: 'image' | 'last_frame'
  keyColor: string
  tolerance: number
  workSize: number
  canvasSize: number
  bottomMargin: number
  anchor: 'bottom' | 'center'
  keep: 'both' | 'work' | 'canvas'
  scale: number
  offsetX: number
  offsetY: number
}

export const SOURCE_NORMALIZATION_DEFAULTS: SourceNormalizationOptions = {
  input: 'image', keyColor: '#FF00FF', tolerance: 40, workSize: 1024, canvasSize: 1600,
  bottomMargin: 0, anchor: 'bottom', keep: 'both', scale: 1, offsetX: 0, offsetY: 0,
}

function checkSize(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > MAX_SHEET_DIMENSION || height > MAX_SHEET_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    throw new SpriteError('정규화 이미지 크기가 픽셀·메모리 처리 한도를 벗어났습니다.')
  }
}

export function resolveSourceNormalizationOptions(input: Partial<SourceNormalizationOptions>): SourceNormalizationOptions {
  const options = { ...SOURCE_NORMALIZATION_DEFAULTS, ...input }
  parseHexColor(options.keyColor)
  if (!['image', 'last_frame'].includes(options.input) || !['bottom', 'center'].includes(options.anchor)
    || !['both', 'work', 'canvas'].includes(options.keep)) throw new SpriteError('지원하지 않는 원본 정규화 옵션입니다.')
  checkSize(options.workSize, options.workSize)
  checkSize(options.canvasSize, options.canvasSize)
  if (!Number.isFinite(options.tolerance) || options.tolerance < 0) throw new SpriteError('색상 허용 거리는 0 이상의 유한한 수여야 합니다.')
  if (!Number.isSafeInteger(options.bottomMargin) || options.bottomMargin < 0
    || !Number.isSafeInteger(options.offsetX) || !Number.isSafeInteger(options.offsetY)) throw new SpriteError('여백과 이동량은 정수 픽셀이어야 합니다.')
  if (!Number.isFinite(options.scale) || options.scale <= 0 || options.scale > 1) throw new SpriteError('기준 자세 배율은 0보다 크고 1 이하여야 합니다.')
  if (options.input === 'image' && (options.workSize > options.canvasSize
    || (options.anchor === 'bottom' && options.workSize + options.bottomMargin > options.canvasSize))) {
    throw new SpriteError('작업 이미지와 하단 여백이 캔버스를 넘습니다.')
  }
  if (options.input === 'last_frame') options.keep = 'canvas'
  return options
}

type Color = readonly [number, number, number]

function hue(r: number, g: number, b: number): number | null {
  const max = Math.max(r, g, b)
  const delta = max - Math.min(r, g, b)
  if (delta === 0) return null
  return ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360
}

/**
 * Rotate the pixel's HSV hue so the key lies at magenta, retaining value and chroma.
 * Testing the original RGB wedge in that space preserves its exact magenta acceptance
 * region, unlike a fixed hue-angle cutoff. Achromatic keys have no hue: distance only.
 */
function borderKeyHue(r: number, g: number, b: number, keyHue: number | null): boolean {
  if (keyHue === null) return false
  if (keyHue === 300) return r >= 160 && b >= 160 && g <= 100
  const pixelHue = hue(r, g, b)
  if (pixelHue === null) return false
  const h = ((pixelHue - keyHue + 660) % 360) / 60
  const min = Math.min(r, g, b)
  const c = Math.max(r, g, b) - min
  const x = c * (1 - Math.abs(h % 2 - 1))
  const rgb = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x]
    : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x]
  return rgb[0] + min >= 160 && rgb[2] + min >= 160 && rgb[1] + min <= 100
}

function exact(data: Uint8Array, offset: number, key: Color): boolean {
  return data[offset] === key[0] && data[offset + 1] === key[1] && data[offset + 2] === key[2]
}

function snap(frame: RgbaFrame, key: Color, tolerance: number): void {
  const keyHue = hue(...key)
  const distance = tolerance * tolerance
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const i = (y * frame.width + x) * 4
      const r = frame.data[i], g = frame.data[i + 1], b = frame.data[i + 2]
      const ring = x < 2 || y < 2 || x >= frame.width - 2 || y >= frame.height - 2
      if ((r - key[0]) ** 2 + (g - key[1]) ** 2 + (b - key[2]) ** 2 <= distance
        || (ring && borderKeyHue(r, g, b, keyHue))) {
        frame.data[i] = key[0]
        frame.data[i + 1] = key[1]
        frame.data[i + 2] = key[2]
      }
    }
  }
}

function canvas(size: number, key: Color): RgbaFrame {
  checkSize(size, size)
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = key[0]; data[i + 1] = key[1]; data[i + 2] = key[2]; data[i + 3] = 255
  }
  return { width: size, height: size, data }
}

export interface SourceNormalizationReport {
  borderExact: boolean
  nearKeyCount: number
  passed: boolean
}

function report(frame: RgbaFrame, key: Color): SourceNormalizationReport {
  let borderExact = true
  let nearKeyCount = 0
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const i = (y * frame.width + x) * 4
      if (exact(frame.data, i, key)) continue
      if (x === 0 || y === 0 || x === frame.width - 1 || y === frame.height - 1) borderExact = false
      if ((frame.data[i] - key[0]) ** 2 + (frame.data[i + 1] - key[1]) ** 2
        + (frame.data[i + 2] - key[2]) ** 2 <= 40 * 40) nearKeyCount += 1
    }
  }
  return { borderExact, nearKeyCount, passed: borderExact && nearKeyCount === 0 }
}

export interface NormalizedSourceImage {
  kind: 'work' | 'canvas'
  frame: RgbaFrame
  report: SourceNormalizationReport
}

/** Opaque motion-generation sources; never use chroma removal/despill here. */
export function normalizeSourceImage(source: RgbaFrame, input: Partial<SourceNormalizationOptions>): NormalizedSourceImage[] {
  const options = resolveSourceNormalizationOptions(input)
  const key = parseHexColor(options.keyColor)
  const side = Math.max(source.width, source.height)
  checkSize(side, side)
  const flat: RgbaFrame = { ...source, data: new Uint8Array(source.data) }
  for (let i = 0; i < flat.data.length; i += 4) {
    const alpha = flat.data[i + 3]
    for (let c = 0; c < 3; c += 1) flat.data[i + c] = Math.round((flat.data[i + c] * alpha + key[c] * (255 - alpha)) / 255)
    flat.data[i + 3] = 255
  }
  snap(flat, key, options.tolerance)
  const square = canvas(side, key)
  pasteCell(square.data, side, flat, Math.floor((side - flat.width) / 2), side - flat.height)
  const size = options.input === 'last_frame' ? options.canvasSize : options.workSize
  const work = pillowLanczosResize(square, size, size)
  snap(work, key, options.tolerance)
  let big = canvas(options.canvasSize, key)
  if (options.input === 'last_frame') {
    const scaledSize = Math.max(1, roundHalfEven(size * options.scale))
    const smaller = scaledSize === size ? work : pillowLanczosResize(work, scaledSize, scaledSize)
    snap(smaller, key, options.tolerance)
    const start = Math.floor((size - scaledSize) / 2)
    pasteCell(big.data, size, smaller, start, start)
    if (options.offsetX || options.offsetY) {
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          if (!exact(big.data, (y * size + x) * 4, key) && (x + options.offsetX < 0 || x + options.offsetX >= size
            || y + options.offsetY < 0 || y + options.offsetY >= size)) {
            throw new SpriteError('이 이동은 보이는 캐릭터나 소품을 자릅니다. 이동량을 줄이세요.')
          }
        }
      }
      const shifted = canvas(size, key)
      const x = Math.max(0, -options.offsetX), y = Math.max(0, -options.offsetY)
      const width = Math.min(size, size - options.offsetX) - x
      const height = Math.min(size, size - options.offsetY) - y
      if (width > 0 && height > 0) pasteCell(shifted.data, size, cropFrame(big, { x, y, width, height }), x + options.offsetX, y + options.offsetY)
      big = shifted
    }
  } else {
    pasteCell(big.data, options.canvasSize, work, Math.floor((options.canvasSize - size) / 2),
      options.anchor === 'center' ? Math.floor((options.canvasSize - size) / 2) : options.canvasSize - size - options.bottomMargin)
  }
  snap(big, key, options.tolerance)
  const outputs: NormalizedSourceImage[] = []
  if (options.keep !== 'canvas') outputs.push({ kind: 'work', frame: work, report: report(work, key) })
  if (options.keep !== 'work') outputs.push({ kind: 'canvas', frame: big, report: report(big, key) })
  return outputs
}
