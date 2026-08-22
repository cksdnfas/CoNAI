import {
  WORKFLOW_INPUT_ASSET_REF_KIND,
  type WorkflowInputAssetRef,
} from '@/lib/api-workflow-input-assets'

export const MINIMAX_H3_DIRECTOR_CLASS_TYPE = 'MiniMaxH3Director'
export const MINIMAX_H3_DIRECTOR_NODE_EDITOR = 'minimax_h3_director_dasiwa'
export const MINIMAX_H3_DIRECTOR_NODE_INPUT_KEY = '__minimax_h3_director_node__'
export const MINIMAX_H3_DIRECTOR_META_KEY = '__conai_minimax_h3_director'
export const MINIMAX_H3_DIRECTOR_DURATION_MIN_SECONDS = 1
export const MINIMAX_H3_DIRECTOR_DURATION_MAX_SECONDS = 60

export const MINIMAX_H3_DIRECTOR_MODES = ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF2VA'] as const
export type MiniMaxH3DirectorMode = typeof MINIMAX_H3_DIRECTOR_MODES[number]
export type MiniMaxH3DirectorMediaType = 'image' | 'video' | 'audio'
export type MiniMaxH3DirectorVideoMode = 'video' | 'audio' | 'video_audio'
export type MiniMaxH3DirectorInputLink = [string | number, number]
export type MiniMaxH3DirectorGraphInputKey =
  | 'width'
  | 'height'
  | 'duration'
  | 'ref_image_size'
  | 'start_image'
  | 'end_image'
  | 'reference_image'
  | 'reference_video'
  | 'reference_audio'
  | 'prompt.imd'
  | 'prompt.subject_definitions'
  | 'prompt.summary'
  | 'prompt.retention_analysis'
  | 'prompt.detailed_description'
  | 'prompt.soundscape'
  | 'prompt.music'
export const MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS = [
  'mode',
  'width',
  'height',
  'duration',
  'ref_image_size',
  'timeline_data',
  'prompt',
] as const
export type MiniMaxH3DirectorVisibleField = typeof MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS[number]

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
  builder_state?: Record<string, unknown>
  [key: string]: unknown
}

export type MiniMaxH3DirectorBuilderRefState = {
  subject_definitions: string
  summary: string
  retention_analysis: string
  detailed_description: string
  soundscape: string
  music: string
  subject_defs?: unknown[]
  summary_types?: string[]
  summary_text?: string
  retention?: unknown[]
  style_line?: string
  detail?: string
  [key: string]: unknown
}

export type MiniMaxH3DirectorBuilderState = {
  version: number
  mode: MiniMaxH3DirectorMode
  duration: number
  imd: string
  soundscape: string
  music: string
  ref: MiniMaxH3DirectorBuilderRefState
  [key: string]: unknown
}

export type MiniMaxH3DirectorDraftMeta = {
  assets: Record<string, WorkflowInputAssetRef>
}

export type MiniMaxH3DirectorIssue = {
  code: string
  ko: string
  en: string
  field?: 'mode' | 'width' | 'height' | 'duration' | 'timeline' | 'prompt'
  itemId?: string
}

const DEFAULT_TIMELINE: MiniMaxH3DirectorTimeline = {
  version: 1,
  items: [],
  prompt_blocks: [],
}

const DEFAULT_REF_BUILDER_STATE: MiniMaxH3DirectorBuilderRefState = {
  subject_definitions: '',
  summary: '',
  retention_analysis: '',
  detailed_description: '',
  soundscape: '',
  music: 'N/A',
}

const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'jxl', 'png', 'tif', 'tiff', 'webp'])
const VIDEO_EXTENSIONS = new Set(['3gp', 'avi', 'flv', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'mts', 'ts', 'webm', 'wmv'])
const AUDIO_EXTENSIONS = new Set(['aac', 'aif', 'aiff', 'alac', 'amr', 'ape', 'caf', 'flac', 'm4a', 'mka', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'weba', 'wma'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Match the ordinary Comfy API-workflow input link shape. */
export function isMiniMaxH3DirectorInputLink(value: unknown): value is MiniMaxH3DirectorInputLink {
  return Array.isArray(value)
    && value.length >= 2
    && (typeof value[0] === 'string' || typeof value[0] === 'number')
    && typeof value[1] === 'number'
    && Number.isInteger(value[1])
}

function asFiniteNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Reduce intrinsic media dimensions to a readable width:height ratio. */
export function formatMiniMaxH3DirectorAspectRatio(width: number, height: number) {
  const normalizedWidth = Math.round(width)
  const normalizedHeight = Math.round(height)
  if (!Number.isFinite(normalizedWidth) || !Number.isFinite(normalizedHeight) || normalizedWidth <= 0 || normalizedHeight <= 0) {
    return null
  }

  let left = normalizedWidth
  let right = normalizedHeight
  while (right !== 0) {
    const remainder = left % right
    left = right
    right = remainder
  }

  return `${normalizedWidth / left}:${normalizedHeight / left}`
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function isMiniMaxH3DirectorMode(value: unknown): value is MiniMaxH3DirectorMode {
  return typeof value === 'string' && MINIMAX_H3_DIRECTOR_MODES.includes(value as MiniMaxH3DirectorMode)
}

function parseBuilderStateRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) {
    return value
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Return a fresh DaSiWa-compatible prompt-builder state. */
export function createMiniMaxH3DirectorBuilderState(
  mode: MiniMaxH3DirectorMode = 'FL2VA',
  duration = 5,
): MiniMaxH3DirectorBuilderState {
  return {
    version: mode === 'REF2VA' ? 2 : 1,
    mode,
    duration,
    imd: '',
    soundscape: '',
    music: 'N/A',
    ref: {
      ...structuredClone(DEFAULT_REF_BUILDER_STATE),
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

function buildLegacyPrompt(prompt: unknown, timeline: MiniMaxH3DirectorTimeline) {
  return [
    typeof prompt === 'string' ? prompt.trim() : '',
    ...timeline.prompt_blocks
      .filter((block) => block.enabled !== false && block.text.trim().length > 0)
      .sort((left, right) => left.start - right.start || left.order - right.order)
      .map((block) => block.text.trim()),
  ].filter(Boolean).join('\n')
}

export function hasMiniMaxH3DirectorBuilderContent(state: MiniMaxH3DirectorBuilderState) {
  if (state.mode === 'REF2VA') {
    return [
      state.ref.subject_definitions,
      state.ref.summary,
      state.ref.retention_analysis,
      state.ref.detailed_description,
      state.ref.soundscape,
      state.ref.music === 'N/A' ? '' : state.ref.music,
    ].some((value) => value.trim().length > 0)
  }
  return [state.imd, state.soundscape, state.music === 'N/A' ? '' : state.music]
    .some((value) => value.trim().length > 0)
}

/**
 * Read builder state using the node input first, then the timeline copy, then a
 * lossless legacy-prompt conversion. Unknown future keys are retained.
 */
export function normalizeMiniMaxH3DirectorBuilderState(
  value: unknown,
  timeline: MiniMaxH3DirectorTimeline,
  mode: MiniMaxH3DirectorMode,
  duration: number,
  legacyPrompt: unknown = '',
): MiniMaxH3DirectorBuilderState {
  const source = parseBuilderStateRecord(value)
    ?? parseBuilderStateRecord(timeline.builder_state)
    ?? {}
  const sourceRef = isRecord(source.ref) ? source.ref : {}
  const defaults = createMiniMaxH3DirectorBuilderState(mode, duration)
  const normalized: MiniMaxH3DirectorBuilderState = {
    ...defaults,
    ...source,
    version: mode === 'REF2VA' ? 2 : 1,
    mode,
    duration,
    imd: asString(source.imd),
    soundscape: asString(source.soundscape),
    music: typeof source.music === 'string' ? source.music : 'N/A',
    ref: {
      ...defaults.ref,
      ...sourceRef,
      subject_definitions: asString(sourceRef.subject_definitions),
      summary: asString(sourceRef.summary),
      retention_analysis: asString(sourceRef.retention_analysis),
      detailed_description: asString(sourceRef.detailed_description),
      soundscape: asString(sourceRef.soundscape),
      music: typeof sourceRef.music === 'string' ? sourceRef.music : 'N/A',
    },
  }

  if (!normalized.ref.subject_definitions.trim() && Array.isArray(normalized.ref.subject_defs)) {
    normalized.ref.subject_definitions = normalized.ref.subject_defs
      .flatMap((definition) => isRecord(definition) && typeof definition.text === 'string' ? [definition.text.trim()] : [])
      .filter(Boolean)
      .join('\n')
  }
  if (!normalized.ref.summary.trim() && typeof normalized.ref.summary_text === 'string' && normalized.ref.summary_text.trim()) {
    const types = Array.isArray(normalized.ref.summary_types)
      ? normalized.ref.summary_types.filter((type): type is string => typeof type === 'string' && type.trim().length > 0)
      : []
    normalized.ref.summary = `[${types.join(' + ') || 'reference generation'}] ${normalized.ref.summary_text.trim()}`
  }
  if (!normalized.ref.retention_analysis.trim() && Array.isArray(normalized.ref.retention)) {
    normalized.ref.retention_analysis = normalized.ref.retention
      .flatMap((entry) => {
        if (!isRecord(entry)) return []
        const label = asString(entry.label).trim()
        const marker = asString(entry.marker).trim()
        if (!label || !marker) return []
        const context = asString(entry.context).trim()
        const note = asString(entry.note).trim()
        return [`${label}${context ? ` (${context})` : ''}: ${marker} - ${note}`]
      })
      .join('\n')
  }
  if (!normalized.ref.detailed_description.trim()) {
    normalized.ref.detailed_description = [normalized.ref.style_line, normalized.ref.detail]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .map((part) => part.trim())
      .join('\n')
  }

  const legacy = buildLegacyPrompt(legacyPrompt, timeline)
  if (legacy) {
    if (mode === 'REF2VA' && !normalized.ref.detailed_description.trim()) {
      normalized.ref.detailed_description = legacy
    } else if (mode !== 'REF2VA' && !normalized.imd.trim()) {
      normalized.imd = legacy
    }
  }
  return normalized
}

function alignMiniMaxFrameCount(frameCount: number) {
  let aligned = Math.max(5, Math.trunc(frameCount))
  while (aligned % 17 !== 5) aligned += 1
  return aligned
}

function formatMiniMaxAlignedSeconds(duration: number) {
  const seconds = alignMiniMaxFrameCount(Math.trunc(duration * 24)) / 24
  return (Math.round(seconds * 100) / 100).toFixed(2)
}

/** Build the same canonical prompt text as DaSiWa's Python prompt helper. */
export function buildMiniMaxH3DirectorPrompt(state: MiniMaxH3DirectorBuilderState) {
  if (state.mode === 'REF2VA') {
    return [
      `subject_definitions:\n${state.ref.subject_definitions.trim()}`,
      `summary:\n${state.ref.summary.trim()}`,
      `retention_analysis:\n${state.ref.retention_analysis.trim()}`,
      `detailed_description:\n${state.ref.detailed_description.trim()}`,
      `overall_soundscape:\n${state.ref.soundscape.trim()}`,
      `non_diegetic_music:\n${state.ref.music.trim() || 'N/A'}`,
    ].join('\n\n')
  }

  const end = formatMiniMaxAlignedSeconds(state.duration)
  const alignment = state.mode === 'I2VA'
    ? 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'
    : state.mode === 'FL2VA'
      ? `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 2) aligns with the ${end}-second mark of the target video.`
      : state.mode === 'L2VA'
        ? `How the reference pictures align with the target video — <Picture 1> (from [Shot 1]) aligns with the ${end}-second mark of the target video.`
        : ''
  const body = [
    `integrated_multimodal_description: ${state.imd.trim()}`,
    `overall_soundscape: ${state.soundscape.trim()}`,
    `non_diegetic_music: ${state.music.trim() || 'N/A'}`,
  ].join('\n\n')
  return alignment ? `${alignment}\n\n${body}` : body
}

/** Prefill REF2VA labels from the actual streams that the Director will consume. */
export function prefillMiniMaxH3DirectorRefBuilder(
  state: MiniMaxH3DirectorBuilderState,
  items: MiniMaxH3DirectorTimelineItem[],
): MiniMaxH3DirectorBuilderState {
  const ordered = items.filter((item) => item.enabled !== false).sort((left, right) => left.order - right.order)
  const pictures = ordered.filter((item) => item.type === 'image')
  const videos = ordered.filter((item) => item.type === 'video' && item.media_mode !== 'audio')
  const audios = ordered.filter((item) => item.type === 'audio' || (item.type === 'video' && item.media_mode !== 'video'))
  const definitions = [
    ...pictures.map((_, index) => `<Picture ${index + 1}> is the opening-frame anchor.`),
    ...videos.map((_, index) => `<Video ${index + 1}> provides the camera path and pacing structure.`),
    ...audios.map((_, index) => `<Audio ${index + 1}> is the voice-timbre and audio reference.`),
  ]
  const refs = [
    ...pictures.map((_, index) => `<Picture ${index + 1}>`),
    ...videos.map((_, index) => `<Video ${index + 1}>`),
    ...audios.map((_, index) => `<Audio ${index + 1}>`),
  ]
  const taskTypes = [
    pictures.length > 0 ? 'reference generation' : '',
    videos.length > 0 ? 'video editing' : '',
    audios.length > 0 ? 'audio reference' : '',
  ].filter(Boolean)
  return {
    ...state,
    ref: {
      ...state.ref,
      subject_definitions: definitions.join('\n'),
      summary: `${taskTypes.length > 0 ? `[${taskTypes.join(' + ')}] ` : ''}Use ${refs.join(', ')}.`,
    },
  }
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

    const { builder_state: rawBuilderState, ...timelineSource } = parsed
    return {
      timeline: {
        ...timelineSource,
        version: 1,
        items,
        prompt_blocks: promptBlocks,
        ...(isRecord(rawBuilderState) ? { builder_state: rawBuilderState } : {}),
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
  mode: MiniMaxH3DirectorMode | MiniMaxH3DirectorInputLink
  prompt: string | MiniMaxH3DirectorInputLink
  width: number | MiniMaxH3DirectorInputLink
  height: number | MiniMaxH3DirectorInputLink
  duration: number | MiniMaxH3DirectorInputLink
  ref_image_size: 'match' | 'max' | MiniMaxH3DirectorInputLink
  timeline_data: string | MiniMaxH3DirectorInputLink
  builder_state: string | MiniMaxH3DirectorInputLink
} {
  const source = isRecord(value) ? value : {}
  return {
    ...source,
    mode: isMiniMaxH3DirectorInputLink(source.mode) ? source.mode : isMiniMaxH3DirectorMode(source.mode) ? source.mode : 'FL2VA',
    prompt: isMiniMaxH3DirectorInputLink(source.prompt) ? source.prompt : typeof source.prompt === 'string' ? source.prompt : '',
    width: isMiniMaxH3DirectorInputLink(source.width) ? source.width : asFiniteNumber(source.width, 1344),
    height: isMiniMaxH3DirectorInputLink(source.height) ? source.height : asFiniteNumber(source.height, 768),
    duration: isMiniMaxH3DirectorInputLink(source.duration) ? source.duration : asFiniteNumber(source.duration, 5),
    ref_image_size: isMiniMaxH3DirectorInputLink(source.ref_image_size) ? source.ref_image_size : source.ref_image_size === 'max' ? 'max' : 'match',
    timeline_data: isMiniMaxH3DirectorInputLink(source.timeline_data)
      ? source.timeline_data
      : typeof source.timeline_data === 'string'
        ? source.timeline_data
        : JSON.stringify(DEFAULT_TIMELINE),
    builder_state: isMiniMaxH3DirectorInputLink(source.builder_state)
      ? source.builder_state
      : typeof source.builder_state === 'string'
        ? source.builder_state
        : '',
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
  builderState?: MiniMaxH3DirectorBuilderState,
): Record<string, unknown> {
  const current = normalizeMiniMaxH3DirectorNodeValue(currentValue)
  const currentMeta = isRecord(current[MINIMAX_H3_DIRECTOR_META_KEY]) ? current[MINIMAX_H3_DIRECTOR_META_KEY] : {}
  const nextModeValue = inputPatch.mode ?? current.mode
  const nextMode = isMiniMaxH3DirectorMode(nextModeValue)
    ? nextModeValue
    : builderState?.mode ?? 'FL2VA'
  const nextDurationValue = inputPatch.duration ?? current.duration
  const nextDuration = isMiniMaxH3DirectorInputLink(nextDurationValue)
    ? builderState?.duration ?? 5
    : asFiniteNumber(nextDurationValue, 5)
  const currentTimeline = isMiniMaxH3DirectorInputLink(current.timeline_data)
    ? structuredClone(DEFAULT_TIMELINE)
    : parseMiniMaxH3DirectorTimeline(current.timeline_data).timeline
  const nextTimeline = timeline ? syncMiniMaxH3DirectorPromptBlocks(timeline) : currentTimeline
  const nextPrompt = inputPatch.prompt ?? current.prompt
  const normalizedBuilder = normalizeMiniMaxH3DirectorBuilderState(
    builderState
      ?? ('builder_state' in inputPatch ? inputPatch.builder_state : null)
      ?? (isMiniMaxH3DirectorInputLink(current.builder_state) ? null : current.builder_state),
    nextTimeline,
    nextMode,
    nextDuration,
    isMiniMaxH3DirectorInputLink(nextPrompt) ? '' : nextPrompt,
  )
  const timelineData = isMiniMaxH3DirectorInputLink(current.timeline_data) && !timeline
    ? current.timeline_data
    : JSON.stringify({ ...nextTimeline, builder_state: normalizedBuilder })
  const builderStateValue = isMiniMaxH3DirectorInputLink(current.builder_state) && !builderState && !('builder_state' in inputPatch)
    ? current.builder_state
    : JSON.stringify(normalizedBuilder)

  return {
    ...current,
    ...inputPatch,
    timeline_data: timelineData,
    builder_state: builderStateValue,
    [MINIMAX_H3_DIRECTOR_META_KEY]: {
      ...currentMeta,
      assets: assets ?? getMiniMaxH3DirectorAssets(current),
    },
  }
}

/** Return items that the DaSiWa backend will consume for the selected mode. */
export function getMiniMaxH3DirectorActiveItems(value: unknown) {
  const nodeValue = normalizeMiniMaxH3DirectorNodeValue(value)
  if (isMiniMaxH3DirectorInputLink(nodeValue.timeline_data)) {
    return []
  }
  const items = parseMiniMaxH3DirectorTimeline(nodeValue.timeline_data).timeline.items
    .filter((item) => item.enabled !== false)
    .sort((left, right) => left.order - right.order)

  if (isMiniMaxH3DirectorInputLink(nodeValue.mode) || nodeValue.mode === 'REF2VA') {
    return items
  }
  if (nodeValue.mode === 'T2VA') {
    return []
  }
  const frameSlots = nodeValue.mode === 'I2VA' ? [0] : nodeValue.mode === 'L2VA' ? [1] : [0, 1]
  return items
    .filter((item) => item.type === 'image' && frameSlots.includes(item.slot))
    .sort((left, right) => left.slot - right.slot)
    .slice(0, frameSlots.length)
}

function getSelectedDuration(item: MiniMaxH3DirectorTimelineItem) {
  if (item.type === 'image') {
    return 0
  }

  const trimStart = asFiniteNumber(item.trim_start, 0)
  const trimEnd = item.trim_end == null ? asFiniteNumber(item.source_duration, item.duration) : asFiniteNumber(item.trim_end, item.duration)
  return trimEnd - trimStart
}

/** Validate Director inputs against the actual DaSiWa five-mode contract. */
export function validateMiniMaxH3DirectorNodeValue(value: unknown): MiniMaxH3DirectorIssue[] {
  const nodeValue = normalizeMiniMaxH3DirectorNodeValue(value)
  const issues: MiniMaxH3DirectorIssue[] = []
  const timelineLinked = isMiniMaxH3DirectorInputLink(nodeValue.timeline_data)

  if (!isMiniMaxH3DirectorInputLink(nodeValue.duration) && (
    !Number.isInteger(nodeValue.duration)
    || nodeValue.duration < MINIMAX_H3_DIRECTOR_DURATION_MIN_SECONDS
    || nodeValue.duration > MINIMAX_H3_DIRECTOR_DURATION_MAX_SECONDS
  )) {
    issues.push({ code: 'duration-range', field: 'duration', ko: '영상 길이는 1~60초 정수여야 해.', en: 'Duration must be an integer from 1 to 60 seconds.' })
  }

  const staticMode = isMiniMaxH3DirectorInputLink(nodeValue.mode) ? null : nodeValue.mode
  const selectedModelInput = staticMode === 'REF2VA' ? nodeValue.ref2va_model : staticMode ? nodeValue.fl2va_model : null
  if (staticMode && !isMiniMaxH3DirectorInputLink(selectedModelInput)) {
    issues.push({
      code: 'selected-model-connection',
      ko: `워크플로 수정 필요: ${nodeValue.mode} 모델 연결이 없어.`,
      en: `Workflow update required: the ${nodeValue.mode} model is not connected.`,
    })
  }

  if (timelineLinked) {
    return issues
  }

  const parsedTimeline = parseMiniMaxH3DirectorTimeline(nodeValue.timeline_data)
  if (parsedTimeline.error) {
    issues.push({ code: 'timeline-json', field: 'timeline', ko: '타임라인 데이터가 올바른 JSON이 아니야.', en: 'Timeline data is not valid JSON.' })
    return issues
  }

  const activeItems = getMiniMaxH3DirectorActiveItems(nodeValue)
  for (const item of activeItems) {
    if (!item.value.trim()) {
      issues.push({ code: 'missing-value', itemId: item.id, ko: '참조 미디어 파일이 비어 있어.', en: 'A reference media file is missing.' })
    }
  }

  if (staticMode && !isMiniMaxH3DirectorInputLink(nodeValue.builder_state)) {
    const builderRaw = nodeValue.builder_state.trim()
    if (builderRaw) {
      try {
        if (!isRecord(JSON.parse(builderRaw))) throw new Error('builder_state must contain an object')
      } catch {
        issues.push({ code: 'builder-json', field: 'prompt', ko: '프롬프트 빌더 데이터가 올바른 JSON이 아니야.', en: 'Prompt builder data is not valid JSON.' })
      }
    }
  }

  if (staticMode === null || staticMode !== 'REF2VA') {
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
