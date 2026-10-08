import type { RgbaFrame } from '../sprite/spritePixels'

/**
 * Pillow's `Image.resize(size, Resampling.LANCZOS)` for RGBA, ported so the batch resize matches the original
 * video-sprite-extractor pixel for pixel (libvips' lanczos3 differs, and sharp upsamples with a bicubic interpolator).
 *
 * Mirrors Pillow 12 `libImaging/Resample.c` + `Convert.c`:
 *  - RGBA is premultiplied first (`rgba2rgbA`, MULDIV255) and un-premultiplied after (`rgbA2rgba`, integer division);
 *  - separable two-pass resampling, horizontal first, on the source rows the vertical pass will read;
 *  - Lanczos-3 coefficients per output pixel (support widened by the scale when reducing), normalised in double and
 *    converted to 22-bit fixed point (`PRECISION_BITS = 32 - 8 - 2`) with truncation toward zero after ±0.5;
 *  - accumulators start at 1 << 21 and clip to 8 bits by shifting.
 * Pure CPU work: run it on the sprite worker thread, not the HTTP thread.
 */

const PRECISION_BITS = 32 - 8 - 2
const PRECISION_ONE = 2 ** PRECISION_BITS
const HALF = 2 ** (PRECISION_BITS - 1)
const CLIP_HIGH = 2 ** (PRECISION_BITS + 8)
const LANCZOS_SUPPORT = 3

function sinc(x: number): number {
  if (x === 0) return 1
  const px = x * Math.PI
  return Math.sin(px) / px
}

function lanczos(x: number): number {
  return x >= -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0
}

interface Coefficients {
  ksize: number
  bounds: Int32Array // [xmin, count] per output pixel
  kk: Int32Array // fixed-point coefficients, ksize per output pixel
}

/** `precompute_coeffs` + `normalize_coeffs_8bpc` (box = the whole input). */
function precomputeCoefficients(inSize: number, outSize: number): Coefficients {
  const scale = inSize / outSize
  const filterscale = scale < 1 ? 1 : scale
  const support = LANCZOS_SUPPORT * filterscale
  const ksize = Math.ceil(support) * 2 + 1
  const bounds = new Int32Array(outSize * 2)
  const kk = new Int32Array(outSize * ksize)
  const weights = new Float64Array(ksize)
  const ss = 1 / filterscale
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale
    let xmin = Math.trunc(center - support + 0.5)
    if (xmin < 0) xmin = 0
    let xmax = Math.trunc(center + support + 0.5)
    if (xmax > inSize) xmax = inSize
    xmax -= xmin
    let ww = 0
    for (let x = 0; x < xmax; x++) {
      const w = lanczos((x + xmin - center + 0.5) * ss)
      weights[x] = w
      ww += w
    }
    for (let x = 0; x < ksize; x++) {
      const k = x < xmax ? (ww !== 0 ? weights[x] / ww : weights[x]) : 0
      kk[xx * ksize + x] = k < 0 ? Math.trunc(-0.5 + k * PRECISION_ONE) : Math.trunc(0.5 + k * PRECISION_ONE)
    }
    bounds[xx * 2] = xmin
    bounds[xx * 2 + 1] = xmax
  }
  return { ksize, bounds, kk }
}

function clip8(value: number): number {
  if (value >= CLIP_HIGH) return 255
  if (value <= 0) return 0
  return Math.floor(value / PRECISION_ONE)
}

/** Pillow `rgba2rgbA`: c * a / 255 rounded with MULDIV255. */
function premultiply(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    for (let c = 0; c < 3; c++) {
      const tmp = data[i + c] * alpha + 128
      out[i + c] = ((tmp >> 8) + tmp) >> 8
    }
    out[i + 3] = alpha
  }
  return out
}

/** Pillow `rgbA2rgba`: integer 255 * c / a, clipped; alpha 0 and 255 copy the colour as is. */
function unpremultiply(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    for (let c = 0; c < 3; c++) {
      out[i + c] = alpha === 255 || alpha === 0 ? data[i + c] : Math.min(255, Math.floor((255 * data[i + c]) / alpha))
    }
    out[i + 3] = alpha
  }
  return out
}

function resampleHorizontal(input: Uint8Array, inWidth: number, rowStart: number, rowCount: number, outWidth: number, coefficients: Coefficients): Uint8Array {
  const { ksize, bounds, kk } = coefficients
  const out = new Uint8Array(outWidth * rowCount * 4)
  for (let yy = 0; yy < rowCount; yy++) {
    const rowBase = (yy + rowStart) * inWidth * 4
    for (let xx = 0; xx < outWidth; xx++) {
      const xmin = bounds[xx * 2]
      const xmax = bounds[xx * 2 + 1]
      const kOffset = xx * ksize
      let s0 = HALF, s1 = HALF, s2 = HALF, s3 = HALF
      for (let x = 0; x < xmax; x++) {
        const k = kk[kOffset + x]
        const p = rowBase + (x + xmin) * 4
        s0 += input[p] * k
        s1 += input[p + 1] * k
        s2 += input[p + 2] * k
        s3 += input[p + 3] * k
      }
      const o = (yy * outWidth + xx) * 4
      out[o] = clip8(s0)
      out[o + 1] = clip8(s1)
      out[o + 2] = clip8(s2)
      out[o + 3] = clip8(s3)
    }
  }
  return out
}

function resampleVertical(input: Uint8Array, width: number, outHeight: number, coefficients: Coefficients, boundsShift: number): Uint8Array {
  const { ksize, bounds, kk } = coefficients
  const out = new Uint8Array(width * outHeight * 4)
  for (let yy = 0; yy < outHeight; yy++) {
    const ymin = bounds[yy * 2] - boundsShift
    const ymax = bounds[yy * 2 + 1]
    const kOffset = yy * ksize
    for (let xx = 0; xx < width; xx++) {
      let s0 = HALF, s1 = HALF, s2 = HALF, s3 = HALF
      for (let y = 0; y < ymax; y++) {
        const k = kk[kOffset + y]
        const p = ((y + ymin) * width + xx) * 4
        s0 += input[p] * k
        s1 += input[p + 1] * k
        s2 += input[p + 2] * k
        s3 += input[p + 3] * k
      }
      const o = (yy * width + xx) * 4
      out[o] = clip8(s0)
      out[o + 1] = clip8(s1)
      out[o + 2] = clip8(s2)
      out[o + 3] = clip8(s3)
    }
  }
  return out
}

/** `Image.resize((width, height), Image.Resampling.LANCZOS)` on a straight-alpha RGBA frame. */
export function pillowLanczosResize(frame: RgbaFrame, width: number, height: number): RgbaFrame {
  if (frame.width === width && frame.height === height) {
    return { width, height, data: new Uint8Array(frame.data) }
  }
  let data = premultiply(frame.data)
  let currentWidth = frame.width
  const horizontal = precomputeCoefficients(frame.width, width)
  const vertical = precomputeCoefficients(frame.height, height)
  const needHorizontal = width !== frame.width
  const needVertical = height !== frame.height
  let boundsShift = 0
  if (needHorizontal) {
    // Only the source rows the vertical pass will read (ybox_first .. ybox_last), like Pillow.
    const first = vertical.bounds[0]
    const last = vertical.bounds[height * 2 - 2] + vertical.bounds[height * 2 - 1]
    data = resampleHorizontal(data, frame.width, first, last - first, width, horizontal)
    currentWidth = width
    boundsShift = first
  }
  if (needVertical) {
    data = resampleVertical(data, currentWidth, height, vertical, boundsShift)
  }
  return { width, height, data: unpremultiply(data) }
}
