import fs from 'fs'
import path from 'path'
import { type MarkedField } from '../types/workflow'
import { normalizeBase64ImageData } from '../utils/base64ImageData'
import { ComfyUIService } from './comfyuiService'

interface WorkflowImageFieldPayload {
  fileName?: string
  dataUrl?: string
  storagePath?: string
  originalPath?: string
  original_file_path?: string
  filePath?: string
  path?: string
  mimeType?: string
}

type ComfyImageUploadInput = {
  fileName?: string
  buffer?: Buffer
  filePath?: string
  mimeType?: string
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

function normalizeImagePayloadPath(payload: WorkflowImageFieldPayload) {
  const candidate = payload.storagePath
    ?? payload.originalPath
    ?? payload.original_file_path
    ?? payload.filePath
    ?? payload.path

  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    return null
  }

  return candidate
}

function getComfyImageUploadInput(value: unknown): ComfyImageUploadInput | null {
  if (!value) {
    return null
  }

  if (typeof value === 'object') {
    const payload = value as WorkflowImageFieldPayload
    const filePath = normalizeImagePayloadPath(payload)
    if (filePath) {
      return {
        fileName: payload.fileName || path.basename(filePath),
        filePath,
        mimeType: payload.mimeType,
      }
    }

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
      mimeType: payload.mimeType,
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
    const imageInput = uploadInput.filePath
      ? fs.createReadStream(uploadInput.filePath)
      : uploadInput.buffer

    if (!imageInput) {
      continue
    }

    const uploadedName = await comfyService.uploadInputImage(uploadName, imageInput, { contentType: uploadInput.mimeType })
    preparedPromptData[field.id] = uploadedName
  }

  return preparedPromptData
}
