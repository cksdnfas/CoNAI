import { createPixelPreviewWorkerTask } from './image-detail-pixel-preview-worker-client'
import {
  boostPixelPreviewEdges,
  getPixelPreviewProfile,
  loadImagePixelPreviewMode,
  loadImagePixelPreviewSettings,
  sharpenPixelPreview,
  type PixelPreviewProfile,
} from './image-detail-pixel-preview-utils'

export function getActivePixelPreviewProfile() {
  return getPixelPreviewProfile(loadImagePixelPreviewMode(), loadImagePixelPreviewSettings())
}

function loadSourceImage(sourceUrl: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const sourceImage = new Image()
    const cleanup = () => {
      sourceImage.onload = null
      sourceImage.onerror = null
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      cleanup()
      sourceImage.removeAttribute('src')
      reject(new DOMException('Aborted', 'AbortError'))
    }
    sourceImage.onload = () => { cleanup(); resolve(sourceImage) }
    sourceImage.onerror = () => { cleanup(); sourceImage.removeAttribute('src'); reject(new Error('Image failed to load.')) }
    signal?.addEventListener('abort', abort, { once: true })
    sourceImage.decoding = 'async'
    sourceImage.src = sourceUrl
  })
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Filtered image export failed.'))
    }, 'image/png')
  })
}

/** Screen preview and PNG export share the same bounded sample, worker and fallback processing. */
export async function renderPixelPreviewSample(sourceUrl: string, profile: PixelPreviewProfile, signal?: AbortSignal) {
  const sourceImage = await loadSourceImage(sourceUrl, signal)
  const sampleCanvas = document.createElement('canvas')
  try {
    signal?.throwIfAborted()
    const sourceWidth = sourceImage.naturalWidth || sourceImage.width
    const sourceHeight = sourceImage.naturalHeight || sourceImage.height
    if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error('Image has invalid dimensions.')

    const targetScale = Math.min(1, profile.targetLongEdge / Math.max(sourceWidth, sourceHeight))
    const pixelWidth = Math.max(1, Math.round(sourceWidth * targetScale))
    const pixelHeight = Math.max(1, Math.round(sourceHeight * targetScale))
    sampleCanvas.width = pixelWidth
    sampleCanvas.height = pixelHeight
    const sampleContext = sampleCanvas.getContext('2d')
    if (!sampleContext) throw new Error('Canvas context is unavailable.')

    sampleContext.imageSmoothingEnabled = profile.smoothing
    if (profile.smoothing) sampleContext.imageSmoothingQuality = 'high'
    sampleContext.filter = profile.preFilter
    sampleContext.drawImage(sourceImage, 0, 0, pixelWidth, pixelHeight)
    sourceImage.removeAttribute('src')
    try {
      const sourceImageData = sampleContext.getImageData(0, 0, pixelWidth, pixelHeight)
      const result = await createPixelPreviewWorkerTask(sourceImageData, profile, signal).promise
      signal?.throwIfAborted()
      if (result.warning) console.warn('Pixel preview palette fallback:', result.warning)
      sampleContext.putImageData(result.imageData, 0, 0)
    } catch (error) {
      signal?.throwIfAborted()
      const fallbackImageData = sampleContext.getImageData(0, 0, pixelWidth, pixelHeight)
      sampleContext.putImageData(sharpenPixelPreview(boostPixelPreviewEdges(fallbackImageData, profile.edgeBoost), profile.sharpness), 0, 0)
      console.warn('Failed to run pixel preview worker; falling back to plain pixel sampling.', error)
    }
    return { canvas: sampleCanvas, sourceWidth, sourceHeight }
  } catch (error) {
    sampleCanvas.width = sampleCanvas.height = 0
    throw error
  } finally {
    sourceImage.removeAttribute('src')
  }
}

/** Only downloaded images need an original-sized output bitmap. */
export async function renderPixelPreviewCanvas(sourceUrl: string, profile: PixelPreviewProfile) {
  const sample = await renderPixelPreviewSample(sourceUrl, profile)
  const canvas = document.createElement('canvas')
  try {
    canvas.width = sample.sourceWidth
    canvas.height = sample.sourceHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas context is unavailable.')
    context.imageSmoothingEnabled = false
    context.drawImage(sample.canvas, 0, 0, sample.canvas.width, sample.canvas.height, 0, 0, canvas.width, canvas.height)
    return canvas
  } catch (error) {
    canvas.width = canvas.height = 0
    throw error
  } finally {
    sample.canvas.width = sample.canvas.height = 0
  }
}

export async function renderPixelPreviewPngBlob(sourceUrl: string, profile: PixelPreviewProfile) {
  const canvas = await renderPixelPreviewCanvas(sourceUrl, profile)
  try {
    return await canvasToPngBlob(canvas)
  } finally {
    canvas.width = canvas.height = 0
  }
}
