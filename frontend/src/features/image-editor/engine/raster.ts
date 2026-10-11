/** Pixel helpers for the editor: every layer and patch is a plain 2D canvas in document pixels. */

export type Rect = { x: number; y: number; width: number; height: number }

export function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

export function context2d(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('2D canvas is not available')
  }
  return context
}

export function cloneCanvas(source: HTMLCanvasElement) {
  const copy = createCanvas(source.width, source.height)
  context2d(copy).drawImage(source, 0, 0)
  return copy
}

/** Copy one region of a canvas into a new canvas of that region's size. */
export function copyRegion(source: CanvasImageSource, rect: Rect) {
  const region = createCanvas(rect.width, rect.height)
  context2d(region).drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
  return region
}

/** Replace one region of a canvas with a patch of the same size. */
export function putRegion(target: HTMLCanvasElement, patch: HTMLCanvasElement, rect: Rect) {
  const context = context2d(target)
  context.save()
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
  context.clearRect(rect.x, rect.y, rect.width, rect.height)
  context.drawImage(patch, rect.x, rect.y)
  context.restore()
}

/** Snap a rect outward to whole pixels and clip it to the document. */
export function clampRect(rect: Rect, width: number, height: number): Rect | null {
  const left = Math.max(0, Math.floor(rect.x))
  const top = Math.max(0, Math.floor(rect.y))
  const right = Math.min(width, Math.ceil(rect.x + rect.width))
  const bottom = Math.min(height, Math.ceil(rect.y + rect.height))
  if (right <= left || bottom <= top) {
    return null
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

/** Normalize a rect dragged in any direction. */
export function normalizeRect(rect: Rect): Rect {
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  }
}

/** Rotate a canvas by a quarter turn (clockwise when `clockwise`). */
export function rotateCanvasQuarter(source: HTMLCanvasElement, clockwise: boolean) {
  const rotated = createCanvas(source.height, source.width)
  const context = context2d(rotated)
  context.translate(rotated.width / 2, rotated.height / 2)
  context.rotate((clockwise ? 1 : -1) * Math.PI / 2)
  context.drawImage(source, -source.width / 2, -source.height / 2)
  return rotated
}

export function flipCanvas(source: HTMLCanvasElement, axis: 'x' | 'y') {
  const flipped = createCanvas(source.width, source.height)
  const context = context2d(flipped)
  if (axis === 'x') {
    context.translate(source.width, 0)
    context.scale(-1, 1)
  } else {
    context.translate(0, source.height)
    context.scale(1, -1)
  }
  context.drawImage(source, 0, 0)
  return flipped
}

export function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load image'))
    image.src = source
  })
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode image'))), type, quality)
  })
}

export function canvasBytes(canvas: HTMLCanvasElement) {
  return canvas.width * canvas.height * 4
}
