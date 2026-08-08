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
const MINIMAX_H3_DIRECTOR_MODES = new Set(['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF2VA'])

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

function parseMiniMaxBuilderState(value: unknown) {
  if (isRecord(value)) return value
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function createMiniMaxBuilderState(mode: string, duration: number) {
  return {
    version: mode === 'REF2VA' ? 2 : 1,
    mode,
    duration,
    imd: '',
    soundscape: '',
    music: 'N/A',
    ref: {
      subject_definitions: '',
      summary: '',
      retention_analysis: '',
      detailed_description: '',
      soundscape: '',
      music: 'N/A',
      ...(mode === 'REF2VA' ? {} : {
        subject_defs: [],
        summary_types: ['reference generation'],
        summary_text: '',
        retention: [],
        style_line: '',
        detail: '',
      }),
    },
  }
}

function normalizeMiniMaxBuilderState(value: Record<string, any>, timeline: Record<string, any>) {
  const mode = typeof value.mode === 'string' && MINIMAX_H3_DIRECTOR_MODES.has(value.mode) ? value.mode : 'FL2VA'
  const duration = Number.isFinite(Number(value.duration)) ? Number(value.duration) : 5
  const source = parseMiniMaxBuilderState(value.builder_state)
    ?? parseMiniMaxBuilderState(timeline.builder_state)
    ?? {}
  const defaults = createMiniMaxBuilderState(mode, duration)
  const sourceRef = isRecord(source.ref) ? source.ref : {}
  const builder = {
    ...defaults,
    ...source,
    version: mode === 'REF2VA' ? 2 : 1,
    mode,
    duration,
    imd: typeof source.imd === 'string' ? source.imd : '',
    soundscape: typeof source.soundscape === 'string' ? source.soundscape : '',
    music: typeof source.music === 'string' ? source.music : 'N/A',
    ref: {
      ...defaults.ref,
      ...sourceRef,
      subject_definitions: typeof sourceRef.subject_definitions === 'string' ? sourceRef.subject_definitions : '',
      summary: typeof sourceRef.summary === 'string' ? sourceRef.summary : '',
      retention_analysis: typeof sourceRef.retention_analysis === 'string' ? sourceRef.retention_analysis : '',
      detailed_description: typeof sourceRef.detailed_description === 'string' ? sourceRef.detailed_description : '',
      soundscape: typeof sourceRef.soundscape === 'string' ? sourceRef.soundscape : '',
      music: typeof sourceRef.music === 'string' ? sourceRef.music : 'N/A',
    },
  }

  if (!builder.ref.subject_definitions.trim() && Array.isArray(builder.ref.subject_defs)) {
    builder.ref.subject_definitions = builder.ref.subject_defs
      .flatMap((definition: unknown) => isRecord(definition) && typeof definition.text === 'string' ? [definition.text.trim()] : [])
      .filter(Boolean)
      .join('\n')
  }
  if (!builder.ref.summary.trim() && typeof builder.ref.summary_text === 'string' && builder.ref.summary_text.trim()) {
    const types = Array.isArray(builder.ref.summary_types)
      ? builder.ref.summary_types.filter((type: unknown): type is string => typeof type === 'string' && type.trim().length > 0)
      : []
    builder.ref.summary = `[${types.join(' + ') || 'reference generation'}] ${builder.ref.summary_text.trim()}`
  }
  if (!builder.ref.retention_analysis.trim() && Array.isArray(builder.ref.retention)) {
    builder.ref.retention_analysis = builder.ref.retention
      .flatMap((entry: unknown) => {
        if (!isRecord(entry)) return []
        const label = typeof entry.label === 'string' ? entry.label.trim() : ''
        const marker = typeof entry.marker === 'string' ? entry.marker.trim() : ''
        if (!label || !marker) return []
        const context = typeof entry.context === 'string' ? entry.context.trim() : ''
        const note = typeof entry.note === 'string' ? entry.note.trim() : ''
        return [`${label}${context ? ` (${context})` : ''}: ${marker} - ${note}`]
      })
      .join('\n')
  }
  if (!builder.ref.detailed_description.trim()) {
    builder.ref.detailed_description = [builder.ref.style_line, builder.ref.detail]
      .filter((part: unknown): part is string => typeof part === 'string' && part.trim().length > 0)
      .map((part: string) => part.trim())
      .join('\n')
  }

  const legacyPrompt = [
    typeof value.prompt === 'string' ? value.prompt.trim() : '',
    ...(Array.isArray(timeline.prompt_blocks)
      ? timeline.prompt_blocks
          .filter((block: unknown) => isRecord(block) && block.enabled !== false && typeof block.text === 'string' && block.text.trim())
          .sort((left: Record<string, any>, right: Record<string, any>) => Number(left.start ?? 0) - Number(right.start ?? 0) || Number(left.order ?? 0) - Number(right.order ?? 0))
          .map((block: Record<string, any>) => block.text.trim())
      : []),
  ].filter(Boolean).join('\n')
  if (legacyPrompt) {
    if (mode === 'REF2VA' && !builder.ref.detailed_description.trim()) {
      builder.ref.detailed_description = legacyPrompt
    } else if (mode !== 'REF2VA' && !builder.imd.trim()) {
      builder.imd = legacyPrompt
    }
  }
  return builder
}

function getMiniMaxDirectorActiveItems(mode: unknown, timeline: Record<string, any>) {
  const items = Array.isArray(timeline.items) ? timeline.items : []
  const ordered = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isRecord(item) && item.enabled !== false)
    .sort((left, right) => Number(left.item.order ?? left.index) - Number(right.item.order ?? right.index))

  if (mode === 'REF2VA' || isComfyInputLink(mode)) {
    return ordered.map(({ item }) => item)
  }
  if (mode === 'T2VA') {
    return []
  }
  const frameSlots = mode === 'I2VA' ? [0] : mode === 'L2VA' ? [1] : [0, 1]
  return ordered
    .filter(({ item }) => item.type === 'image' && frameSlots.includes(Number(item.slot ?? 0)))
    .sort((left, right) => Number(left.item.slot ?? left.index) - Number(right.item.slot ?? right.index))
    .slice(0, frameSlots.length)
    .map(({ item }) => item)
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
    if (!isComfyInputLink(value.builder_state)) {
      preparedValue.builder_state = JSON.stringify(normalizeMiniMaxBuilderState(value, { version: 1, items: [], prompt_blocks: [] }))
    }
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
  const builderState = normalizeMiniMaxBuilderState(value, timeline)
  const nextTimeline = { ...timeline, version: 1, items: nextItems, builder_state: builderState }
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
    builder_state: isComfyInputLink(value.builder_state) ? value.builder_state : JSON.stringify(builderState),
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
