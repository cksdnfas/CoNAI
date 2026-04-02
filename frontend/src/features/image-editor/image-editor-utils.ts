import type { ImageEditorCropRect, ImageEditorLayer, ImageEditorStroke } from './image-editor-types'

/** Create one lightweight random id for editor-owned records. */
export function createImageEditorId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

/** Load one HTMLImageElement from a data URL or browser URL. */
export function loadEditorImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load editor image'))
    image.src = source
  })
}

/** Calculate one fit-to-screen zoom for the current document and viewport sizes. */
export function calculateImageEditorFitZoom(documentWidth: number, documentHeight: number, viewportWidth: number, viewportHeight: number) {
  if (documentWidth <= 0 || documentHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return 1
  }

  return Math.min((viewportWidth * 0.78) / documentWidth, (viewportHeight * 0.78) / documentHeight)
}

/** Normalize one crop rectangle so width and height are always positive. */
export function normalizeImageEditorRect(rect: ImageEditorCropRect): ImageEditorCropRect {
  const normalizedX = rect.width >= 0 ? rect.x : rect.x + rect.width
  const normalizedY = rect.height >= 0 ? rect.y : rect.y + rect.height
  const normalizedWidth = Math.abs(rect.width)
  const normalizedHeight = Math.abs(rect.height)

  return {
    x: normalizedX,
    y: normalizedY,
    width: normalizedWidth,
    height: normalizedHeight,
  }
}

/** Clamp one crop rectangle into the current document bounds. */
export function clampImageEditorRect(rect: ImageEditorCropRect, documentWidth: number, documentHeight: number): ImageEditorCropRect {
  const normalized = normalizeImageEditorRect(rect)
  const x = Math.max(0, Math.min(normalized.x, documentWidth))
  const y = Math.max(0, Math.min(normalized.y, documentHeight))
  const right = Math.max(x, Math.min(normalized.x + normalized.width, documentWidth))
  const bottom = Math.max(y, Math.min(normalized.y + normalized.height, documentHeight))

  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  }
}

/** Render one stroke list into the current 2D context. */
function drawImageEditorStrokes(context: CanvasRenderingContext2D, strokes: ImageEditorStroke[]) {
  for (const stroke of strokes) {
    if (stroke.points.length < 2) {
      continue
    }

    context.save()
    context.beginPath()
    context.strokeStyle = stroke.color
    context.lineWidth = stroke.strokeWidth
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over'
    context.moveTo(stroke.points[0] ?? 0, stroke.points[1] ?? 0)

    for (let index = 2; index < stroke.points.length; index += 2) {
      context.lineTo(stroke.points[index] ?? 0, stroke.points[index + 1] ?? 0)
    }

    context.stroke()
    context.restore()
  }
}

/** Render one transparent layer composition canvas from the provided editor layer list. */
export async function renderImageEditorLayerCanvas(options: {
  documentWidth: number
  documentHeight: number
  layers: ImageEditorLayer[]
}) {
  const { documentWidth, documentHeight, layers } = options
  const canvas = document.createElement('canvas')
  canvas.width = documentWidth
  canvas.height = documentHeight
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Failed to create layer render context')
  }

  for (const layer of layers) {
    if (!layer.visible) {
      continue
    }

    if (layer.type === 'draw') {
      drawImageEditorStrokes(context, layer.lines)
      continue
    }

    const pasteImage = await loadEditorImage(layer.imageDataUrl)
    context.drawImage(pasteImage, layer.x, layer.y, layer.width, layer.height)
  }

  return canvas
}

/** Render one unrotated source composition canvas from the current editor state. */
export async function renderImageEditorSourceCanvas(options: {
  baseImage: HTMLImageElement
  documentWidth: number
  documentHeight: number
  layers: ImageEditorLayer[]
}) {
  const { baseImage, documentWidth, documentHeight, layers } = options
  const canvas = await renderImageEditorLayerCanvas({
    documentWidth,
    documentHeight,
    layers,
  })
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Failed to create source render context')
  }

  const composedCanvas = document.createElement('canvas')
  composedCanvas.width = documentWidth
  composedCanvas.height = documentHeight
  const composedContext = composedCanvas.getContext('2d')

  if (!composedContext) {
    throw new Error('Failed to create source composition context')
  }

  composedContext.drawImage(baseImage, 0, 0, documentWidth, documentHeight)
  composedContext.drawImage(canvas, 0, 0)
  return composedCanvas
}

/** Render one unrotated black-and-white mask canvas from the current editor state. */
export async function renderImageEditorMaskCanvas(options: {
  initialMaskImage?: HTMLImageElement | null
  documentWidth: number
  documentHeight: number
  maskStrokes: ImageEditorStroke[]
}) {
  const { initialMaskImage, documentWidth, documentHeight, maskStrokes } = options
  const canvas = document.createElement('canvas')
  canvas.width = documentWidth
  canvas.height = documentHeight
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Failed to create mask render context')
  }

  context.fillStyle = '#000000'
  context.fillRect(0, 0, documentWidth, documentHeight)

  if (initialMaskImage) {
    context.drawImage(initialMaskImage, 0, 0, documentWidth, documentHeight)
  }

  drawImageEditorStrokes(context, maskStrokes)
  return canvas
}

/** Apply one rotation and horizontal flip to the provided canvas content. */
export function transformImageEditorCanvas(sourceCanvas: HTMLCanvasElement, rotation: number, flippedX: boolean) {
  const normalizedRotation = ((rotation % 360) + 360) % 360
  const swapDimensions = normalizedRotation === 90 || normalizedRotation === 270
  const outputWidth = swapDimensions ? sourceCanvas.height : sourceCanvas.width
  const outputHeight = swapDimensions ? sourceCanvas.width : sourceCanvas.height
  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = outputWidth
  outputCanvas.height = outputHeight
  const context = outputCanvas.getContext('2d')

  if (!context) {
    throw new Error('Failed to create transformed render context')
  }

  context.translate(outputWidth / 2, outputHeight / 2)
  context.rotate((normalizedRotation * Math.PI) / 180)
  if (flippedX) {
    context.scale(-1, 1)
  }
  context.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2)

  return outputCanvas
}

/** Build one red preview overlay data URL from a black-and-white mask source. */
export async function createImageEditorMaskPreviewDataUrl(maskDataUrl: string) {
  const image = await loadEditorImage(maskDataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Failed to create mask preview context')
  }

  context.drawImage(image, 0, 0)
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)

  for (let index = 0; index < imageData.data.length; index += 4) {
    const strength = imageData.data[index] ?? 0
    imageData.data[index] = 255
    imageData.data[index + 1] = 68
    imageData.data[index + 2] = 68
    imageData.data[index + 3] = Math.round((strength / 255) * 150)
  }

  context.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}
