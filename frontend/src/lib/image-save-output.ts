import type { ImageSaveFormat, ImageSaveSettings } from '@/types/settings'

export const DEFAULT_IMAGE_SAVE_SETTINGS: ImageSaveSettings = {
  defaultFormat: 'webp',
  quality: 85,
  resizeEnabled: true,
  maxWidth: 1536,
  maxHeight: 1536,
  alwaysShowDialog: true,
  applyToGenerationAttachments: true,
  applyToEditorSave: true,
  applyToCanvasSave: true,
  applyToUpload: true,
}

export type ImageSaveOutputInput = {
  source: Blob | string
  sourceMimeType?: string | null
}

export type ImageSaveOutputOptions = Pick<
  ImageSaveSettings,
  'defaultFormat' | 'quality' | 'resizeEnabled' | 'maxWidth' | 'maxHeight'
>

export type ResolvedImageSaveFormat = Exclude<ImageSaveFormat, 'original'> | 'png'

export type ImageSaveOutputResult = {
  blob: Blob
  dataUrl: string
  width: number
  height: number
  mimeType: string
  format: ResolvedImageSaveFormat
}

export type ImageSaveSourceInfo = {
  width: number
  height: number
  mimeType: string | null
  fileSize: number | null
}

/** Return true when one file should bypass image-save processing and stay original. */
export function shouldBypassImageSaveProcessing(file: Pick<File, 'type' | 'name'>) {
  const mimeType = file.type.toLowerCase()
  const lowerName = file.name.toLowerCase()

  if (mimeType.startsWith('video/')) {
    return true
  }

  if (mimeType === 'image/gif') {
    return true
  }

  return lowerName.endsWith('.gif') || lowerName.endsWith('.apng')
}

/** Read one Blob into a data URL for downstream image draft state. */
function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob as data URL'))
    reader.readAsDataURL(blob)
  })
}

/** Load one browser image element from either a Blob or a data URL source. */
async function loadImageElement(input: ImageSaveOutputInput) {
  const objectUrl = typeof input.source === 'string' ? null : URL.createObjectURL(input.source)
  const src = typeof input.source === 'string' ? input.source : objectUrl!

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('Failed to load image source'))
      element.src = src
    })

    return image
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
    }
  }
}

/** Resolve one save format using the requested format and source mime type. */
export function resolveImageSaveFormat(format: ImageSaveFormat, sourceMimeType?: string | null): ResolvedImageSaveFormat {
  if (format !== 'original') {
    return format
  }

  if (sourceMimeType === 'image/jpeg') {
    return 'jpeg'
  }

  if (sourceMimeType === 'image/webp') {
    return 'webp'
  }

  return 'png'
}

/** Calculate the next bounded size while preserving aspect ratio. */
export function calculateImageSaveOutputSize(
  width: number,
  height: number,
  options: Pick<ImageSaveOutputOptions, 'resizeEnabled' | 'maxWidth' | 'maxHeight'>,
) {
  if (!options.resizeEnabled) {
    return { width, height }
  }

  const safeMaxWidth = Math.max(1, options.maxWidth)
  const safeMaxHeight = Math.max(1, options.maxHeight)
  const scale = Math.min(1, safeMaxWidth / width, safeMaxHeight / height)

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Convert one image source using the shared format, quality, and resize options. */
/** Load the basic image metadata used by the save-options dialog. */
export async function loadImageSaveSourceInfo(input: ImageSaveOutputInput): Promise<ImageSaveSourceInfo> {
  const image = await loadImageElement(input)
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    mimeType: input.sourceMimeType ?? (typeof input.source === 'string' ? null : input.source.type || null),
    fileSize: typeof input.source === 'string' ? null : input.source.size,
  }
}

/** Build one output file name that matches the resolved save format. */
export function buildImageSaveOutputFileName(fileName: string, format: ResolvedImageSaveFormat) {
  const nextBase = fileName.replace(/\.[^.]+$/, '')
  return `${nextBase}.${format === 'jpeg' ? 'jpg' : format}`
}

export async function buildImageSaveOutput(
  input: ImageSaveOutputInput,
  options: ImageSaveOutputOptions,
): Promise<ImageSaveOutputResult> {
  const image = await loadImageElement(input)
  const targetSize = calculateImageSaveOutputSize(image.naturalWidth, image.naturalHeight, options)
  const format = resolveImageSaveFormat(options.defaultFormat, input.sourceMimeType)
  const mimeType = format === 'png' ? 'image/png' : `image/${format}`

  const canvas = document.createElement('canvas')
  canvas.width = targetSize.width
  canvas.height = targetSize.height

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Failed to create image output canvas')
  }

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob>((resolve, reject) => {
    const quality = mimeType === 'image/png' ? undefined : Math.max(0.01, Math.min(1, options.quality / 100))
    canvas.toBlob((value) => {
      if (!value) {
        reject(new Error('Failed to encode image output'))
        return
      }

      resolve(value)
    }, mimeType, quality)
  })

  return {
    blob,
    dataUrl: await readBlobAsDataUrl(blob),
    width: canvas.width,
    height: canvas.height,
    mimeType,
    format,
  }
}
