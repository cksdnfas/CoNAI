import { createPixelPreviewWorkerTask } from './image-detail-pixel-preview-worker-client'

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

const PIXEL_PREVIEW_MODE_LABELS: Record<PixelPreviewMode, string> = {
  off: 'off',
  soft: 'soft',
  medium: 'medium',
  strong: 'strong',
  custom: 'custom',
}
const IMAGE_PIXEL_PREVIEW_PRESETS: Record<Exclude<PixelPreviewMode, 'off' | 'custom'>, PixelPreviewSettings> = {
  soft: { targetLongEdge: 512, colorCount: 192, ditherStrength: 0.08, edgeBoost: 0.04, sharpness: 0.08, smoothing: true },
  medium: { targetLongEdge: 384, colorCount: 128, ditherStrength: 0.14, edgeBoost: 0.07, sharpness: 0.14, smoothing: true },
  strong: { targetLongEdge: 256, colorCount: 96, ditherStrength: 0.22, edgeBoost: 0.1, sharpness: 0.2, smoothing: false },
}
const DEFAULT_PIXEL_PREVIEW_SETTINGS: PixelPreviewSettings = IMAGE_PIXEL_PREVIEW_PRESETS.soft

const IMAGE_PIXEL_PREVIEW_MODE_STORAGE_KEY = 'conai:image-detail-media:pixel-preview-enabled'
const IMAGE_PIXEL_PREVIEW_SETTINGS_STORAGE_KEY = 'conai:image-detail-media:pixel-preview-settings'

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
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

export function loadImagePixelPreviewMode(): PixelPreviewMode {
  if (typeof window === 'undefined') {
    return 'off'
  }

  const savedValue = window.localStorage.getItem(IMAGE_PIXEL_PREVIEW_MODE_STORAGE_KEY)
  if (savedValue === 'soft' || savedValue === 'medium' || savedValue === 'strong' || savedValue === 'custom' || savedValue === 'off') {
    return savedValue
  }

  return savedValue === 'true' ? 'soft' : 'off'
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

export function getActivePixelPreviewProfile() {
  return getPixelPreviewProfile(loadImagePixelPreviewMode(), loadImagePixelPreviewSettings())
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

function boostPixelPreviewEdges(imageData: ImageData, strength: number) {
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

function sharpenPixelPreview(imageData: ImageData, amount: number) {
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

function loadSourceImage(sourceUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const sourceImage = new Image()
    sourceImage.onload = () => resolve(sourceImage)
    sourceImage.onerror = () => reject(new Error('Image failed to load.'))
    sourceImage.src = sourceUrl
  })
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }
      reject(new Error('Filtered image export failed.'))
    }, 'image/png')
  })
}

export async function renderPixelPreviewCanvas(sourceUrl: string, profile: PixelPreviewProfile) {
  const sourceImage = await loadSourceImage(sourceUrl)
  const sourceWidth = sourceImage.naturalWidth || sourceImage.width
  const sourceHeight = sourceImage.naturalHeight || sourceImage.height
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Image has invalid dimensions.')
  }

  const targetScale = Math.min(1, profile.targetLongEdge / Math.max(sourceWidth, sourceHeight))
  const pixelWidth = Math.max(1, Math.round(sourceWidth * targetScale))
  const pixelHeight = Math.max(1, Math.round(sourceHeight * targetScale))
  const sampleCanvas = document.createElement('canvas')
  sampleCanvas.width = pixelWidth
  sampleCanvas.height = pixelHeight

  const sampleContext = sampleCanvas.getContext('2d')
  if (!sampleContext) {
    throw new Error('Canvas context is unavailable.')
  }

  sampleContext.imageSmoothingEnabled = profile.smoothing
  if (profile.smoothing) {
    sampleContext.imageSmoothingQuality = 'high'
  }
  sampleContext.filter = profile.preFilter
  sampleContext.clearRect(0, 0, pixelWidth, pixelHeight)
  sampleContext.drawImage(sourceImage, 0, 0, pixelWidth, pixelHeight)

  try {
    const sourceImageData = sampleContext.getImageData(0, 0, pixelWidth, pixelHeight)
    const result = await createPixelPreviewWorkerTask(sourceImageData, profile).promise
    if (result.warning) {
      console.warn('Failed to apply image-q pixel preview during export; falling back to plain pixel sampling.', result.warning)
    }
    sampleContext.putImageData(result.imageData, 0, 0)
  } catch (error) {
    const fallbackImageData = sampleContext.getImageData(0, 0, pixelWidth, pixelHeight)
    sampleContext.putImageData(sharpenPixelPreview(boostPixelPreviewEdges(fallbackImageData, profile.edgeBoost), profile.sharpness), 0, 0)
    console.warn('Failed to run pixel preview worker during export; falling back to plain pixel sampling.', error)
  }

  const canvas = document.createElement('canvas')
  canvas.width = sourceWidth
  canvas.height = sourceHeight
  const canvasContext = canvas.getContext('2d')
  if (!canvasContext) {
    throw new Error('Canvas context is unavailable.')
  }

  canvasContext.imageSmoothingEnabled = false
  canvasContext.clearRect(0, 0, sourceWidth, sourceHeight)
  canvasContext.drawImage(sampleCanvas, 0, 0, pixelWidth, pixelHeight, 0, 0, sourceWidth, sourceHeight)
  return canvas
}

export async function renderPixelPreviewPngBlob(sourceUrl: string, profile: PixelPreviewProfile) {
  return canvasToPngBlob(await renderPixelPreviewCanvas(sourceUrl, profile))
}
