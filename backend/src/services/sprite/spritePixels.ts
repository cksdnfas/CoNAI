import { SpriteError } from './spriteErrors'

/**
 * Pixel stages of the sprite engine on straight (non-premultiplied) RGBA byte frames.
 *
 * Pure and synchronous so they run unchanged in the sprite worker thread or inline. Ported from
 * video-sprite-extractor `app/media.py`; the despill math reproduces NumPy float32 arithmetic with Math.fround after
 * every operation so results match the original within ±1 per channel (golden fixtures in test/fixtures/av-golden).
 */

export interface RgbaFrame {
  width: number
  height: number
  /** width * height * 4 bytes, straight RGBA. */
  data: Uint8Array
}

const f32 = Math.fround

/** NumPy `np.rint` (round half to even) — also what Python's round() does on the values we pass. */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value)
  const diff = value - floor
  if (diff > 0.5) return floor + 1
  if (diff < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

function toByte(value: number): number {
  const rounded = roundHalfEven(f32(value * 255))
  return rounded < 0 ? 0 : rounded > 255 ? 255 : rounded
}

// ---------------------------------------------------------------------------------------------------------------------
// Colour key (D1)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * ffmpeg `colorkey` (vf_colorkey.c, 8-bit): alpha = trunc(clip((distance - similarity) / blend, 0, 1) * 255), with the
 * filter's float similarity and 1/blend. Verified byte-exact against the golden colorkey frames.
 */
export function colorKeyAlpha(r: number, g: number, b: number, key: readonly [number, number, number], similarity: number, inverseBlend: number): number {
  const dr = r - key[0]
  const dg = g - key[1]
  const db = b - key[2]
  const diff = Math.sqrt((dr * dr + dg * dg + db * db) / (255.0 * 255.0 * 3.0))
  if (inverseBlend < 10000.0) {
    const value = (diff - similarity) * inverseBlend
    return Math.trunc((value < 0 ? 0 : value > 1 ? 1 : value) * 255)
  }
  return diff > similarity ? 255 : 0
}

/**
 * Key one frame in place. D1: the original chained one ffmpeg colorkey per colour and each overwrote the alpha, so
 * only the last colour was removed; here every colour applies and the most transparent result wins (min alpha).
 * RGB is left untouched, like ffmpeg (transparent pixels keep their colour).
 */
export function applyColorKey(frame: RgbaFrame, keys: ReadonlyArray<readonly [number, number, number]>, tolerance: number, softness: number): void {
  const similarity = f32(tolerance)
  const inverseBlend = f32(1 / f32(softness))
  const data = frame.data
  for (let offset = 0; offset < data.length; offset += 4) {
    let alpha = data[offset + 3]
    for (const key of keys) {
      const keyed = colorKeyAlpha(data[offset], data[offset + 1], data[offset + 2], key, similarity, inverseBlend)
      if (keyed < alpha) alpha = keyed
    }
    data[offset + 3] = alpha
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Despill (D4)
// ---------------------------------------------------------------------------------------------------------------------

const LUMA = [f32(0.299), f32(0.587), f32(0.114)] as const
const SOLID_ALPHA = f32(0.9)
const BORDER_RATIO = 0.5
/** Raw alpha up to which a border pixel counts as the key colour in the border check (or the tolerance, if looser). */
const BORDER_MATCH_RAW = f32(0.25)
const BORDER_FRACTION = 0.02

function dot3(r: number, g: number, b: number): number {
  return f32(f32(f32(r * LUMA[0]) + f32(g * LUMA[1])) + f32(b * LUMA[2]))
}

/** Median the way np.median returns it for float32: the middle value, or the float32 mean of the middle two. */
function float32Median(values: Float32Array | number[]): number {
  const sorted = Float32Array.from(values).sort()
  const mid = sorted.length >> 1
  if (sorted.length % 2 === 1) return sorted[mid]
  return f32(f32(sorted[mid - 1] + sorted[mid]) / 2)
}

/** Border width and the frame-border pixel indices in the original's order (top, bottom, then the side columns). */
export function outerBorderIndices(width: number, height: number): number[] {
  const shortSide = Math.min(width, height)
  const borderWidth = Math.max(1, Math.min(roundHalfEven(shortSide * BORDER_FRACTION), Math.max(1, Math.floor(shortSide / 2))))
  const indices: number[] = []
  for (let y = 0; y < borderWidth; y += 1) for (let x = 0; x < width; x += 1) indices.push(y * width + x)
  for (let y = height - borderWidth; y < height; y += 1) for (let x = 0; x < width; x += 1) indices.push(y * width + x)
  if (height > borderWidth * 2) {
    for (let y = borderWidth; y < height - borderWidth; y += 1) for (let x = 0; x < borderWidth; x += 1) indices.push(y * width + x)
    for (let y = borderWidth; y < height - borderWidth; y += 1) for (let x = width - borderWidth; x < width; x += 1) indices.push(y * width + x)
  }
  return indices
}

export type DespillKeyKind = 'hue' | 'difference' | 'distance'

/** Channel pairs closer than this (64/255) are too noise-prone to measure the key amount by (see keyChannelPairs). */
const MIN_PAIR_SPREAD = 64 / 255

/**
 * The raw alpha is "1 - how much key colour the pixel holds", so ordinary foreground reaches 1 and the 0.08 / 0.92
 * defaults make it opaque, as with the original.
 * - hue: pure primaries and secondaries (every channel 0 or 255, not grey): 1 - max(min(on) - max(off), 0). For magenta
 *   this is exactly the original `1 - max(min(R,B) - G, 0)`.
 * - difference: other colours: the same colour difference written per channel pair, key amount =
 *   min over pairs (i, j) with k_i > k_j of (p_i - p_j) / (k_i - k_j). For a pure hue it equals min(on) - max(off).
 * - distance: near-grey keys with no usable channel spread: RGB distance to the key, saturating halfway to the
 *   farthest colour.
 */
export function despillKeyKind(key: readonly [number, number, number]): DespillKeyKind {
  const pure = key.every((channel) => channel === 0 || channel === 255)
  const grey = key[0] === key[1] && key[1] === key[2]
  if (pure && !grey) return 'hue'
  return keyChannelPairs(key).length > 0 ? 'difference' : 'distance'
}

function keyChannelPairs(key: readonly [number, number, number]): Array<[number, number, number]> {
  const pairs: Array<[number, number, number]> = []
  for (let high = 0; high < 3; high += 1) {
    for (let low = 0; low < 3; low += 1) {
      const spread = (key[high] - key[low]) / 255
      if (spread >= MIN_PAIR_SPREAD) pairs.push([high, low, spread])
    }
  }
  return pairs
}

/** The raw alpha (formulas above) of one colour, channels 0..1, against `key` (bytes). */
function rawKeyAlpha(kind: DespillKeyKind, key: readonly [number, number, number], color: readonly number[]): number {
  if (kind === 'hue') {
    let low = Infinity
    let high = -Infinity
    for (let channel = 0; channel < 3; channel += 1) {
      if (key[channel] === 255) low = Math.min(low, color[channel])
      else high = Math.max(high, color[channel])
    }
    return f32(1 - Math.max(f32(low - high), 0))
  }
  if (kind === 'difference') {
    let amount = Infinity
    for (const [high, low, spread] of keyChannelPairs(key)) amount = Math.min(amount, f32(f32(color[high] - color[low]) / f32(spread)))
    return f32(1 - Math.min(Math.max(amount, 0), 1))
  }
  const farthest = Math.sqrt(key.reduce((sum, channel) => sum + Math.max(channel, 255 - channel) ** 2, 0))
  const distance = Math.sqrt(color.reduce((sum, channel, index) => sum + (channel * 255 - key[index]) ** 2, 0))
  return f32(Math.min(1, (2 * distance) / farthest))
}

export interface DespillOptions {
  key: readonly [number, number, number]
  tolerance: number
  softness: number
  edgeCleanup: boolean
  /** 1-based frame number for the error message. */
  frameNumber: number
}

export interface DespillTrace {
  borderPixelCount: number
  borderMatchRatio: number
  background: [number, number, number]
}

function keyLabel(key: readonly [number, number, number]): { name: string; hex: string } {
  const hex = `#${key.map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`
  if (hex === '#FF00FF') return { name: '마젠타', hex }
  return { name: '지정색', hex }
}

/**
 * Port of `_remove_magenta_color_difference_background` generalised to any key colour. Returns a new straight RGBA
 * frame: alpha from the key, foreground unmixed from the border-estimated background, optional edge clean-up.
 */
export function despillFrame(frame: RgbaFrame, options: DespillOptions, trace?: DespillTrace): Uint8Array {
  const { width, height, data } = frame
  const pixelCount = width * height
  const tolerance = f32(options.tolerance)
  const softness = f32(options.softness)
  const rgb = new Float32Array(pixelCount * 3)
  for (let index = 0; index < pixelCount; index += 1) {
    rgb[index * 3] = data[index * 4] / 255
    rgb[index * 3 + 1] = data[index * 4 + 1] / 255
    rgb[index * 3 + 2] = data[index * 4 + 2] / 255
  }

  const raw = new Float32Array(pixelCount)
  const kind = despillKeyKind(options.key)
  if (kind === 'hue') {
    const on = [0, 1, 2].filter((channel) => options.key[channel] === 255)
    const off = [0, 1, 2].filter((channel) => options.key[channel] === 0)
    for (let index = 0; index < pixelCount; index += 1) {
      const base = index * 3
      let low = Infinity
      for (const channel of on) low = Math.min(low, rgb[base + channel])
      let high = -Infinity
      for (const channel of off) high = Math.max(high, rgb[base + channel])
      const contribution = Math.max(f32(low - high), 0)
      raw[index] = f32(1 - contribution)
    }
  } else if (kind === 'difference') {
    const pairs = keyChannelPairs(options.key)
    for (let index = 0; index < pixelCount; index += 1) {
      const base = index * 3
      let amount = Infinity
      for (const [high, low, spread] of pairs) amount = Math.min(amount, f32(f32(rgb[base + high] - rgb[base + low]) / f32(spread)))
      raw[index] = f32(1 - Math.min(Math.max(amount, 0), 1))
    }
  } else {
    const key = options.key
    const farthest = Math.sqrt(key.reduce((sum, channel) => sum + Math.max(channel, 255 - channel) ** 2, 0))
    for (let index = 0; index < pixelCount; index += 1) {
      const dr = data[index * 4] - key[0]
      const dg = data[index * 4 + 1] - key[1]
      const db = data[index * 4 + 2] - key[2]
      raw[index] = f32(Math.min(1, (2 * Math.sqrt(dr * dr + dg * dg + db * db)) / farthest))
    }
  }

  // The border check is not the keying tolerance: H.264 shifts the decoded key (#FF00FF comes back as e.g.
  // (251,13,242), raw 0.10), which a 0.08 tolerance would reject as "not the key colour" before any correction.
  const border = outerBorderIndices(width, height)
  const looseLimit = Math.max(tolerance, BORDER_MATCH_RAW)
  let matching = 0
  let loose = 0
  for (const index of border) {
    if (raw[index] <= tolerance) matching += 1
    if (raw[index] <= looseLimit) loose += 1
  }
  const ratio = loose / border.length
  if (ratio < BORDER_RATIO) {
    const label = keyLabel(options.key)
    throw new SpriteError(`${options.frameNumber}번 프레임 외곽의 ${label.name} 배경 비율이 ${(ratio * 100).toFixed(1)}%로 너무 낮습니다. ${label.hex} 배경 영상을 확인하세요.`)
  }

  // H.264 colour conversion shifts the decoded key away from the exact colour; estimate it from the matching border:
  // the pixels inside the tolerance as the original does, or the loosely matching ones when the shift put most past it.
  const sampleLimit = matching / border.length >= BORDER_RATIO ? tolerance : looseLimit
  const channelSamples: number[][] = [[], [], []]
  for (const index of border) {
    if (raw[index] > sampleLimit) continue
    for (let channel = 0; channel < 3; channel += 1) channelSamples[channel].push(rgb[index * 3 + channel])
  }
  const background = channelSamples.map((samples) => float32Median(samples)) as [number, number, number]

  // A background that would not key at the tolerance itself: measure every pixel against it instead of the exact key,
  // so the user's tolerance applies to the corrected colour. A background that keys keeps the original's numbers.
  const backgroundRaw = rawKeyAlpha(kind, options.key, background)
  if (backgroundRaw > tolerance) {
    if (kind === 'distance') {
      const farthest = Math.sqrt(background.reduce((sum, channel) => sum + Math.max(channel, 1 - channel) ** 2, 0))
      for (let index = 0; index < pixelCount; index += 1) {
        const dr = rgb[index * 3] - background[0]
        const dg = rgb[index * 3 + 1] - background[1]
        const db = rgb[index * 3 + 2] - background[2]
        raw[index] = f32(Math.min(1, (2 * Math.sqrt(dr * dr + dg * dg + db * db)) / farthest))
      }
    } else {
      const backgroundAmount = f32(1 - backgroundRaw)
      for (let index = 0; index < pixelCount; index += 1) raw[index] = f32(1 - Math.min(f32(f32(1 - raw[index]) / backgroundAmount), 1))
    }
  }
  if (trace) {
    trace.borderPixelCount = border.length
    trace.borderMatchRatio = ratio
    trace.background = background
  }

  const alpha = new Float32Array(pixelCount)
  for (let index = 0; index < pixelCount; index += 1) {
    const value = f32(f32(raw[index] - tolerance) / softness)
    alpha[index] = value < 0 ? 0 : value > 1 ? 1 : value
  }

  if (options.edgeCleanup) {
    // Near-key compression noise can pass the key test though every channel is still inside the tolerance.
    for (let index = 0; index < pixelCount; index += 1) {
      if (alpha[index] >= SOLID_ALPHA) continue
      let maxDiff = 0
      for (let channel = 0; channel < 3; channel += 1) {
        maxDiff = Math.max(maxDiff, Math.abs(f32(rgb[index * 3 + channel] - background[channel])))
      }
      if (maxDiff <= tolerance) alpha[index] = 0
    }
  }

  const foreground = new Float32Array(pixelCount * 3)
  for (let index = 0; index < pixelCount; index += 1) {
    const a = alpha[index]
    if (!(a > 0)) continue
    const inverse = f32(1 - a)
    for (let channel = 0; channel < 3; channel += 1) {
      const value = f32(f32(rgb[index * 3 + channel] - f32(inverse * background[channel])) / a)
      foreground[index * 3 + channel] = value < 0 ? 0 : value > 1 ? 1 : value
    }
  }

  if (options.edgeCleanup) {
    refineDespillEdges(foreground, alpha, rgb, background, width, height)
  }

  const output = new Uint8Array(pixelCount * 4)
  for (let index = 0; index < pixelCount; index += 1) {
    const alphaByte = toByte(alpha[index])
    output[index * 4 + 3] = alphaByte
    if (alphaByte === 0) continue
    output[index * 4] = toByte(foreground[index * 3])
    output[index * 4 + 1] = toByte(foreground[index * 3 + 1])
    output[index * 4 + 2] = toByte(foreground[index * 3 + 2])
  }
  return output
}

/** `_refine_despill_edges`: works on the bounding box of visible pixels plus a one-pixel transparent margin. */
function refineDespillEdges(foreground: Float32Array, alpha: Float32Array, rgb: Float32Array, background: readonly number[], width: number, height: number): void {
  let top = -1
  let bottom = -1
  let left = width
  let right = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] > 0) {
        if (top < 0) top = y
        bottom = y
        if (x < left) left = x
        if (x > right) right = x
      }
    }
  }
  if (top < 0) return
  const y0 = Math.max(0, top - 1)
  const y1 = Math.min(height, bottom + 2)
  const x0 = Math.max(0, left - 1)
  const x1 = Math.min(width, right + 2)
  const regionWidth = x1 - x0
  const regionHeight = y1 - y0
  const regionSize = regionWidth * regionHeight
  const full = (rx: number, ry: number) => (ry + y0) * width + (rx + x0)

  const reliable = new Uint8Array(regionSize)
  let anyReliable = false
  const colors = new Float32Array(regionSize * 3)
  for (let ry = 0; ry < regionHeight; ry += 1) {
    for (let rx = 0; rx < regionWidth; rx += 1) {
      const local = ry * regionWidth + rx
      const index = full(rx, ry)
      if (alpha[index] >= SOLID_ALPHA) {
        reliable[local] = 1
        anyReliable = true
        colors[local * 3] = foreground[index * 3]
        colors[local * 3 + 1] = foreground[index * 3 + 1]
        colors[local * 3 + 2] = foreground[index * 3 + 2]
      }
    }
  }
  if (!anyReliable) return

  // Limit propagation to the narrow fringe of a solid object (four rings).
  const colorSum = new Float32Array(regionSize * 3)
  const weightSum = new Float32Array(regionSize)
  for (let iteration = 0; iteration < 4; iteration += 1) {
    colorSum.fill(0)
    weightSum.fill(0)
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let ry = 0; ry < regionHeight; ry += 1) {
          const sy = ry + dy
          if (sy < 0 || sy >= regionHeight) continue
          for (let rx = 0; rx < regionWidth; rx += 1) {
            const sx = rx + dx
            if (sx < 0 || sx >= regionWidth) continue
            const local = ry * regionWidth + rx
            const source = sy * regionWidth + sx
            colorSum[local * 3] = colorSum[local * 3] + colors[source * 3]
            colorSum[local * 3 + 1] = colorSum[local * 3 + 1] + colors[source * 3 + 1]
            colorSum[local * 3 + 2] = colorSum[local * 3 + 2] + colors[source * 3 + 2]
            weightSum[local] = weightSum[local] + reliable[source]
          }
        }
      }
    }
    const fill: number[] = []
    for (let local = 0; local < regionSize; local += 1) {
      if (!reliable[local] && alpha[full(local % regionWidth, Math.floor(local / regionWidth))] > 0 && weightSum[local] > 0) fill.push(local)
    }
    if (fill.length === 0) break
    for (const local of fill) {
      colors[local * 3] = colorSum[local * 3] / weightSum[local]
      colors[local * 3 + 1] = colorSum[local * 3 + 1] / weightSum[local]
      colors[local * 3 + 2] = colorSum[local * 3 + 2] / weightSum[local]
      reliable[local] = 1
    }
  }

  const contrastFloor = f32(0.1)
  const fringe = f32(1 - 0.9)
  for (let local = 0; local < regionSize; local += 1) {
    const index = full(local % regionWidth, Math.floor(local / regionWidth))
    const a = alpha[index]
    if (!reliable[local] || !(a > 0) || !(a < SOLID_ALPHA)) continue
    const contrast = dot3(
      f32(colors[local * 3] - background[0]),
      f32(colors[local * 3 + 1] - background[1]),
      f32(colors[local * 3 + 2] - background[2]),
    )
    const observed = dot3(
      f32(rgb[index * 3] - background[0]),
      f32(rgb[index * 3 + 1] - background[1]),
      f32(rgb[index * 3 + 2] - background[2]),
    )
    let coverage = a
    if (Math.abs(contrast) >= contrastFloor) {
      const fitted = f32(observed / contrast)
      coverage = fitted < 0 ? 0 : fitted > 1 ? 1 : fitted
    }
    const strengthRaw = f32(f32(SOLID_ALPHA - a) / fringe)
    const alphaStrength = strengthRaw < 0 ? 0 : strengthRaw > 1 ? 1 : strengthRaw
    const nextAlpha = f32(a - f32(alphaStrength * Math.max(f32(a - coverage), 0)))
    alpha[index] = nextAlpha
    const strength = f32(1 - f32(nextAlpha / SOLID_ALPHA))
    for (let channel = 0; channel < 3; channel += 1) {
      const current = foreground[index * 3 + channel]
      foreground[index * 3 + channel] = f32(current + f32(strength * f32(colors[local * 3 + channel] - current)))
    }
  }

  suppressDespillEdgeOutliers(foreground, alpha, width, x0, y0, regionWidth, regionHeight)
}

/** `_suppress_despill_edge_outliers`: replace isolated bright colour spikes on the visible contour only. */
function suppressDespillEdgeOutliers(foreground: Float32Array, alpha: Float32Array, width: number, x0: number, y0: number, regionWidth: number, regionHeight: number): void {
  const at = (rx: number, ry: number) => (ry + y0) * width + (rx + x0)
  const inside = (rx: number, ry: number) => rx >= 0 && ry >= 0 && rx < regionWidth && ry < regionHeight
  const lowAlpha = f32(0.05)
  const brightLimit = f32(0.12)
  const replacements: Array<{ index: number; color: [number, number, number] }> = []
  for (let ry = 0; ry < regionHeight; ry += 1) {
    for (let rx = 0; rx < regionWidth; rx += 1) {
      const index = at(rx, ry)
      if (!(alpha[index] >= 0.5)) continue
      let minimum = alpha[index]
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const neighbour = inside(rx + dx, ry + dy) ? alpha[at(rx + dx, ry + dy)] : 0
          if (neighbour < minimum) minimum = neighbour
        }
      }
      if (!(minimum <= lowAlpha)) continue
      const samples: number[][] = [[], [], []]
      let visible = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!inside(rx + dx, ry + dy)) continue
          const neighbourIndex = at(rx + dx, ry + dy)
          if (!(alpha[neighbourIndex] >= 0.5)) continue
          visible += 1
          for (let channel = 0; channel < 3; channel += 1) samples[channel].push(foreground[neighbourIndex * 3 + channel])
        }
      }
      const local = samples.map((values) => float32Median(values)) as [number, number, number]
      const excess = dot3(
        f32(foreground[index * 3] - local[0]),
        f32(foreground[index * 3 + 1] - local[1]),
        f32(foreground[index * 3 + 2] - local[2]),
      )
      if (visible >= 4 && excess > brightLimit) replacements.push({ index, color: local })
    }
  }
  for (const { index, color } of replacements) {
    foreground[index * 3] = color[0]
    foreground[index * 3 + 1] = color[1]
    foreground[index * 3 + 2] = color[2]
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry: contain pad (D2), crop, auto-crop bounds
// ---------------------------------------------------------------------------------------------------------------------

/**
 * D2: contain padding is added after keying, as transparent pixels, centred like ffmpeg `pad=(ow-iw)/2:(oh-ih)/2`.
 * (The original padded before keying with opaque black, which made despill fail on most contain sizes.)
 */
export function padToSize(frame: RgbaFrame, width: number, height: number): RgbaFrame {
  if (frame.width === width && frame.height === height) return frame
  const output = new Uint8Array(width * height * 4)
  const offsetX = Math.floor((width - frame.width) / 2)
  const offsetY = Math.floor((height - frame.height) / 2)
  for (let y = 0; y < frame.height; y += 1) {
    const targetY = y + offsetY
    if (targetY < 0 || targetY >= height) continue
    const sourceStart = y * frame.width * 4
    const targetStart = (targetY * width + offsetX) * 4
    output.set(frame.data.subarray(sourceStart, sourceStart + frame.width * 4), targetStart)
  }
  return { width, height, data: output }
}

export interface Rect { x: number; y: number; width: number; height: number }

/** Crop a frame; area outside the source becomes transparent (PIL crop semantics). */
export function cropFrame(frame: RgbaFrame, rect: Rect): RgbaFrame {
  const output = new Uint8Array(rect.width * rect.height * 4)
  for (let y = 0; y < rect.height; y += 1) {
    const sourceY = rect.y + y
    if (sourceY < 0 || sourceY >= frame.height) continue
    const startX = Math.max(0, rect.x)
    const endX = Math.min(frame.width, rect.x + rect.width)
    if (endX <= startX) continue
    output.set(
      frame.data.subarray((sourceY * frame.width + startX) * 4, (sourceY * frame.width + endX) * 4),
      (y * rect.width + (startX - rect.x)) * 4,
    )
  }
  return { width: rect.width, height: rect.height, data: output }
}

/** PIL `getbbox` of the alpha mask (alpha >= threshold): [left, top, right, bottom) or null when empty. */
export function alphaBounds(frame: RgbaFrame, threshold: number): [number, number, number, number] | null {
  let left = frame.width
  let top = frame.height
  let right = -1
  let bottom = -1
  const data = frame.data
  for (let y = 0; y < frame.height; y += 1) {
    const rowStart = y * frame.width * 4
    for (let x = 0; x < frame.width; x += 1) {
      if (data[rowStart + x * 4 + 3] >= threshold) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        bottom = y
      }
    }
  }
  return right < 0 ? null : [left, top, right + 1, bottom + 1]
}

export function unionBounds(a: [number, number, number, number] | null, b: [number, number, number, number] | null): [number, number, number, number] | null {
  if (!a) return b
  if (!b) return a
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
}

// ---------------------------------------------------------------------------------------------------------------------
// Duplicate frames
// ---------------------------------------------------------------------------------------------------------------------

/**
 * `_frames_similar`: compare against the last KEPT frame; only pixels visible in either frame count; colours compared
 * premultiplied as (c*a+127)//255; per-channel tolerance 8 (0 when the threshold is 1). No visible pixels = similar.
 */
export function framesSimilar(previous: RgbaFrame, current: RgbaFrame, threshold: number): boolean {
  if (previous.width !== current.width || previous.height !== current.height) {
    throw new SpriteError('비교할 프레임 크기가 서로 다릅니다.')
  }
  const tolerance = threshold === 1 ? 0 : 8
  const before = previous.data
  const after = current.data
  let visible = 0
  let matching = 0
  for (let offset = 0; offset < before.length; offset += 4) {
    const alphaBefore = before[offset + 3]
    const alphaAfter = after[offset + 3]
    if (alphaBefore === 0 && alphaAfter === 0) continue
    visible += 1
    if (Math.abs(alphaBefore - alphaAfter) > tolerance) continue
    let same = true
    for (let channel = 0; channel < 3; channel += 1) {
      const colourBefore = Math.floor((before[offset + channel] * alphaBefore + 127) / 255)
      const colourAfter = Math.floor((after[offset + channel] * alphaAfter + 127) / 255)
      if (Math.abs(colourBefore - colourAfter) > tolerance) { same = false; break }
    }
    if (same) matching += 1
  }
  return visible === 0 || matching / visible >= threshold
}

// ---------------------------------------------------------------------------------------------------------------------
// Tiling
// ---------------------------------------------------------------------------------------------------------------------

/** Paste one cell into a sheet buffer (row-major grid, transparent gaps), like ffmpeg `tile=…:color=black@0`. */
export function pasteCell(sheet: Uint8Array, sheetWidth: number, frame: RgbaFrame, x: number, y: number): void {
  for (let row = 0; row < frame.height; row += 1) {
    const sourceStart = row * frame.width * 4
    sheet.set(frame.data.subarray(sourceStart, sourceStart + frame.width * 4), ((y + row) * sheetWidth + x) * 4)
  }
}

export function cellOrigin(index: number, columns: number, cellWidth: number, cellHeight: number, spacing: number): [number, number] {
  return [(index % columns) * (cellWidth + spacing), Math.floor(index / columns) * (cellHeight + spacing)]
}
