import type { ComfyUIServerRecord } from '../../types/comfyuiServer'
import type { MarkedField, WorkflowRecord } from '../../types/workflow'
import { ComfyUIServerModel, WorkflowServerModel } from '../../models/ComfyUIServer'
import { ComfyUIService } from '../../services/comfyuiService'
import { reconcileComfyModelSelectionValues } from '../../services/comfyModelSelectionResolver'
import { prepareComfyPromptData } from '../../services/prepareComfyPromptData'
import { resolveWorkflowPromptValues } from '../../services/workflowPromptValueResolver'

const MINIMAX_DIRECTOR_EDITOR = 'minimax_h3_director_dasiwa'
const MINIMAX_META_KEY = '__conai_minimax_h3_director'
const MINIMAX_MODES = new Set(['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF2VA', 'Image Inpaint'])
const FRIENDLY_MINIMAX_KEYS = new Set([
  'prompt_mode',
  'simple_prompt',
  'imd',
  'soundscape',
  'music',
  'ref',
  'resolution',
  'postprocess',
  'media',
  'assets',
])

type MiniMaxMediaInput = {
  id?: string
  type?: 'image' | 'video' | 'audio'
  slot?: number
  order?: number
  enabled?: boolean
  start?: number
  duration?: number
  trim_start?: number
  trim_end?: number | null
  source_duration?: number
  source_width?: number
  source_height?: number
  prompt?: string
  value?: string
  file_name?: string
  data_url?: string
  mime_type?: string
  file_path?: string
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseRecord(value: unknown, fallback: Record<string, any> = {}) {
  if (isRecord(value)) return value
  if (typeof value !== 'string' || !value.trim()) return fallback
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function parseSuppliedRecord(value: unknown, label: string) {
  if (value === undefined) return {}
  if (isRecord(value)) return value
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (isRecord(parsed)) return parsed
    } catch {
      // Fall through to the boundary error below.
    }
  }
  throw new Error(`${label} must be a JSON object or an object-valued JSON string`)
}

function hasMeaningfulValue(value: unknown) {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

export function parseMcpMarkedFields(workflow: WorkflowRecord): MarkedField[] {
  if (!workflow.marked_fields) return []
  const parsed = JSON.parse(workflow.marked_fields)
  if (!Array.isArray(parsed)) {
    throw new Error(`Workflow ${workflow.id} has invalid marked_fields JSON`)
  }
  return parsed as MarkedField[]
}

function createMiniMaxMediaItem(media: MiniMaxMediaInput, index: number) {
  const type = media.type === 'video' || media.type === 'audio' ? media.type : 'image'
  const id = typeof media.id === 'string' && media.id.trim()
    ? media.id.trim()
    : `mcp-${type}-${Date.now()}-${index}`
  const duration = Number.isFinite(Number(media.duration)) ? Number(media.duration) : type === 'image' ? 1 : 2
  const item: Record<string, unknown> = {
    id,
    type,
    enabled: media.enabled !== false,
    order: Number.isFinite(Number(media.order)) ? Number(media.order) : index,
    slot: Number.isFinite(Number(media.slot)) ? Number(media.slot) : index,
    start: Number.isFinite(Number(media.start)) ? Number(media.start) : index,
    duration,
    value: typeof media.value === 'string' ? media.value : media.file_name ?? '',
  }

  for (const key of ['trim_start', 'trim_end', 'source_duration', 'source_width', 'source_height', 'prompt'] as const) {
    if (media[key] !== undefined) item[key] = media[key]
  }
  if (type === 'video') item.media_mode = 'video'
  return item
}

function buildMiniMaxAssets(mediaItems: MiniMaxMediaInput[], timelineItems: Array<Record<string, unknown>>) {
  const assets: Record<string, unknown> = {}
  mediaItems.forEach((media, index) => {
    const itemId = String(timelineItems[index]?.id ?? '')
    if (!itemId) return
    const fallbackExtension = media.type === 'video' ? 'mp4' : media.type === 'audio' ? 'wav' : 'png'
    const asset = {
      fileName: media.file_name ?? `mcp-${media.type ?? 'image'}-${index}.${fallbackExtension}`,
      dataUrl: media.data_url,
      mimeType: media.mime_type,
      filePath: media.file_path,
    }
    if (Object.values(asset).some((value) => hasMeaningfulValue(value))) {
      assets[itemId] = asset
    }
  })
  return assets
}

function activeMiniMaxItems(value: Record<string, any>) {
  const timeline = parseRecord(value.timeline_data)
  return (Array.isArray(timeline.items) ? timeline.items : [])
    .filter((item): item is Record<string, any> => isRecord(item) && item.enabled !== false)
}

function miniMaxMediaDuration(item: Record<string, any>) {
  const start = Number(item.trim_start ?? 0)
  const end = Number(item.trim_end ?? item.source_duration ?? item.duration)
  if (Number.isFinite(start) && Number.isFinite(end)) return Math.max(0, end - start)
  return Number(item.duration)
}

function validateMiniMaxValue(field: MarkedField, value: Record<string, any>) {
  const mode = value.mode
  if (typeof mode !== 'string' || !MINIMAX_MODES.has(mode)) {
    throw new Error(`${field.label || field.id}: mode must be one of ${Array.from(MINIMAX_MODES).join(', ')}`)
  }

  const duration = Number(value.duration)
  if (!Number.isInteger(duration) || duration < 1 || duration > 60) {
    throw new Error(`${field.label || field.id}: duration must be an integer from 1 to 60`)
  }
  const frameRate = Number(value.frame_rate)
  if (!Number.isFinite(frameRate) || frameRate < 0.1 || frameRate > 240) {
    throw new Error(`${field.label || field.id}: frame_rate must be from 0.1 to 240`)
  }

  const items = activeMiniMaxItems(value)
  if (mode === 'Image Inpaint') {
    if (items.length !== 1 || items[0].type !== 'image') {
      throw new Error(`${field.label || field.id}: Image Inpaint requires exactly one enabled image and no video or audio`)
    }
    return
  }
  if (mode !== 'REF2VA') return

  const imageItems = items.filter((item) => item.type === 'image')
  const videoItems = items.filter((item) => item.type === 'video')
  const audioItems = items.filter((item) => item.type === 'audio')
  if (imageItems.length > 9) throw new Error(`${field.label || field.id}: REF2VA supports at most 9 images`)
  if (videoItems.length > 3) throw new Error(`${field.label || field.id}: REF2VA supports at most 3 videos`)
  if (audioItems.length > 3) throw new Error(`${field.label || field.id}: REF2VA supports at most 3 audio references`)
  if (items.length > 12) throw new Error(`${field.label || field.id}: REF2VA supports at most 12 references total`)
  if (audioItems.length > 0 && imageItems.length + videoItems.length === 0) {
    throw new Error(`${field.label || field.id}: REF2VA audio requires at least one image or video reference`)
  }

  for (const item of [...videoItems, ...audioItems]) {
    const mediaDuration = miniMaxMediaDuration(item)
    if (!Number.isFinite(mediaDuration) || mediaDuration < 2 || mediaDuration > 15) {
      throw new Error(`${field.label || field.id}: each REF2VA video or audio range must be from 2 to 15 seconds`)
    }
  }
  const videoDuration = videoItems.reduce((sum, item) => sum + miniMaxMediaDuration(item), 0)
  const audioDuration = audioItems.reduce((sum, item) => sum + miniMaxMediaDuration(item), 0)
  if (videoDuration > 15) throw new Error(`${field.label || field.id}: total REF2VA video duration cannot exceed 15 seconds`)
  if (audioDuration > 15) throw new Error(`${field.label || field.id}: total REF2VA audio duration cannot exceed 15 seconds`)
}

function normalizeMiniMaxValue(field: MarkedField, provided: unknown) {
  const defaults = isRecord(field.default_value) ? field.default_value : {}
  const incoming = isRecord(provided) ? provided : {}
  const value: Record<string, any> = { ...defaults, ...incoming }
  const defaultTimeline = parseRecord(defaults.timeline_data, { version: 1, items: [], prompt_blocks: [] })
  const incomingTimeline = parseSuppliedRecord(incoming.timeline_data, `${field.label || field.id}.timeline_data`)
  const defaultPostprocess = isRecord(defaultTimeline.postprocess) ? defaultTimeline.postprocess : {}
  const incomingPostprocess = isRecord(incomingTimeline.postprocess) ? incomingTimeline.postprocess : {}
  const friendlyPostprocess = isRecord(incoming.postprocess) ? incoming.postprocess : {}
  const timeline: Record<string, any> = {
    ...defaultTimeline,
    ...incomingTimeline,
    resolution: {
      ...(isRecord(defaultTimeline.resolution) ? defaultTimeline.resolution : {}),
      ...(isRecord(incomingTimeline.resolution) ? incomingTimeline.resolution : {}),
      ...(isRecord(incoming.resolution) ? incoming.resolution : {}),
    },
    postprocess: {
      ...defaultPostprocess,
      ...incomingPostprocess,
      ...friendlyPostprocess,
      simple: {
        ...(isRecord(defaultPostprocess.simple) ? defaultPostprocess.simple : {}),
        ...(isRecord(incomingPostprocess.simple) ? incomingPostprocess.simple : {}),
        ...(isRecord(friendlyPostprocess.simple) ? friendlyPostprocess.simple : {}),
      },
      model: {
        ...(isRecord(defaultPostprocess.model) ? defaultPostprocess.model : {}),
        ...(isRecord(incomingPostprocess.model) ? incomingPostprocess.model : {}),
        ...(isRecord(friendlyPostprocess.model) ? friendlyPostprocess.model : {}),
      },
      rtx: {
        ...(isRecord(defaultPostprocess.rtx) ? defaultPostprocess.rtx : {}),
        ...(isRecord(incomingPostprocess.rtx) ? incomingPostprocess.rtx : {}),
        ...(isRecord(friendlyPostprocess.rtx) ? friendlyPostprocess.rtx : {}),
      },
    },
  }

  const defaultBuilder = parseRecord(defaults.builder_state)
  const incomingBuilder = parseSuppliedRecord(incoming.builder_state, `${field.label || field.id}.builder_state`)
  const builder: Record<string, any> = {
    ...defaultBuilder,
    ...incomingBuilder,
    ref: {
      ...(isRecord(defaultBuilder.ref) ? defaultBuilder.ref : {}),
      ...(isRecord(incomingBuilder.ref) ? incomingBuilder.ref : {}),
      ...(isRecord(incoming.ref) ? incoming.ref : {}),
    },
  }
  for (const key of ['prompt_mode', 'simple_prompt', 'imd', 'soundscape', 'music'] as const) {
    if (incoming[key] !== undefined) builder[key] = incoming[key]
  }
  builder.mode = value.mode
  builder.duration = value.duration
  builder.version = value.mode === 'REF2VA' ? 2 : 1

  const media = Array.isArray(incoming.media)
    ? incoming.media.filter((item): item is MiniMaxMediaInput => isRecord(item))
    : null
  const timelineItems = media ? media.map(createMiniMaxMediaItem) : Array.isArray(timeline.items) ? timeline.items : []
  timeline.items = timelineItems
  timeline.builder_state = builder
  value.timeline_data = JSON.stringify(timeline)
  value.builder_state = JSON.stringify(builder)

  const explicitAssets = isRecord(incoming.assets) ? incoming.assets : {}
  const existingMeta = isRecord(value[MINIMAX_META_KEY]) ? value[MINIMAX_META_KEY] : {}
  const existingAssets = isRecord(existingMeta.assets) ? existingMeta.assets : {}
  const mediaAssets = media ? buildMiniMaxAssets(media, timelineItems as Array<Record<string, unknown>>) : {}
  value[MINIMAX_META_KEY] = {
    ...existingMeta,
    assets: { ...existingAssets, ...explicitAssets, ...mediaAssets },
  }

  for (const key of FRIENDLY_MINIMAX_KEYS) delete value[key]
  validateMiniMaxValue(field, value)
  return value
}

export function normalizeMcpWorkflowInputs(markedFields: MarkedField[], suppliedInputs: Record<string, unknown>) {
  const knownIds = new Set(markedFields.map((field) => field.id))
  const unknownIds = Object.keys(suppliedInputs).filter((key) => !knownIds.has(key))
  if (unknownIds.length > 0) {
    throw new Error(`Unknown workflow input field(s): ${unknownIds.join(', ')}`)
  }

  const normalized: Record<string, any> = {}
  for (const field of markedFields) {
    const hasSuppliedValue = Object.prototype.hasOwnProperty.call(suppliedInputs, field.id)
    const suppliedValue = hasSuppliedValue ? suppliedInputs[field.id] : undefined
    const value = field.type === 'node' && field.node_editor === MINIMAX_DIRECTOR_EDITOR
      ? normalizeMiniMaxValue(field, suppliedValue)
      : hasSuppliedValue ? suppliedValue : field.default_value

    if (field.required && !hasMeaningfulValue(value)) {
      throw new Error(`Required workflow input is missing: ${field.label || field.id} (${field.id})`)
    }
    if (value !== undefined) normalized[field.id] = value
  }
  return normalized
}

export function createMcpComfyService(server: ComfyUIServerRecord) {
  return new ComfyUIService(server.endpoint, {
    backendType: server.backend_type,
    capacity: server.capacity,
  })
}

export function resolveMcpComfyServer(workflowId: number, requestedServerId?: number) {
  if (requestedServerId !== undefined) {
    const server = ComfyUIServerModel.findById(requestedServerId)
    if (!server) throw new Error(`ComfyUI server ${requestedServerId} not found`)
    if (!server.is_active) throw new Error(`ComfyUI server ${requestedServerId} is inactive`)
    return server
  }

  for (const linked of WorkflowServerModel.findServersByWorkflow(workflowId, true)) {
    const linkedServerId = Number(linked.server_id ?? linked.id)
    const server = Number.isInteger(linkedServerId) ? ComfyUIServerModel.findById(linkedServerId) : null
    if (server?.is_active) return server
  }
  const defaultServer = ComfyUIServerModel.findDefaultActive()
  if (defaultServer) return defaultServer
  const firstActive = ComfyUIServerModel.findAll(true)[0]
  if (firstActive) return firstActive
  throw new Error('No active ComfyUI server is available')
}

export async function prepareMcpComfyWorkflow(params: {
  workflow: WorkflowRecord
  server: ComfyUIServerRecord
  suppliedInputs: Record<string, unknown>
}) {
  const markedFields = parseMcpMarkedFields(params.workflow)
  const promptData = normalizeMcpWorkflowInputs(markedFields, params.suppliedInputs)
  const comfyService = createMcpComfyService(params.server)
  const preparedPromptData = await prepareComfyPromptData(comfyService, markedFields, promptData, {
    uploadNameBase: `mcp_workflow_${params.workflow.id}`,
  })
  const parsedPromptData = resolveWorkflowPromptValues(markedFields, preparedPromptData, 'comfyui', {
    modelPathSeparator: comfyService.isModalBackend() ? 'posix' : 'windows',
  })
  const resolvedPromptData = await reconcileComfyModelSelectionValues(
    params.workflow.workflow_json,
    markedFields,
    parsedPromptData,
    comfyService,
    { strict: !comfyService.isModalBackend() },
  )
  const substitutedWorkflow = comfyService.substitutePromptData(
    params.workflow.workflow_json,
    markedFields,
    resolvedPromptData,
  )
  return { comfyService, markedFields, substitutedWorkflow }
}

function miniMaxInputSchema(field: MarkedField) {
  return {
    format: 'object',
    accepts_partial_value: true,
    modes: Array.from(MINIMAX_MODES),
    properties: {
      mode: { type: 'string', required: false },
      duration: { type: 'integer', minimum: 1, maximum: 60 },
      frame_rate: { type: 'number', minimum: 0.1, maximum: 240 },
      prompt_mode: { type: 'string', enum: ['simple', 'structured'] },
      simple_prompt: { type: 'string' },
      imd: { type: 'string' },
      soundscape: { type: 'string' },
      music: { type: 'string' },
      ref: { type: 'object' },
      resolution: { type: 'object', description: 'Aspect, resolution, custom size, and input scaling settings.' },
      postprocess: { type: 'object', description: 'simple/model/rtx upscaling settings.' },
      media: {
        type: 'array',
        item_properties: ['id', 'type', 'slot', 'order', 'enabled', 'duration', 'trim_start', 'trim_end', 'source_width', 'source_height', 'file_name', 'data_url', 'mime_type', 'file_path'],
      },
      timeline_data: { type: 'string|object', description: 'Raw CoNAI timeline format; friendly media/resolution keys are preferred.' },
      builder_state: { type: 'string|object', description: 'Raw CoNAI prompt builder format; friendly prompt keys are preferred.' },
    },
    visible_fields: field.node_visible_fields ?? [],
    numeric_bounds: field.node_numeric_bounds ?? {},
  }
}

export function describeMcpMarkedField(field: MarkedField) {
  return {
    id: field.id,
    label: field.label,
    description: field.description,
    type: field.type,
    required: field.required === true,
    has_default: field.default_value !== undefined,
    placeholder: field.placeholder,
    options: field.options,
    minimum: field.min,
    maximum: field.max,
    step: field.step,
    json_path: field.jsonPath,
    node_class_type: field.node_class_type,
    node_editor: field.node_editor,
    value_schema: field.type === 'node' && field.node_editor === MINIMAX_DIRECTOR_EDITOR
      ? miniMaxInputSchema(field)
      : undefined,
  }
}

export function createMcpWorkflowInputTemplate(markedFields: MarkedField[]) {
  return Object.fromEntries(markedFields.map((field) => {
    if (field.type === 'node' && field.node_editor === MINIMAX_DIRECTOR_EDITOR) {
      return [field.id, {
        mode: 'T2VA',
        duration: 5,
        frame_rate: 24,
        prompt_mode: 'simple',
        simple_prompt: 'Describe the scene and camera movement.',
        resolution: { aspect: '16:9', resolution: 'auto', input_scaling: 'Auto' },
        postprocess: { simple: { enabled: false }, model: { enabled: false }, rtx: { enabled: false } },
        media: [],
      }]
    }
    if (field.type === 'number') return [field.id, field.default_value ?? field.min ?? 0]
    if (field.type === 'select') return [field.id, field.default_value ?? field.options?.[0] ?? '']
    if (field.type === 'image') return [field.id, { fileName: 'input.png', dataUrl: 'data:image/png;base64,...' }]
    return [field.id, field.default_value ?? '']
  }))
}
