import {
  WORKFLOW_INPUT_ASSET_REF_KIND,
  type WorkflowInputAssetRef,
} from '@/lib/api-workflow-input-assets'

export const MINIMAX_H3_DIRECTOR_CLASS_TYPE = 'MiniMaxH3Director'
export const MINIMAX_H3_DIRECTOR_NODE_EDITOR = 'minimax_h3_director_dasiwa'
export const MINIMAX_H3_DIRECTOR_NODE_INPUT_KEY = '__minimax_h3_director_node__'
export const MINIMAX_H3_DIRECTOR_META_KEY = '__conai_minimax_h3_director'

export type MiniMaxH3DirectorMode = 'FL2VA' | 'REF2VA'
export type MiniMaxH3DirectorMediaType = 'image' | 'video' | 'audio'
export type MiniMaxH3DirectorVideoMode = 'video' | 'audio' | 'video_audio'

export type MiniMaxH3DirectorTimelineItem = {
  id: string
  type: MiniMaxH3DirectorMediaType
  value: string
  enabled: boolean
  order: number
  slot: number
  start: number
  duration: number
  source_duration?: number
  trim_start?: number
  trim_end?: number | null
  media_mode?: MiniMaxH3DirectorVideoMode
  prompt?: string
  waveform_peaks?: number[]
  [key: string]: unknown
}

export type MiniMaxH3DirectorPromptBlock = {
  id: string
  text: string
  enabled: boolean
  start: number
  duration: number
  order: number
}

export type MiniMaxH3DirectorTimeline = {
  version: 1
  items: MiniMaxH3DirectorTimelineItem[]
  prompt_blocks: MiniMaxH3DirectorPromptBlock[]
  [key: string]: unknown
}

export type MiniMaxH3DirectorDraftMeta = {
  assets: Record<string, WorkflowInputAssetRef>
}

export type MiniMaxH3DirectorIssue = {
  code: string
  ko: string
  en: string
  field?: 'mode' | 'width' | 'height' | 'duration' | 'timeline'
  itemId?: string
}

const DEFAULT_TIMELINE: MiniMaxH3DirectorTimeline = {
  version: 1,
  items: [],
  prompt_blocks: [],
}

const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'jxl', 'png', 'tif', 'tiff', 'webp'])
const VIDEO_EXTENSIONS = new Set(['3gp', 'avi', 'flv', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'mts', 'ts', 'webm', 'wmv'])
const AUDIO_EXTENSIONS = new Set(['aac', 'aif', 'aiff', 'alac', 'amr', 'ape', 'caf', 'flac', 'm4a', 'mka', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'weba', 'wma'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asFiniteNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function isTimelineItem(value: unknown): value is MiniMaxH3DirectorTimelineItem {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.id === 'string'
    && (value.type === 'image' || value.type === 'video' || value.type === 'audio')
    && typeof value.value === 'string'
}

function isWorkflowInputAssetRef(value: unknown): value is WorkflowInputAssetRef {
  return isRecord(value)
    && value.__ref === WORKFLOW_INPUT_ASSET_REF_KIND
    && typeof value.id === 'string'
    && typeof value.fileName === 'string'
    && typeof value.bytes === 'number'
}

/** Parse one DaSiWa timeline_data string while preserving unknown compatible fields. */
export function parseMiniMaxH3DirectorTimeline(value: unknown): { timeline: MiniMaxH3DirectorTimeline; error: string | null } {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { timeline: structuredClone(DEFAULT_TIMELINE), error: null }
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (!isRecord(parsed)) {
      return { timeline: structuredClone(DEFAULT_TIMELINE), error: 'timeline_data must contain an object' }
    }

    const items = Array.isArray(parsed.items)
      ? parsed.items.filter(isTimelineItem).map((item, index) => ({
          ...item,
          enabled: item.enabled !== false,
          order: asFiniteNumber(item.order, index),
          slot: asFiniteNumber(item.slot, index),
          start: asFiniteNumber(item.start, 0),
          duration: asFiniteNumber(item.duration, item.type === 'image' ? 1 : 2),
        }))
      : []
    const promptBlocks = Array.isArray(parsed.prompt_blocks)
      ? parsed.prompt_blocks.filter(isRecord).map((block, index) => ({
          id: typeof block.id === 'string' ? block.id : `block-${index}`,
          text: typeof block.text === 'string' ? block.text : '',
          enabled: block.enabled !== false,
          start: asFiniteNumber(block.start, 0),
          duration: asFiniteNumber(block.duration, 1),
          order: asFiniteNumber(block.order, index),
        }))
      : []

    return {
      timeline: {
        ...parsed,
        version: 1,
        items,
        prompt_blocks: promptBlocks,
      },
      error: null,
    }
  } catch (error) {
    return {
      timeline: structuredClone(DEFAULT_TIMELINE),
      error: error instanceof Error ? error.message : 'Invalid timeline_data JSON',
    }
  }
}

/** Read the CoNAI-only asset references attached to one Director node draft. */
export function getMiniMaxH3DirectorAssets(value: unknown) {
  if (!isRecord(value) || !isRecord(value[MINIMAX_H3_DIRECTOR_META_KEY])) {
    return {}
  }

  const rawAssets = (value[MINIMAX_H3_DIRECTOR_META_KEY] as Record<string, unknown>).assets
  if (!isRecord(rawAssets)) {
    return {}
  }

  return Object.fromEntries(Object.entries(rawAssets).filter((entry): entry is [string, WorkflowInputAssetRef] => isWorkflowInputAssetRef(entry[1])))
}

/** Normalize visible Director inputs without discarding model links or unknown workflow values. */
export function normalizeMiniMaxH3DirectorNodeValue(value: unknown): Record<string, unknown> & {
  mode: MiniMaxH3DirectorMode
  prompt: string
  width: number
  height: number
  duration: number
  ref_image_size: 'match' | 'max'
  timeline_data: string
} {
  const source = isRecord(value) ? value : {}
  return {
    ...source,
    mode: source.mode === 'REF2VA' ? 'REF2VA' : 'FL2VA',
    prompt: typeof source.prompt === 'string' ? source.prompt : '',
    width: asFiniteNumber(source.width, 1344),
    height: asFiniteNumber(source.height, 768),
    duration: asFiniteNumber(source.duration, 5),
    ref_image_size: source.ref_image_size === 'max' ? 'max' : 'match',
    timeline_data: typeof source.timeline_data === 'string'
      ? source.timeline_data
      : JSON.stringify(DEFAULT_TIMELINE),
  }
}

/** Rebuild attached prompt blocks in the exact order consumed by the DaSiWa node. */
export function syncMiniMaxH3DirectorPromptBlocks(timeline: MiniMaxH3DirectorTimeline): MiniMaxH3DirectorTimeline {
  const items = timeline.items.map((item, index) => ({ ...item, order: index }))
  const promptBlocks = items
    .filter((item) => String(item.prompt ?? '').trim().length > 0)
    .map((item, index) => ({
      id: `attached-${item.id}`,
      text: String(item.prompt).trim(),
      enabled: item.enabled !== false,
      start: asFiniteNumber(item.start, 0),
      duration: asFiniteNumber(item.duration, 1),
      order: index,
    }))

  return {
    ...timeline,
    version: 1,
    items,
    prompt_blocks: promptBlocks,
  }
}

/** Build a new Director node value while retaining original MODEL links and unknown inputs. */
export function buildMiniMaxH3DirectorNodeValue(
  currentValue: unknown,
  inputPatch: Record<string, unknown>,
  timeline?: MiniMaxH3DirectorTimeline,
  assets?: Record<string, WorkflowInputAssetRef>,
): Record<string, unknown> & { timeline_data: string } {
  const current = normalizeMiniMaxH3DirectorNodeValue(currentValue)
  const nextTimeline = timeline ? syncMiniMaxH3DirectorPromptBlocks(timeline) : parseMiniMaxH3DirectorTimeline(current.timeline_data).timeline
  const currentMeta = isRecord(current[MINIMAX_H3_DIRECTOR_META_KEY]) ? current[MINIMAX_H3_DIRECTOR_META_KEY] : {}

  return {
    ...current,
    ...inputPatch,
    timeline_data: JSON.stringify(nextTimeline),
    [MINIMAX_H3_DIRECTOR_META_KEY]: {
      ...currentMeta,
      assets: assets ?? getMiniMaxH3DirectorAssets(current),
    },
  }
}

/** Return items that the DaSiWa backend will consume for the selected mode. */
export function getMiniMaxH3DirectorActiveItems(value: unknown) {
  const nodeValue = normalizeMiniMaxH3DirectorNodeValue(value)
  const items = parseMiniMaxH3DirectorTimeline(nodeValue.timeline_data).timeline.items
    .filter((item) => item.enabled !== false)
    .sort((left, right) => left.order - right.order)

  return nodeValue.mode === 'FL2VA'
    ? items.filter((item) => item.type === 'image').sort((left, right) => left.slot - right.slot).slice(0, 2)
    : items
}

function getSelectedDuration(item: MiniMaxH3DirectorTimelineItem) {
  if (item.type === 'image') {
    return 0
  }

  const trimStart = asFiniteNumber(item.trim_start, 0)
  const trimEnd = item.trim_end == null ? asFiniteNumber(item.source_duration, item.duration) : asFiniteNumber(item.trim_end, item.duration)
  return trimEnd - trimStart
}

/** Validate Director inputs against the actual DaSiWa FL2VA and REF2VA contracts. */
export function validateMiniMaxH3DirectorNodeValue(value: unknown): MiniMaxH3DirectorIssue[] {
  const nodeValue = normalizeMiniMaxH3DirectorNodeValue(value)
  const parsedTimeline = parseMiniMaxH3DirectorTimeline(nodeValue.timeline_data)
  const issues: MiniMaxH3DirectorIssue[] = []

  if (parsedTimeline.error) {
    issues.push({ code: 'timeline-json', field: 'timeline', ko: '타임라인 데이터가 올바른 JSON이 아니야.', en: 'Timeline data is not valid JSON.' })
    return issues
  }

  for (const [field, numberValue] of [['width', nodeValue.width], ['height', nodeValue.height]] as const) {
    if (!Number.isInteger(numberValue) || numberValue < 32 || numberValue > 8192 || numberValue % 32 !== 0) {
      issues.push({
        code: `${field}-range`,
        field,
        ko: `${field === 'width' ? '너비' : '높이'}는 32~8192 범위의 32 단위 정수여야 해.`,
        en: `${field === 'width' ? 'Width' : 'Height'} must be an integer from 32 to 8192 in steps of 32.`,
      })
    }
  }

  if (!Number.isInteger(nodeValue.duration) || nodeValue.duration < 1 || nodeValue.duration > 1000) {
    issues.push({ code: 'duration-range', field: 'duration', ko: '영상 길이는 1~1000초 정수여야 해.', en: 'Duration must be an integer from 1 to 1000 seconds.' })
  }

  const selectedModelInput = nodeValue.mode === 'FL2VA' ? nodeValue.fl2va_model : nodeValue.ref2va_model
  if (!Array.isArray(selectedModelInput) || selectedModelInput.length < 2) {
    issues.push({
      code: 'selected-model-connection',
      ko: `워크플로 수정 필요: ${nodeValue.mode} 모델 연결이 없어.`,
      en: `Workflow update required: the ${nodeValue.mode} model is not connected.`,
    })
  }

  const activeItems = getMiniMaxH3DirectorActiveItems(nodeValue)
  for (const item of activeItems) {
    if (!item.value.trim()) {
      issues.push({ code: 'missing-value', itemId: item.id, ko: '참조 미디어 파일이 비어 있어.', en: 'A reference media file is missing.' })
    }
  }

  if (nodeValue.mode === 'FL2VA') {
    return issues
  }

  const imageItems = activeItems.filter((item) => item.type === 'image')
  const videoItems = activeItems.filter((item) => item.type === 'video')
  const audioItems = activeItems.filter((item) => item.type === 'audio')
  const visualVideos = videoItems.filter((item) => item.media_mode !== 'audio')
  const embeddedAudioVideos = videoItems.filter((item) => item.media_mode === 'audio' || item.media_mode === 'video_audio')
  const audioReferenceCount = audioItems.length + embeddedAudioVideos.length
  const visualReferenceCount = imageItems.length + visualVideos.length

  if (imageItems.length > 9) {
    issues.push({ code: 'image-count', ko: 'REF2VA 이미지는 최대 9개까지 사용할 수 있어.', en: 'REF2VA supports at most nine images.' })
  }
  if (videoItems.length > 3) {
    issues.push({ code: 'video-count', ko: 'REF2VA 영상 참조는 최대 3개까지 사용할 수 있어.', en: 'REF2VA supports at most three video references.' })
  }
  if (audioReferenceCount > 3) {
    issues.push({ code: 'audio-count', ko: 'REF2VA 오디오 참조는 최대 3개까지 사용할 수 있어.', en: 'REF2VA supports at most three audio references.' })
  }
  if (imageItems.length + visualVideos.length + audioReferenceCount > 12) {
    issues.push({ code: 'reference-count', ko: 'REF2VA 참조는 합계 12개를 넘을 수 없어.', en: 'REF2VA supports at most 12 references in total.' })
  }
  if (audioReferenceCount > 0 && visualReferenceCount === 0) {
    issues.push({ code: 'audio-needs-visual', ko: '오디오 참조에는 이미지 또는 영상 참조가 하나 이상 필요해.', en: 'Audio references require at least one image or visual video reference.' })
  }

  let videoDurationTotal = 0
  let audioDurationTotal = 0
  for (const item of [...videoItems, ...audioItems]) {
    const selectedDuration = getSelectedDuration(item)
    if (selectedDuration < 2 || selectedDuration > 15) {
      issues.push({ code: 'media-duration', itemId: item.id, ko: '영상·오디오 참조 구간은 2~15초여야 해.', en: 'Video and audio reference ranges must be from 2 to 15 seconds.' })
    }
    if (item.type === 'video' && item.media_mode !== 'audio') {
      videoDurationTotal += selectedDuration
    }
    if (item.type === 'audio' || (item.type === 'video' && item.media_mode !== 'video')) {
      audioDurationTotal += selectedDuration
    }
  }
  if (videoDurationTotal > 15) {
    issues.push({ code: 'video-duration-total', ko: '영상 참조 구간 합계는 15초를 넘을 수 없어.', en: 'Total video reference duration cannot exceed 15 seconds.' })
  }
  if (audioDurationTotal > 15) {
    issues.push({ code: 'audio-duration-total', ko: '오디오 참조 구간 합계는 15초를 넘을 수 없어.', en: 'Total audio reference duration cannot exceed 15 seconds.' })
  }

  return issues
}

/** Infer the Director reference type from browser MIME metadata and filename. */
export function inferMiniMaxH3DirectorMediaType(file: File): MiniMaxH3DirectorMediaType | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio'
  return null
}

/** Allocate a collision-resistant timeline item id without exposing local paths. */
export function createMiniMaxH3DirectorItemId(type: MiniMaxH3DirectorMediaType) {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${type}-${suffix}`
}
