import path from 'path'
import { type MarkedField } from '../types/workflow'
import { ComfyUIService } from './comfyuiService'

interface WorkflowImageFieldPayload {
  fileName?: string
  dataUrl?: string
}

function normalizeBase64ImageData(value?: string) {
  if (!value || typeof value !== 'string') {
    return undefined
  }

  return value.replace(/^data:image\/\w+;base64,/, '')
}

function sanitizeUploadSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_') || 'image'
}

function buildComfyImageUploadName(fileName: string | undefined, fallbackBase: string) {
  const sourceName = (fileName || `${fallbackBase}.png`).trim()
  const ext = path.extname(sourceName) || '.png'
  const baseName = path.basename(sourceName, ext).replace(/[^a-zA-Z0-9_-]/g, '_') || fallbackBase
  return `${baseName}_${Date.now()}${ext}`
}

function getComfyImageUploadInput(value: unknown) {
  if (!value) {
    return null
  }

  if (typeof value === 'object') {
    const payload = value as WorkflowImageFieldPayload
    if (typeof payload.dataUrl !== 'string' || payload.dataUrl.trim().length === 0) {
      return null
    }

    const base64 = normalizeBase64ImageData(payload.dataUrl)
    if (!base64) {
      return null
    }

    return {
      fileName: payload.fileName,
      buffer: Buffer.from(base64, 'base64'),
    }
  }

  if (typeof value === 'string') {
    const base64 = normalizeBase64ImageData(value)
    if (!base64) {
      return null
    }

    return {
      fileName: undefined,
      buffer: Buffer.from(base64, 'base64'),
    }
  }

  return null
}

/** Upload image-marked prompt fields to ComfyUI and replace them with stored input filenames. */
export async function prepareComfyPromptData(
  comfyService: ComfyUIService,
  markedFields: MarkedField[],
  promptData: Record<string, any>,
  options: { uploadNameBase?: string } = {},
): Promise<Record<string, any>> {
  const preparedPromptData = { ...promptData }

  for (const field of markedFields) {
    if (field.type !== 'image') {
      continue
    }

    const uploadInput = getComfyImageUploadInput(preparedPromptData[field.id])
    if (!uploadInput) {
      continue
    }

    const fallbackBase = options.uploadNameBase
      ? `${sanitizeUploadSegment(options.uploadNameBase)}_${sanitizeUploadSegment(field.id)}`
      : sanitizeUploadSegment(field.id)

    const uploadName = buildComfyImageUploadName(uploadInput.fileName, fallbackBase)
    const uploadedName = await comfyService.uploadInputImage(uploadName, uploadInput.buffer)
    preparedPromptData[field.id] = uploadedName
  }

  return preparedPromptData
}
