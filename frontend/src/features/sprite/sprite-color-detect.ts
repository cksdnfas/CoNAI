/**
 * The background colour of a frame: the most common colour along its border. Pixels are bucketed by their top 5 bits
 * per channel so gradients and compression noise fall together; the answer is the bucket's average.
 */
export function detectBorderColor(source: CanvasImageSource, width: number, height: number): string | null {
  if (!width || !height) return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(source, 0, 0, width, height)
  let data: Uint8ClampedArray
  try {
    data = context.getImageData(0, 0, width, height).data
  } catch {
    return null
  }
  const band = Math.max(1, Math.round(Math.min(width, height) * 0.01))
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>()
  const add = (x: number, y: number) => {
    const offset = (y * width + x) * 4
    const r = data[offset]
    const g = data[offset + 1]
    const b = data[offset + 2]
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
    bucket.count += 1
    bucket.r += r
    bucket.g += g
    bucket.b += b
    buckets.set(key, bucket)
  }
  const step = Math.max(1, Math.round(Math.max(width, height) / 400))
  for (let inset = 0; inset < band; inset += 1) {
    for (let x = 0; x < width; x += step) {
      add(x, inset)
      add(x, height - 1 - inset)
    }
    for (let y = 0; y < height; y += step) {
      add(inset, y)
      add(width - 1 - inset, y)
    }
  }
  let best: { count: number; r: number; g: number; b: number } | null = null
  for (const bucket of buckets.values()) if (!best || bucket.count > best.count) best = bucket
  if (!best) return null
  const hex = (sum: number) => Math.round(sum / best!.count).toString(16).padStart(2, '0')
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`.toUpperCase()
}
