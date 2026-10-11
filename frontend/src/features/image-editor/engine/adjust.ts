import { context2d, createCanvas, type Rect } from './raster'

/** Colour adjustments; sliders run −100…100 (hue −180…180°), 0 = unchanged. */
export type Adjustments = {
  brightness: number
  contrast: number
  saturation: number
  hue: number
  temperature: number
  grayscale: boolean
  invert: boolean
}

export const NEUTRAL_ADJUSTMENTS: Adjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  temperature: 0,
  grayscale: false,
  invert: false,
}

export function isNeutralAdjustment(value: Adjustments) {
  return (
    value.brightness === 0 &&
    value.contrast === 0 &&
    value.saturation === 0 &&
    value.hue === 0 &&
    value.temperature === 0 &&
    !value.grayscale &&
    !value.invert
  )
}

/** Canvas filter string for everything but temperature. */
function filterFor(value: Adjustments) {
  const parts = [
    `brightness(${1 + value.brightness / 100})`,
    `contrast(${1 + value.contrast / 100})`,
    `saturate(${1 + value.saturation / 100})`,
  ]
  if (value.hue) parts.push(`hue-rotate(${value.hue}deg)`)
  if (value.grayscale) parts.push('grayscale(1)')
  if (value.invert) parts.push('invert(1)')
  return parts.join(' ')
}

/**
 * Write `source` with the adjustments into `target`, inside `rect` (and `clip`, when given).
 * Pixels of `target` outside the clip are left as they are; transparency is kept.
 */
export function renderAdjusted(source: HTMLCanvasElement, target: HTMLCanvasElement, rect: Rect, value: Adjustments, clip: Path2D | null) {
  const work = createCanvas(rect.width, rect.height)
  const workContext = context2d(work)
  workContext.filter = filterFor(value)
  workContext.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
  workContext.filter = 'none'

  if (value.temperature) {
    // Warm = orange, cool = blue, laid over with soft light, then the source alpha put back.
    workContext.globalCompositeOperation = 'soft-light'
    workContext.globalAlpha = (Math.abs(value.temperature) / 100) * 0.6
    workContext.fillStyle = value.temperature > 0 ? '#ff8c1a' : '#1a7cff'
    workContext.fillRect(0, 0, rect.width, rect.height)
    workContext.globalAlpha = 1
    workContext.globalCompositeOperation = 'destination-in'
    workContext.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
    workContext.globalCompositeOperation = 'source-over'
  }

  const context = context2d(target)
  context.save()
  if (clip) context.clip(clip)
  context.clearRect(rect.x, rect.y, rect.width, rect.height)
  context.drawImage(work, rect.x, rect.y)
  context.restore()
}
