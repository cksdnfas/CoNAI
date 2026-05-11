type PixelPreviewPaletteColor = { r: number; g: number; b: number }

export type PixelPreviewMode = 'off' | 'soft' | 'medium' | 'strong' | 'custom'

export type PixelPreviewSettings = {
  targetLongEdge: number
  colorCount: number
  ditherStrength: number
  edgeBoost: number
  sharpness: number
  smoothing: boolean
}

export type PixelPreviewProfile = PixelPreviewSettings & {
  label: string
  smoothing: boolean
  preFilter: string
}

const IMAGE_PIXEL_PREVIEW_MODE_STORAGE_KEY = 'conai:image-detail-media:pixel-preview-enabled'
const IMAGE_PIXEL_PREVIEW_LAST_ACTIVE_MODE_STORAGE_KEY = 'conai:image-detail-media:last-active-pixel-preview-mode'
const IMAGE_PIXEL_PREVIEW_SETTINGS_STORAGE_KEY = 'conai:image-detail-media:pixel-preview-settings'

const PIXEL_PREVIEW_MODE_LABELS: Record<PixelPreviewMode, string> = {
  off: '꺼짐',
  soft: '약',
  medium: '중',
  strong: '강',
  custom: '수동',
}

export const IMAGE_PIXEL_PREVIEW_PRESETS: Record<Exclude<PixelPreviewMode, 'off' | 'custom'>, PixelPreviewSettings> = {
  soft: { targetLongEdge: 512, colorCount: 192, ditherStrength: 0.08, edgeBoost: 0.04, sharpness: 0.08, smoothing: true },
  medium: { targetLongEdge: 384, colorCount: 128, ditherStrength: 0.14, edgeBoost: 0.07, sharpness: 0.14, smoothing: true },
  strong: { targetLongEdge: 256, colorCount: 96, ditherStrength: 0.22, edgeBoost: 0.1, sharpness: 0.2, smoothing: false },
}

export const DEFAULT_PIXEL_PREVIEW_SETTINGS: PixelPreviewSettings = IMAGE_PIXEL_PREVIEW_PRESETS.soft

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function loadImagePixelPreviewMode(): PixelPreviewMode {
  if (typeof window === 'undefined') {
    return 'off'
  }

  const savedValue = window.localStorage.getItem(IMAGE_PIXEL_PREVIEW_MODE_STORAGE_KEY)
  if (savedValue === 'soft' || savedValue === 'medium' || savedValue === 'strong' || savedValue === 'custom' || savedValue === 'off') {
    return savedValue
  }

  // Migrate the old boolean toggle into the least destructive preview mode.
  return savedValue === 'true' ? 'soft' : 'off'
}

export function loadLastActiveImagePixelPreviewMode(): Exclude<PixelPreviewMode, 'off'> {
  if (typeof window === 'undefined') {
    return 'soft'
  }

  const savedValue = window.localStorage.getItem(IMAGE_PIXEL_PREVIEW_LAST_ACTIVE_MODE_STORAGE_KEY)
  return savedValue === 'soft' || savedValue === 'medium' || savedValue === 'strong' || savedValue === 'custom' ? savedValue : 'soft'
}

export function persistImagePixelPreviewMode(mode: PixelPreviewMode) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(IMAGE_PIXEL_PREVIEW_MODE_STORAGE_KEY, mode)
  if (mode !== 'off') {
    window.localStorage.setItem(IMAGE_PIXEL_PREVIEW_LAST_ACTIVE_MODE_STORAGE_KEY, mode)
  }
}

function normalizePixelPreviewResolution(value: unknown) {
  const parsedValue = Number(value) || DEFAULT_PIXEL_PREVIEW_SETTINGS.targetLongEdge
  return Math.round(clamp(parsedValue, 64, 1024) / 64) * 64
}

export function normalizePixelPreviewSettings(settings: Partial<PixelPreviewSettings>): PixelPreviewSettings {
  return {
    targetLongEdge: normalizePixelPreviewResolution(settings.targetLongEdge),
    colorCount: Math.round(clamp(Number(settings.colorCount) || DEFAULT_PIXEL_PREVIEW_SETTINGS.colorCount, 32, 256)),
    ditherStrength: clamp(Number(settings.ditherStrength) || 0, 0, 0.6),
    edgeBoost: clamp(Number(settings.edgeBoost) || 0, 0, 0.24),
    sharpness: clamp(Number(settings.sharpness) || 0, 0, 0.5),
    smoothing: typeof settings.smoothing === 'boolean' ? settings.smoothing : DEFAULT_PIXEL_PREVIEW_SETTINGS.smoothing,
  }
}

export function loadImagePixelPreviewSettings(): PixelPreviewSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_PIXEL_PREVIEW_SETTINGS
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(IMAGE_PIXEL_PREVIEW_SETTINGS_STORAGE_KEY) || 'null') as Partial<PixelPreviewSettings> | null
    return normalizePixelPreviewSettings(parsed ?? DEFAULT_PIXEL_PREVIEW_SETTINGS)
  } catch {
    return DEFAULT_PIXEL_PREVIEW_SETTINGS
  }
}

export function persistImagePixelPreviewSettings(settings: PixelPreviewSettings) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(IMAGE_PIXEL_PREVIEW_SETTINGS_STORAGE_KEY, JSON.stringify(normalizePixelPreviewSettings(settings)))
}

export function getPixelPreviewProfile(mode: PixelPreviewMode, customSettings: PixelPreviewSettings): PixelPreviewProfile | null {
  if (mode === 'off') {
    return null
  }

  const settings = mode === 'custom' ? customSettings : IMAGE_PIXEL_PREVIEW_PRESETS[mode]
  const contrast = 1 + settings.edgeBoost * 0.18 + settings.sharpness * 0.03
  return {
    ...settings,
    label: PIXEL_PREVIEW_MODE_LABELS[mode],
    smoothing: settings.smoothing,
    preFilter: `contrast(${contrast.toFixed(3)})`,
  }
}

function getPixelLuminance(data: Uint8ClampedArray, index: number) {
  return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
}

function applyLuminanceScale(data: Uint8ClampedArray, index: number, currentLuminance: number, targetLuminance: number, minScale = 0.75, maxScale = 1.25) {
  const scale = clamp(targetLuminance / Math.max(1, currentLuminance), minScale, maxScale)
  data[index] = Math.round(clamp(data[index] * scale, 0, 255))
  data[index + 1] = Math.round(clamp(data[index + 1] * scale, 0, 255))
  data[index + 2] = Math.round(clamp(data[index + 2] * scale, 0, 255))
}

function getClosestPaletteColor(red: number, green: number, blue: number, palette: PixelPreviewPaletteColor[]) {
  let closest = palette[0] ?? { r: red, g: green, b: blue }
  let closestDistance = Number.POSITIVE_INFINITY

  for (const color of palette) {
    const redDistance = red - color.r
    const greenDistance = green - color.g
    const blueDistance = blue - color.b
    const distance = redDistance * redDistance * 0.2126 + greenDistance * greenDistance * 0.7152 + blueDistance * blueDistance * 0.0722
    if (distance < closestDistance) {
      closest = color
      closestDistance = distance
    }
  }

  return closest
}

export function applyImageToPixelStylePalette(imageData: ImageData, palette: PixelPreviewPaletteColor[], strength: number) {
  if (palette.length === 0) {
    return imageData
  }

  const { data, width, height } = imageData
  const source = new Uint8ClampedArray(data)
  const bayer4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ]
  const thresholdScale = strength * 64

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const threshold = (((bayer4[y % 4]?.[x % 4] ?? 0) + 0.5) / 16 - 0.5) * thresholdScale
      const closest = getClosestPaletteColor(
        clamp(source[index] + threshold, 0, 255),
        clamp(source[index + 1] + threshold, 0, 255),
        clamp(source[index + 2] + threshold, 0, 255),
        palette,
      )
      data[index] = closest.r
      data[index + 1] = closest.g
      data[index + 2] = closest.b
    }
  }

  return imageData
}

export function boostPixelPreviewEdges(imageData: ImageData, strength: number) {
  if (strength <= 0) {
    return imageData
  }

  const { data, width, height } = imageData
  const original = new Uint8ClampedArray(data)
  const threshold = 28

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4
      const center = getPixelLuminance(original, index)
      const left = getPixelLuminance(original, index - 4)
      const right = getPixelLuminance(original, index + 4)
      const up = getPixelLuminance(original, index - width * 4)
      const down = getPixelLuminance(original, index + width * 4)
      const brightestNeighbor = Math.max(left, right, up, down)
      const gradient = brightestNeighbor - center

      if (gradient <= threshold) {
        continue
      }

      const targetLuminance = center * Math.max(0.82, 1 - strength * Math.min(1.25, gradient / 128))
      applyLuminanceScale(data, index, center, targetLuminance, 0.82, 1)
    }
  }

  return imageData
}

export function sharpenPixelPreview(imageData: ImageData, amount: number) {
  if (amount <= 0) {
    return imageData
  }

  const { data, width, height } = imageData
  const original = new Uint8ClampedArray(data)
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4
      const center = getPixelLuminance(original, index)
      const neighborAverage =
        (getPixelLuminance(original, index - 4) +
          getPixelLuminance(original, index + 4) +
          getPixelLuminance(original, index - width * 4) +
          getPixelLuminance(original, index + width * 4)) /
        4
      const targetLuminance = clamp(center + (center - neighborAverage) * amount, 0, 255)
      applyLuminanceScale(data, index, center, targetLuminance, 0.86, 1.16)
    }
  }

  return imageData
}
