import fs from 'fs'
import path from 'path'
import { type MarkedField } from '../types/workflow'
import { normalizeBase64ImageData } from '../utils/base64ImageData'
import { ComfyUIService } from './comfyuiService'
import { isQueueInputRef, resolveQueueInputFilePath } from './generation-queue/queueInputStore'
import {
  isWorkflowInputAssetRef,
  resolveWorkflowInputAssetFilePath,
} from './workflowInputAssetStore'

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

type ComfyMediaUploadInput = {
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

function getComfyMediaUploadInput(value: unknown): ComfyMediaUploadInput | null {
  if (!value) {
    return null
  }

  // PAYLOAD-3: an enqueue-time stored input. Resolving to a path also means the upload streams
  // from disk instead of holding a decoded multi-MB buffer in memory.
  if (isQueueInputRef(value)) {
    const storedPath = resolveQueueInputFilePath(value)
    if (!storedPath) {
      throw new Error(`Stored queue image input ${value.sha256} is no longer available on disk`)
    }

    return {
      fileName: value.fileName || `${value.sha256}.png`,
      filePath: storedPath,
      mimeType: value.mimeType,
    }
  }

  if (isWorkflowInputAssetRef(value)) {
    const storedPath = resolveWorkflowInputAssetFilePath(value)
    if (!storedPath) {
      throw new Error(`Workflow input asset ${value.id} is no longer available on disk`)
    }

    return {
      fileName: value.fileName,
      filePath: storedPath,
      mimeType: value.mimeType,
    }
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

const MINIMAX_H3_DIRECTOR_EDITOR = 'minimax_h3_director_dasiwa'
const MINIMAX_H3_DIRECTOR_META_KEY = '__conai_minimax_h3_director'

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isComfyInputLink(value: unknown) {
  return Array.isArray(value)
    && value.length >= 2
    && (typeof value[0] === 'string' || typeof value[0] === 'number')
    && typeof value[1] === 'number'
    && Number.isInteger(value[1])
}

function getMiniMaxDirectorActiveItems(mode: unknown, timeline: Record<string, any>) {
  const items = Array.isArray(timeline.items) ? timeline.items : []
  const ordered = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isRecord(item) && item.enabled !== false)
    .sort((left, right) => Number(left.item.order ?? left.index) - Number(right.item.order ?? right.index))

  return mode === 'FL2VA'
    ? ordered.filter(({ item }) => item.type === 'image').slice(0, 2).map(({ item }) => item)
    : ordered.map(({ item }) => item)
}

/** Upload Director draft assets and return plain MiniMax node inputs for workflow substitution. */
async function prepareMiniMaxDirectorNodeValue(
  comfyService: ComfyUIService,
  fieldId: string,
  value: unknown,
): Promise<unknown> {
  if (!isRecord(value)) {
    return value
  }

  const metadata = isRecord(value[MINIMAX_H3_DIRECTOR_META_KEY]) ? value[MINIMAX_H3_DIRECTOR_META_KEY] : null
  if (isComfyInputLink(value.timeline_data)) {
    const preparedValue = { ...value }
    delete preparedValue[MINIMAX_H3_DIRECTOR_META_KEY]
    return preparedValue
  }

  const assets = metadata && isRecord(metadata.assets) ? metadata.assets : {}
  let timeline: Record<string, any>
  try {
    const parsed = JSON.parse(typeof value.timeline_data === 'string' ? value.timeline_data : '{}')
    timeline = isRecord(parsed) ? parsed : { version: 1, items: [], prompt_blocks: [] }
  } catch {
    throw new Error(`MiniMax H3 Director field ${fieldId} has invalid timeline_data JSON`)
  }

  const nextItems = Array.isArray(timeline.items)
    ? timeline.items.map((item: unknown) => isRecord(item) ? { ...item } : item)
    : []
  const nextTimeline = { ...timeline, version: 1, items: nextItems }
  const activeItemIds = new Set(getMiniMaxDirectorActiveItems(value.mode, nextTimeline).map((item) => String(item.id ?? '')))

  for (const item of nextItems) {
    if (!isRecord(item) || !activeItemIds.has(String(item.id ?? ''))) {
      continue
    }

    const uploadInput = getComfyMediaUploadInput(assets[String(item.id ?? '')])
    if (!uploadInput) {
      continue
    }

    const uploadName = buildComfyImageUploadName(uploadInput.fileName, `${sanitizeUploadSegment(fieldId)}_${sanitizeUploadSegment(String(item.id ?? 'media'))}`)
    const fileStream = uploadInput.filePath ? fs.createReadStream(uploadInput.filePath) : null
    const mediaInput = fileStream ?? uploadInput.buffer
    if (!mediaInput) {
      continue
    }

    try {
      item.value = await comfyService.uploadInputImage(uploadName, mediaInput, { contentType: uploadInput.mimeType })
    } finally {
      fileStream?.destroy()
    }
  }

  const preparedValue: Record<string, any> = {
    ...value,
    timeline_data: JSON.stringify(nextTimeline),
  }
  delete preparedValue[MINIMAX_H3_DIRECTOR_META_KEY]
  return preparedValue
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
    if (field.type === 'node' && field.node_editor === MINIMAX_H3_DIRECTOR_EDITOR) {
      preparedPromptData[field.id] = await prepareMiniMaxDirectorNodeValue(comfyService, field.id, preparedPromptData[field.id])
      continue
    }

    if (field.type !== 'image') {
      continue
    }

    const uploadInput = getComfyMediaUploadInput(preparedPromptData[field.id])
    if (!uploadInput) {
      continue
    }

    const fallbackBase = options.uploadNameBase
      ? `${sanitizeUploadSegment(options.uploadNameBase)}_${sanitizeUploadSegment(field.id)}`
      : sanitizeUploadSegment(field.id)

    const uploadName = buildComfyImageUploadName(uploadInput.fileName, fallbackBase)
    // 업로드가 실패하면 소비되지 않은 스트림이 파일을 계속 열어 둬서,
    // Windows에서 해당 이미지 삭제가 EBUSY로 막힌다. 항상 닫는다.
    const fileStream = uploadInput.filePath ? fs.createReadStream(uploadInput.filePath) : null
    const imageInput = fileStream ?? uploadInput.buffer

    if (!imageInput) {
      continue
    }

    try {
      const uploadedName = await comfyService.uploadInputImage(uploadName, imageInput, { contentType: uploadInput.mimeType })
      preparedPromptData[field.id] = uploadedName
    } finally {
      fileStream?.destroy()
    }
  }

  return preparedPromptData
}
