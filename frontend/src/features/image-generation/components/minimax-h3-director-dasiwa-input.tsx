import { useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'
import { Film, Music2, Plus, RotateCcw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import {
  buildWorkflowInputAssetUrl,
  deleteWorkflowInputAsset,
  uploadWorkflowInputAsset,
  type WorkflowInputAssetRef,
} from '@/lib/api-workflow-input-assets'
import type { WorkflowNodeNumericBounds } from '@/lib/api-image-generation-types'
import { cn } from '@/lib/utils'
import { FormField } from '../image-generation-shared'
import {
  buildMiniMaxH3DirectorNodeValue,
  createMiniMaxH3DirectorItemId,
  createMiniMaxH3DirectorBuilderState,
  getMiniMaxH3DirectorAssets,
  hasMiniMaxH3DirectorBuilderContent,
  inferMiniMaxH3DirectorMediaType,
  isMiniMaxH3DirectorInputLink,
  MINIMAX_H3_DIRECTOR_DURATION_MAX_SECONDS,
  MINIMAX_H3_DIRECTOR_DURATION_MIN_SECONDS,
  MINIMAX_H3_DIRECTOR_FRAME_RATE_MAX,
  MINIMAX_H3_DIRECTOR_FRAME_RATE_MIN,
  MINIMAX_H3_DIRECTOR_MODES,
  MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS,
  normalizeMiniMaxH3DirectorPostprocess,
  normalizeMiniMaxH3DirectorResolution,
  normalizeMiniMaxH3DirectorBuilderState,
  normalizeMiniMaxH3DirectorNodeValue,
  parseMiniMaxH3DirectorTimeline,
  resolveMiniMaxH3DirectorCanvas,
  validateMiniMaxH3DirectorNodeValue,
  type MiniMaxH3DirectorBuilderState,
  type MiniMaxH3DirectorGraphInputKey,
  type MiniMaxH3DirectorMediaType,
  type MiniMaxH3DirectorMode,
  type MiniMaxH3DirectorTimeline,
  type MiniMaxH3DirectorTimelineItem,
  type MiniMaxH3DirectorVideoMode,
  type MiniMaxH3DirectorVisibleField,
} from './minimax-h3-director-dasiwa-utils'
import { MiniMaxH3DirectorMediaCard } from './minimax-h3-director-media-card'
import { MiniMaxH3DirectorPostprocessPanel } from './minimax-h3-director-postprocess-panel'
import { MiniMaxH3DirectorPromptBuilder } from './minimax-h3-director-prompt-builder'
import { MiniMaxH3DirectorResolutionPanel } from './minimax-h3-director-resolution-panel'

const MAX_MEDIA_COUNT = { image: 9, video: 3, audio: 3, total: 12 } as const
const MAX_AUDIO_WAVEFORM_DECODE_BYTES = 64 * 1024 * 1024
const INPAINT_MODE_BACKUP_KEY = '__conai_inpaint_mode_backup'

type MediaLane = 'visual' | 'audio'

type MiniMaxH3DirectorDasiwaInputProps = {
  value: Record<string, unknown>
  visibleFields?: string[]
  numericBounds?: WorkflowNodeNumericBounds
  onChange: (value: Record<string, unknown>) => void
  renderInputPort?: (inputKey: MiniMaxH3DirectorGraphInputKey) => ReactNode
}

function getMediaLane(item: MiniMaxH3DirectorTimelineItem): MediaLane {
  return item.type === 'audio' ? 'audio' : 'visual'
}

function getNextMediaSlot(items: MiniMaxH3DirectorTimelineItem[], lane: MediaLane, capacity: number) {
  const occupied = new Set(items.filter((item) => getMediaLane(item) === lane).map((item) => item.slot))
  return Array.from({ length: capacity }, (_, index) => index).find((index) => !occupied.has(index)) ?? null
}

/** Read browser media metadata without retaining an object URL. */
async function probeMediaDuration(file: File, type: MiniMaxH3DirectorMediaType) {
  if (type === 'image') {
    return null
  }

  const media = document.createElement(type === 'video' ? 'video' : 'audio')
  const objectUrl = URL.createObjectURL(file)
  media.preload = 'metadata'
  media.src = objectUrl

  try {
    return await new Promise<number | null>((resolve) => {
      media.onloadedmetadata = () => resolve(Number.isFinite(media.duration) ? media.duration : null)
      media.onerror = () => resolve(null)
    })
  } finally {
    media.removeAttribute('src')
    media.load()
    URL.revokeObjectURL(objectUrl)
  }
}

/** Read image/video intrinsic dimensions for Auto aspect without retaining an object URL. */
async function probeMediaDimensions(file: File, type: MiniMaxH3DirectorMediaType) {
  if (type !== 'image' && type !== 'video') return null
  const media = document.createElement(type === 'video' ? 'video' : 'img')
  const objectUrl = URL.createObjectURL(file)
  media.src = objectUrl
  if (media instanceof HTMLVideoElement) media.preload = 'metadata'

  try {
    return await new Promise<{ source_width: number; source_height: number } | null>((resolve) => {
      const complete = () => {
        const sourceWidth = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth
        const sourceHeight = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight
        resolve(sourceWidth > 0 && sourceHeight > 0 ? { source_width: sourceWidth, source_height: sourceHeight } : null)
      }
      if (media instanceof HTMLVideoElement) media.onloadedmetadata = complete
      else media.onload = complete
      media.onerror = () => resolve(null)
    })
  } finally {
    if (media instanceof HTMLVideoElement) {
      media.removeAttribute('src')
      media.load()
    } else {
      media.removeAttribute('src')
    }
    URL.revokeObjectURL(objectUrl)
  }
}

/** Decode a compact standalone-audio waveform for a visual crop reference. */
async function extractAudioWaveformPeaks(file: File) {
  if (typeof AudioContext === 'undefined' || file.size > MAX_AUDIO_WAVEFORM_DECODE_BYTES) {
    return []
  }

  const audioContext = new AudioContext()
  try {
    const buffer = await audioContext.decodeAudioData(await file.arrayBuffer())
    const channel = buffer.getChannelData(0)
    const peakCount = 64
    const step = Math.max(1, Math.floor(channel.length / peakCount))
    return Array.from({ length: peakCount }, (_, index) => {
      let peak = 0
      const end = Math.min(channel.length, (index + 1) * step)
      for (let sample = index * step; sample < end; sample += 1) {
        peak = Math.max(peak, Math.abs(channel[sample] ?? 0))
      }
      return peak
    })
  } catch {
    return []
  } finally {
    void audioContext.close()
  }
}

function formatMediaTypeLabel(type: MiniMaxH3DirectorMediaType, index: number) {
  if (type === 'image') return `Picture ${index}`
  if (type === 'video') return `Video ${index}`
  return `Audio ${index}`
}

/** Render DaSiWa MiniMax H3 Director inputs as a CoNAI-native reference board. */
export function MiniMaxH3DirectorDasiwaInput({ value, visibleFields, numericBounds, onChange, renderInputPort }: MiniMaxH3DirectorDasiwaInputProps) {
  const { t } = useI18n()
  const visualInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const replacementInputRef = useRef<HTMLInputElement>(null)
  const requestedFrameSlotRef = useRef<number | null>(null)
  const [menuItemId, setMenuItemId] = useState<string | null>(null)
  const [replacementItemId, setReplacementItemId] = useState<string | null>(null)
  const [sortingItemId, setSortingItemId] = useState<string | null>(null)
  const [selectedLane, setSelectedLane] = useState<MediaLane>('visual')
  const [status, setStatus] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const nodeValue = normalizeMiniMaxH3DirectorNodeValue(value)
  const mode: MiniMaxH3DirectorMode | null = isMiniMaxH3DirectorInputLink(nodeValue.mode) ? null : nodeValue.mode
  const parsedTimeline = parseMiniMaxH3DirectorTimeline(isMiniMaxH3DirectorInputLink(nodeValue.timeline_data) ? '' : nodeValue.timeline_data)
  const timeline = parsedTimeline.timeline
  const resolution = normalizeMiniMaxH3DirectorResolution(timeline.resolution)
  const postprocess = normalizeMiniMaxH3DirectorPostprocess(timeline.postprocess)
  const resolvedCanvas = resolveMiniMaxH3DirectorCanvas(timeline, resolution)
  const promptValue = isMiniMaxH3DirectorInputLink(nodeValue.prompt) ? '' : nodeValue.prompt
  const widthValue = isMiniMaxH3DirectorInputLink(nodeValue.width) ? '' : String(nodeValue.width)
  const heightValue = isMiniMaxH3DirectorInputLink(nodeValue.height) ? '' : String(nodeValue.height)
  const durationValue = isMiniMaxH3DirectorInputLink(nodeValue.duration) ? '' : String(nodeValue.duration)
  const frameRateValue = isMiniMaxH3DirectorInputLink(nodeValue.frame_rate) ? '' : String(nodeValue.frame_rate)
  const builderMode = mode ?? (
    !isMiniMaxH3DirectorInputLink(nodeValue.builder_state)
      ? (() => {
          try {
            const parsed = JSON.parse(nodeValue.builder_state) as { mode?: unknown }
            return MINIMAX_H3_DIRECTOR_MODES.includes(parsed.mode as MiniMaxH3DirectorMode) ? parsed.mode as MiniMaxH3DirectorMode : 'FL2VA'
          } catch {
            return 'FL2VA'
          }
        })()
      : 'FL2VA'
  )
  const builderDuration = isMiniMaxH3DirectorInputLink(nodeValue.duration) ? 5 : nodeValue.duration
  const builderState = normalizeMiniMaxH3DirectorBuilderState(
    isMiniMaxH3DirectorInputLink(nodeValue.builder_state) ? null : nodeValue.builder_state,
    timeline,
    builderMode,
    builderDuration,
    promptValue,
  )
  const refImageSizeValue = isMiniMaxH3DirectorInputLink(nodeValue.ref_image_size) ? '' : nodeValue.ref_image_size
  const visibleFieldSet = useMemo(
    () => new Set<MiniMaxH3DirectorVisibleField>(
      visibleFields == null
        ? MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS
        : visibleFields.filter((field): field is MiniMaxH3DirectorVisibleField => MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS.includes(field as MiniMaxH3DirectorVisibleField)),
    ),
    [visibleFields],
  )
  const isFieldVisible = (field: MiniMaxH3DirectorVisibleField) => visibleFieldSet.has(field)
  const assets = getMiniMaxH3DirectorAssets(nodeValue)
  const activeItems = timeline.items.filter((item) => item.enabled !== false)
  const displayedItems = mode === null || mode === 'REF2VA'
    ? activeItems
    : mode === 'T2VA'
      ? []
      : mode === 'Image Inpaint'
        ? activeItems.filter((item) => item.type === 'image').sort((left, right) => left.slot - right.slot || left.order - right.order).slice(0, 1)
      : activeItems
          .filter((item) => item.type === 'image' && (
            mode === 'I2VA' ? item.slot === 0 : mode === 'L2VA' ? item.slot === 1 : item.slot === 0 || item.slot === 1
          ))
          .sort((left, right) => left.slot - right.slot)
          .slice(0, mode === 'FL2VA' ? 2 : 1)
  const visualItems = displayedItems.filter((item) => item.type !== 'audio').sort((left, right) => left.slot - right.slot)
  const audioItems = mode === null || mode === 'REF2VA'
    ? displayedItems.filter((item) => item.type === 'audio').sort((left, right) => left.slot - right.slot)
    : []
  const issues = useMemo(() => validateMiniMaxH3DirectorNodeValue(value), [value])
  const issueItemIds = useMemo(() => new Set(issues.flatMap((issue) => issue.itemId ? [issue.itemId] : [])), [issues])
  const invalidFields = useMemo(() => new Set(issues.flatMap((issue) => issue.field ? [issue.field] : [])), [issues])

  const emit = (
    inputPatch: Record<string, unknown>,
    nextTimeline?: MiniMaxH3DirectorTimeline,
    nextAssets = assets,
    nextBuilderState?: MiniMaxH3DirectorBuilderState,
  ) => {
    onChange(buildMiniMaxH3DirectorNodeValue(nodeValue, inputPatch, nextTimeline, nextAssets, nextBuilderState))
  }

  const updateBuilderState = (nextBuilderState: MiniMaxH3DirectorBuilderState) => {
    emit({}, undefined, assets, nextBuilderState)
  }

  const updateResolution = (nextResolution: typeof resolution) => {
    emit({}, { ...timeline, resolution: nextResolution })
  }

  const updatePostprocess = (nextPostprocess: typeof postprocess) => {
    emit({}, { ...timeline, postprocess: nextPostprocess })
  }

  const changeMode = (nextMode: MiniMaxH3DirectorMode) => {
    if (nextMode !== 'REF2VA') setSelectedLane('visual')
    let nextTimeline = timeline
    if (nextMode === 'Image Inpaint' && mode !== 'Image Inpaint') {
      const selectedImageId = activeItems
        .filter((item) => item.type === 'image')
        .sort((left, right) => left.slot - right.slot || left.order - right.order)[0]?.id
      nextTimeline = {
        ...timeline,
        items: timeline.items.map((item) => ({
          ...item,
          enabled: item.id === selectedImageId,
          ...(item.id === selectedImageId ? { slot: 0, start: 0 } : {}),
          [INPAINT_MODE_BACKUP_KEY]: {
            enabled: item.enabled,
            slot: item.slot,
            start: item.start,
          },
        })),
      }
    } else if (mode === 'Image Inpaint' && nextMode !== 'Image Inpaint') {
      nextTimeline = {
        ...timeline,
        items: timeline.items.map((item) => {
          const backup = item[INPAINT_MODE_BACKUP_KEY]
          if (!backup || typeof backup !== 'object' || Array.isArray(backup)) return item
          const restored: MiniMaxH3DirectorTimelineItem = {
            ...item,
            enabled: (backup as Record<string, unknown>).enabled !== false,
            slot: Number((backup as Record<string, unknown>).slot ?? item.slot),
            start: Number((backup as Record<string, unknown>).start ?? item.start),
          }
          delete restored[INPAINT_MODE_BACKUP_KEY]
          return restored
        }),
      }
    }
    emit({ mode: nextMode }, nextTimeline, assets, { ...builderState, mode: nextMode, version: nextMode === 'REF2VA' ? 2 : 1 })
  }


  const cleanupAssets = (removableAssets: WorkflowInputAssetRef[]) => {
    void Promise.all(removableAssets.map((asset) => deleteWorkflowInputAsset(asset.id))).catch((error) => {
      setStatus(error instanceof Error ? error.message : t({ ko: '일부 미디어 자산 정리에 실패했어.', en: 'Failed to clean up some media assets.' }))
    })
  }

  const updateTimelineItem = (itemId: string, patch: Partial<MiniMaxH3DirectorTimelineItem>) => {
    emit({}, {
      ...timeline,
      items: timeline.items.map((item) => item.id === itemId ? { ...item, ...patch } : item),
    })
  }

  const removeTimelineItems = (itemIds: Set<string>) => {
    if (itemIds.size === 0) return
    const removableAssets = Array.from(itemIds).flatMap((itemId) => assets[itemId] ? [assets[itemId]] : [])
    const nextAssets = { ...assets }
    for (const itemId of itemIds) delete nextAssets[itemId]
    emit({}, {
      ...timeline,
      items: timeline.items.filter((item) => !itemIds.has(item.id)),
    }, nextAssets)
    setMenuItemId(null)
    cleanupAssets(removableAssets)
  }

  const removeTimelineItem = (itemId: string) => removeTimelineItems(new Set([itemId]))

  const clearLane = (lane: MediaLane) => {
    removeTimelineItems(new Set(timeline.items.filter((item) => getMediaLane(item) === lane).map((item) => item.id)))
  }

  const clearTimeline = () => {
    const clearMedia = isFieldVisible('timeline_data')
    const removableAssets = clearMedia ? Object.values(assets) : []
    setMenuItemId(null)
    emit(
      isFieldVisible('prompt') ? { prompt: '' } : {},
      clearMedia ? { ...timeline, items: [], prompt_blocks: [] } : undefined,
      clearMedia ? {} : assets,
      isFieldVisible('prompt') ? createMiniMaxH3DirectorBuilderState(builderMode, builderDuration) : undefined,
    )
    cleanupAssets(removableAssets)
  }

  const canAcceptFile = (type: MiniMaxH3DirectorMediaType, items: MiniMaxH3DirectorTimelineItem[]) => {
    if (mode && mode !== 'REF2VA') {
      if (mode === 'T2VA' || type !== 'image') return false
      const frameSlots = mode === 'I2VA' || mode === 'Image Inpaint' ? [0] : mode === 'L2VA' ? [1] : [0, 1]
      const occupiedSlots = new Set(items.filter((item) => item.enabled !== false && item.type === 'image').map((item) => item.slot))
      return frameSlots.some((slot) => !occupiedSlots.has(slot))
    }

    const typeCount = items.filter((item) => item.enabled !== false && item.type === type).length
    return typeCount < MAX_MEDIA_COUNT[type] && items.filter((item) => item.enabled !== false).length < MAX_MEDIA_COUNT.total
  }

  const validateFileForLane = (file: File, lane: MediaLane) => {
    const type = inferMiniMaxH3DirectorMediaType(file)
    const laneMatches = lane === 'audio' ? type === 'audio' : type === 'image' || type === 'video'
    if (!type || !laneMatches || (mode && mode !== 'REF2VA' && type !== 'image') || mode === 'T2VA') {
      setStatus(mode && mode !== 'REF2VA'
        ? t({ ko: '선택한 기본 모드에는 지정된 이미지 프레임만 사용할 수 있어.', en: 'The selected base mode accepts only its designated image frame.' })
        : t({ ko: '선택한 레인에 맞는 미디어 파일을 골라줘.', en: 'Choose media that matches the selected lane.' }))
      return null
    }
    return type
  }

  const handleFiles = async (files: File[], lane: MediaLane, requestedFrameSlot?: number | null) => {
    if (files.length === 0 || isUploading) return

    setIsUploading(true)
    let nextTimeline: MiniMaxH3DirectorTimeline = { ...timeline, items: [...timeline.items] }
    const nextAssets = { ...assets }
    let hasChanges = false

    try {
      for (const file of files) {
        const type = validateFileForLane(file, lane)
        if (!type) continue
        if (!canAcceptFile(type, nextTimeline.items)) {
          setStatus(mode && mode !== 'REF2VA'
            ? t({ ko: '선택한 모드의 프레임 슬롯이 이미 찼어.', en: 'The selected mode frame slots are already full.' })
            : t({ ko: 'REF2VA 참조 개수 제한에 도달했어.', en: 'The REF2VA reference limit has been reached.' }))
          continue
        }

        const [sourceDuration, dimensions] = await Promise.all([
          probeMediaDuration(file, type),
          probeMediaDimensions(file, type),
        ])
        if (type !== 'image' && (sourceDuration === null || sourceDuration < 2)) {
          setStatus(t({ ko: '{name}: 영상·오디오는 최소 2초여야 해.', en: '{name}: Video and audio must be at least two seconds.' }, { name: file.name }))
          continue
        }

        setStatus(t({ ko: '{name} 업로드 중…', en: 'Uploading {name}…' }, { name: file.name }))
        const asset = await uploadWorkflowInputAsset(file)
        const id = createMiniMaxH3DirectorItemId(type)
        const targetLane = type === 'audio' ? 'audio' : 'visual'
        const slotCapacity = targetLane === 'audio' ? MAX_MEDIA_COUNT.audio : MAX_MEDIA_COUNT.image + MAX_MEDIA_COUNT.video
        const occupiedImageSlots = new Set(nextTimeline.items.filter((item) => item.enabled !== false && item.type === 'image').map((item) => item.slot))
        const availableFrameSlots = mode === 'L2VA' ? [1] : mode === 'I2VA' || mode === 'Image Inpaint' ? [0] : [0, 1]
        const requestedSlot = requestedFrameSlot != null
          && availableFrameSlots.includes(requestedFrameSlot)
          && !occupiedImageSlots.has(requestedFrameSlot)
          ? requestedFrameSlot
          : null
        const slot = mode && mode !== 'REF2VA'
          ? requestedSlot ?? availableFrameSlots.find((candidate) => !occupiedImageSlots.has(candidate)) ?? null
          : getNextMediaSlot(nextTimeline.items, targetLane, slotCapacity)
        if (slot === null) {
          void deleteWorkflowInputAsset(asset.id).catch(() => undefined)
          setStatus(t({ ko: '선택한 레인에 빈 슬롯이 없어.', en: 'There is no free slot in the selected lane.' }))
          continue
        }

        const duration = sourceDuration === null ? 1 : Math.min(sourceDuration, 15)
        const waveformPeaks = type === 'audio' ? await extractAudioWaveformPeaks(file) : []
        const item: MiniMaxH3DirectorTimelineItem = {
          id,
          type,
          value: asset.fileName,
          enabled: true,
          order: nextTimeline.items.length,
          slot,
          start: slot,
          duration,
          ...(dimensions ?? {}),
          ...(sourceDuration !== null ? { source_duration: sourceDuration } : {}),
          ...(type === 'video' ? { media_mode: 'video' as const } : {}),
          ...(type === 'video' || type === 'audio' ? { trim_start: 0, trim_end: duration } : {}),
          ...(waveformPeaks.length > 0 ? { waveform_peaks: waveformPeaks } : {}),
        }
        nextTimeline = { ...nextTimeline, items: [...nextTimeline.items, item] }
        nextAssets[id] = asset
        hasChanges = true
        setStatus(sourceDuration !== null && sourceDuration > 15
          ? t({ ko: '{name}을 추가하고 처음 15초로 잘랐어.', en: 'Added {name} and cropped it to the first 15 seconds.' }, { name: file.name })
          : t({ ko: '{name}을 추가했어.', en: 'Added {name}.' }, { name: file.name }))
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t({ ko: '미디어 업로드에 실패했어.', en: 'Media upload failed.' }))
    } finally {
      if (hasChanges) emit({}, nextTimeline, nextAssets)
      setIsUploading(false)
    }
  }

  const replaceTimelineItem = async (itemId: string, file: File) => {
    const currentItem = timeline.items.find((item) => item.id === itemId)
    if (!currentItem || isUploading) return
    const lane = getMediaLane(currentItem)
    const type = validateFileForLane(file, lane)
    if (!type) return

    setIsUploading(true)
    try {
      const [sourceDuration, dimensions] = await Promise.all([
        probeMediaDuration(file, type),
        probeMediaDimensions(file, type),
      ])
      if (type !== 'image' && (sourceDuration === null || sourceDuration < 2)) {
        setStatus(t({ ko: '{name}: 영상·오디오는 최소 2초여야 해.', en: '{name}: Video and audio must be at least two seconds.' }, { name: file.name }))
        return
      }

      setStatus(t({ ko: '{name} 교체 업로드 중…', en: 'Uploading replacement {name}…' }, { name: file.name }))
      const asset = await uploadWorkflowInputAsset(file)
      const duration = sourceDuration === null ? 1 : Math.min(sourceDuration, 15)
      const waveformPeaks = type === 'audio' ? await extractAudioWaveformPeaks(file) : []
      const stableItem = { ...currentItem }
      delete stableItem.source_duration
      delete stableItem.trim_start
      delete stableItem.trim_end
      delete stableItem.media_mode
      delete stableItem.waveform_peaks
      delete stableItem.source_width
      delete stableItem.source_height
      const nextItem: MiniMaxH3DirectorTimelineItem = {
        ...stableItem,
        type,
        value: asset.fileName,
        duration,
        ...(dimensions ?? {}),
        ...(sourceDuration !== null ? { source_duration: sourceDuration } : {}),
        ...(type === 'video' ? { media_mode: 'video' as const, trim_start: 0, trim_end: duration } : {}),
        ...(type === 'audio' ? { trim_start: 0, trim_end: duration } : {}),
        ...(waveformPeaks.length > 0 ? { waveform_peaks: waveformPeaks } : {}),
      }
      const previousAsset = assets[itemId]
      emit({}, {
        ...timeline,
        items: timeline.items.map((item) => item.id === itemId ? nextItem : item),
      }, { ...assets, [itemId]: asset })
      setMenuItemId(null)
      setStatus(t({ ko: '{name}(으)로 교체했어.', en: 'Replaced with {name}.' }, { name: file.name }))
      if (previousAsset) cleanupAssets([previousAsset])
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t({ ko: '미디어 교체에 실패했어.', en: 'Failed to replace media.' }))
    } finally {
      setIsUploading(false)
    }
  }

  const handleLaneDrop = (event: DragEvent<HTMLElement>, lane: MediaLane, requestedFrameSlot?: number | null) => {
    event.preventDefault()
    void handleFiles(Array.from(event.dataTransfer.files), lane, requestedFrameSlot)
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) {
      for (const item of Array.from(event.clipboardData.items)) {
        if (item.kind !== 'file') continue
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length === 0) return

    event.preventDefault()
    event.stopPropagation()
    const selectedItem = menuItemId ? timeline.items.find((item) => item.id === menuItemId) : null
    if (selectedItem) {
      const replacement = files.find((file) => {
        const type = inferMiniMaxH3DirectorMediaType(file)
        return type && getMediaLane(selectedItem) === (type === 'audio' ? 'audio' : 'visual')
      })
      if (replacement) {
        void replaceTimelineItem(selectedItem.id, replacement)
        return
      }
    }

    void handleFiles(files, selectedLane)
  }

  const swapTimelineItems = (sourceItemId: string, targetItemId: string) => {
    if (sourceItemId === targetItemId) return
    const source = timeline.items.find((item) => item.id === sourceItemId)
    const target = timeline.items.find((item) => item.id === targetItemId)
    if (!source || !target || getMediaLane(source) !== getMediaLane(target)) return
    emit({}, {
      ...timeline,
      items: timeline.items.map((item) => {
        if (item.id === source.id) return { ...item, slot: target.slot, start: target.slot }
        if (item.id === target.id) return { ...item, slot: source.slot, start: source.slot }
        return item
      }),
    })
  }

  const moveTimelineItem = (item: MiniMaxH3DirectorTimelineItem, direction: -1 | 1) => {
    const laneItems = displayedItems.filter((candidate) => getMediaLane(candidate) === getMediaLane(item)).sort((left, right) => left.slot - right.slot)
    const index = laneItems.findIndex((candidate) => candidate.id === item.id)
    const other = laneItems[index + direction]
    if (other) swapTimelineItems(item.id, other.id)
  }

  const requestReplacement = (itemId: string) => {
    setReplacementItemId(itemId)
    setMenuItemId(null)
    window.setTimeout(() => replacementInputRef.current?.click(), 0)
  }

  const renderMediaCard = (item: MiniMaxH3DirectorTimelineItem, typeIndex: number, labelOverride?: string, inputKey?: MiniMaxH3DirectorGraphInputKey) => {
    const asset = assets[item.id]
    const sourceDuration = Math.max(2, Number(item.source_duration ?? item.duration ?? 2))
    const trimStart = Number(item.trim_start ?? 0)
    const trimEnd = Number(item.trim_end ?? sourceDuration)
    const label = labelOverride ?? formatMediaTypeLabel(item.type, typeIndex)
    return (
      <div key={item.id} className="space-y-1">
        {inputKey ? renderInputPort?.(inputKey) : null}
        <MiniMaxH3DirectorMediaCard
          item={item}
          asset={asset}
          label={label}
          hasIssue={issueItemIds.has(item.id)}
          menuOpen={menuItemId === item.id}
          disabled={isUploading}
          sorting={sortingItemId === item.id}
          replaceLabel={t({ ko: '미디어 교체', en: 'Replace media' })}
          deleteLabel={t({ ko: '삭제', en: 'Delete' })}
          menuLabel={t({ ko: '{name} 메뉴', en: '{name} menu' }, { name: label })}
          onToggleMenu={() => setMenuItemId((current) => current === item.id ? null : item.id)}
          onRequestReplace={() => requestReplacement(item.id)}
          onDelete={() => removeTimelineItem(item.id)}
          onReplaceFile={(file) => void replaceTimelineItem(item.id, file)}
          onSourceDimensionsChange={(sourceWidth, sourceHeight) => updateTimelineItem(item.id, { source_width: sourceWidth, source_height: sourceHeight })}
          onSortStart={() => { setMenuItemId(null); setSortingItemId(item.id) }}
          onSortOver={(targetItemId) => swapTimelineItems(item.id, targetItemId)}
          onSortEnd={() => setSortingItemId(null)}
          onKeyboardMove={(direction) => moveTimelineItem(item, direction)}
        >
        {item.type === 'video' ? (
          <div className="flex gap-1">
            {([['video', 'V'], ['audio', 'A'], ['video_audio', 'V+A']] as Array<[MiniMaxH3DirectorVideoMode, string]>).map(([videoMode, videoLabel]) => (
              <Button key={videoMode} type="button" size="sm" variant={(item.media_mode ?? 'video') === videoMode ? 'default' : 'outline'} className="h-7 px-2 text-[11px]" onClick={() => updateTimelineItem(item.id, { media_mode: videoMode })}>
                {videoLabel}
              </Button>
            ))}
          </div>
        ) : null}

        {item.type !== 'image' && asset ? (
          item.type === 'video' ? (
            <video
              src={buildWorkflowInputAssetUrl(asset)}
              aria-label={asset.fileName}
              preload="metadata"
              muted
              playsInline
              controls
              className="max-h-52 w-full rounded-sm bg-black"
              onPlay={(event) => { if (event.currentTarget.currentTime < trimStart || event.currentTarget.currentTime >= trimEnd) event.currentTarget.currentTime = trimStart }}
              onTimeUpdate={(event) => { if (event.currentTarget.currentTime >= trimEnd) event.currentTarget.pause() }}
            />
          ) : (
            <audio
              src={buildWorkflowInputAssetUrl(asset)}
              aria-label={asset.fileName}
              preload="metadata"
              controls
              className="w-full"
              onPlay={(event) => { if (event.currentTarget.currentTime < trimStart || event.currentTarget.currentTime >= trimEnd) event.currentTarget.currentTime = trimStart }}
              onTimeUpdate={(event) => { if (event.currentTarget.currentTime >= trimEnd) event.currentTarget.pause() }}
            />
          )
        ) : null}

        {item.type === 'audio' && Array.isArray(item.waveform_peaks) && item.waveform_peaks.length > 0 ? (
          <div className="flex h-10 items-center gap-px overflow-hidden rounded-sm bg-surface-low px-1" aria-hidden="true">
            {item.waveform_peaks.map((peak, index) => (
              <span key={`${item.id}-peak-${index}`} className="min-w-px flex-1 bg-primary/70" style={{ height: `${Math.max(8, Math.round(peak * 100))}%` }} />
            ))}
          </div>
        ) : null}

        {item.type !== 'image' ? (
          <div className="space-y-2">
            <div className="relative h-6 rounded-sm bg-surface-low px-1">
              <div className="absolute inset-y-2 rounded-full bg-primary/25" style={{ left: `${(trimStart / sourceDuration) * 100}%`, right: `${100 - (trimEnd / sourceDuration) * 100}%` }} />
              <input
                type="range"
                min={0}
                max={Math.max(0, trimEnd - 2)}
                step={0.25}
                value={trimStart}
                aria-label={t({ ko: '크롭 시작 마커', en: 'Crop start marker' })}
                className="absolute inset-x-0 top-0 h-3 w-full accent-amber-400"
                onChange={(event) => {
                  const nextStart = Math.max(0, Math.min(trimEnd - 2, Number(event.target.value)))
                  updateTimelineItem(item.id, { trim_start: nextStart, duration: trimEnd - nextStart })
                }}
              />
              <input
                type="range"
                min={trimStart + 2}
                max={sourceDuration}
                step={0.25}
                value={trimEnd}
                aria-label={t({ ko: '크롭 끝 마커', en: 'Crop end marker' })}
                className="absolute inset-x-0 bottom-0 h-3 w-full accent-sky-400"
                onChange={(event) => {
                  const nextEnd = Math.min(sourceDuration, Math.max(trimStart + 2, Number(event.target.value)))
                  updateTimelineItem(item.id, { trim_end: nextEnd, duration: nextEnd - trimStart })
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
            <FormField label={t({ ko: '시작', en: 'Start' })}>
              <NumberStepperInput min={0} max={Math.max(0, trimEnd - 2)} step={0.25} value={String(trimStart)} onValueCommit={(nextValue) => {
                const nextStart = Math.max(0, Math.min(trimEnd - 2, Number(nextValue)))
                updateTimelineItem(item.id, { trim_start: nextStart, duration: trimEnd - nextStart })
              }} />
            </FormField>
            <FormField label={t({ ko: '끝', en: 'End' })}>
              <NumberStepperInput min={trimStart + 2} max={sourceDuration} step={0.25} value={String(trimEnd)} onValueCommit={(nextValue) => {
                const nextEnd = Math.min(sourceDuration, Math.max(trimStart + 2, Number(nextValue)))
                updateTimelineItem(item.id, { trim_end: nextEnd, duration: nextEnd - trimStart })
              }} />
            </FormField>
            </div>
          </div>
        ) : null}

        <FormField label={t({ ko: '미디어 프롬프트', en: 'Media prompt' })}>
          <Textarea
            rows={3}
            value={String(item.prompt ?? '')}
            placeholder={t({ ko: '이 참조가 제공할 역할·속성·동작을 적어줘.', en: 'Describe the role, attributes, or motion this reference provides.' })}
            onChange={(event) => updateTimelineItem(item.id, { prompt: event.target.value })}
          />
        </FormField>
        </MiniMaxH3DirectorMediaCard>
      </div>
    )
  }

  const renderEmptyFrameSlot = (slot: number, label: string, inputKey?: MiniMaxH3DirectorGraphInputKey) => {
    return (
      <div key={`frame-slot-${slot}`} className="space-y-1">
        {inputKey ? renderInputPort?.(inputKey) : null}
        <button
          type="button"
          disabled={isUploading}
          className="flex min-h-36 w-full min-w-0 flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-border/80 px-3 text-xs text-muted-foreground hover:border-primary/45 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            requestedFrameSlotRef.current = slot
            visualInputRef.current?.click()
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.stopPropagation(); handleLaneDrop(event, 'visual', slot) }}
        >
          <span className="font-medium text-foreground">{label}</span>
          <span>{t({ ko: '이미지를 추가하거나 놓아줘.', en: 'Add or drop an image.' })}</span>
        </button>
      </div>
    )
  }

  const fl2vaModelConnected = isMiniMaxH3DirectorInputLink(nodeValue.fl2va_model)
  const ref2vaModelConnected = isMiniMaxH3DirectorInputLink(nodeValue.ref2va_model)
  const hasVisibleDimensionField = (['width', 'height', 'duration', 'frame_rate', 'ref_image_size'] as const).some(isFieldVisible)
  const canReset = (isFieldVisible('timeline_data') && timeline.items.length > 0)
    || (isFieldVisible('prompt') && (promptValue.trim().length > 0 || hasMiniMaxH3DirectorBuilderContent(builderState)))
  const isReferenceMediaMode = mode === null || mode === 'REF2VA'
  const frameSlots = mode === 'I2VA'
    ? [{ slot: 0, label: t({ ko: '시작 프레임', en: 'Start frame' }) }]
    : mode === 'Image Inpaint'
      ? [{ slot: 0, label: t({ ko: '인페인트 이미지', en: 'Inpaint image' }) }]
    : mode === 'FL2VA'
      ? [
          { slot: 0, label: t({ ko: '시작 프레임', en: 'Start frame' }) },
          { slot: 1, label: t({ ko: '끝 프레임', en: 'End frame' }) },
        ]
      : mode === 'L2VA'
        ? [{ slot: 1, label: t({ ko: '끝 프레임', en: 'End frame' }) }]
        : []
  const baseFrameCapacityReached = !isReferenceMediaMode && visualItems.length >= frameSlots.length

  return (
    <div className="space-y-4" tabIndex={0} onPaste={handlePaste} onClick={() => setMenuItemId(null)}>
      <input ref={replacementInputRef} type="file" accept="image/*,video/*,audio/*" hidden onChange={(event) => {
        const itemId = replacementItemId
        const file = event.target.files?.[0]
        event.target.value = ''
        setReplacementItemId(null)
        if (itemId && file) void replaceTimelineItem(itemId, file)
      }} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold text-foreground">MiniMax H3 Director</div>
          <Badge variant="outline">DaSiWa</Badge>
          {mode === 'REF2VA' && !ref2vaModelConnected ? <Badge variant="destructive">{t({ ko: 'REF2VA 미연결', en: 'REF2VA missing' })}</Badge> : null}
          {mode && mode !== 'REF2VA' && !fl2vaModelConnected ? <Badge variant="destructive">{t({ ko: '기본 모델 미연결', en: 'Base model missing' })}</Badge> : null}
          {mode === null && (!fl2vaModelConnected || !ref2vaModelConnected) ? <Badge variant="destructive">{t({ ko: '동적 모드 모델 확인', en: 'Check dynamic-mode models' })}</Badge> : null}
        </div>
        <div className="flex gap-1">
          {isFieldVisible('mode')
            ? MINIMAX_H3_DIRECTOR_MODES.map((nextMode) => (
                <Button key={nextMode} type="button" size="sm" variant={mode === nextMode ? 'default' : 'outline'} onClick={() => changeMode(nextMode)}>
                  {nextMode}
                </Button>
              ))
            : null}
          {canReset ? (
            <Button type="button" size="icon-sm" variant="ghost" onClick={clearTimeline} aria-label={t({ ko: 'Director 초기화', en: 'Reset Director' })} title={t({ ko: '전체 초기화', en: 'Reset all' })}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>

      {mode === 'Image Inpaint' ? (
        <div className="rounded-sm border border-border/70 bg-surface-low/50 px-3 py-2 text-xs text-muted-foreground">
          {t({ ko: '이미지 1장만 사용하며 영상·오디오는 지원하지 않아. 결과는 단일 이미지로 저장돼.', en: 'Uses exactly one image with no video or audio references. The result is saved as a single image.' })}
        </div>
      ) : null}

      {isFieldVisible('timeline_data') ? (
        <MiniMaxH3DirectorResolutionPanel
          value={resolution}
          canvas={resolvedCanvas}
          onChange={updateResolution}
          renderInputPort={renderInputPort}
        />
      ) : null}

      {hasVisibleDimensionField ? (
        <div
          data-minimax-dimension-grid
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))' }}
        >
          {isFieldVisible('width') ? (
            <div className="space-y-1">
              {renderInputPort?.('width')}
              <FormField label={t({ ko: '너비', en: 'Width' })}>
                <NumberStepperInput min={numericBounds?.width?.min} max={numericBounds?.width?.max} step={1} value={widthValue} onValueCommit={(nextValue) => emit({ width: Number(nextValue) })} />
              </FormField>
            </div>
          ) : null}
          {isFieldVisible('height') ? (
            <div className="space-y-1">
              {renderInputPort?.('height')}
              <FormField label={t({ ko: '높이', en: 'Height' })}>
                <NumberStepperInput min={numericBounds?.height?.min} max={numericBounds?.height?.max} step={1} value={heightValue} onValueCommit={(nextValue) => emit({ height: Number(nextValue) })} />
              </FormField>
            </div>
          ) : null}
          {isFieldVisible('duration') ? (
            <div className="space-y-1">
              {renderInputPort?.('duration')}
              <FormField label={t({ ko: '길이(초)', en: 'Duration (seconds)' })}>
                <NumberStepperInput
                  disabled={mode === 'Image Inpaint'}
                  min={Math.max(MINIMAX_H3_DIRECTOR_DURATION_MIN_SECONDS, numericBounds?.duration?.min ?? MINIMAX_H3_DIRECTOR_DURATION_MIN_SECONDS)}
                  max={Math.min(MINIMAX_H3_DIRECTOR_DURATION_MAX_SECONDS, numericBounds?.duration?.max ?? MINIMAX_H3_DIRECTOR_DURATION_MAX_SECONDS)}
                  step={1}
                  value={durationValue}
                  className={cn(invalidFields.has('duration') && 'border-destructive')}
                  onValueCommit={(nextValue) => {
                    const duration = Number(nextValue)
                    emit({ duration }, undefined, assets, { ...builderState, duration })
                  }}
                />
              </FormField>
              {mode === 'Image Inpaint' ? <div className="text-[11px] text-muted-foreground">{t({ ko: 'Image Inpaint는 내부 5프레임·단일 이미지 출력으로 고정돼.', en: 'Image Inpaint uses a fixed five-frame latent and produces one image.' })}</div> : null}
            </div>
          ) : null}
          {isFieldVisible('frame_rate') ? (
            <div className="space-y-1">
              {renderInputPort?.('frame_rate')}
              <FormField label={t({ ko: '프레임 레이트', en: 'Frame rate' })}>
                <NumberStepperInput
                  disabled={mode === 'Image Inpaint'}
                  min={Math.max(MINIMAX_H3_DIRECTOR_FRAME_RATE_MIN, numericBounds?.frame_rate?.min ?? MINIMAX_H3_DIRECTOR_FRAME_RATE_MIN)}
                  max={Math.min(MINIMAX_H3_DIRECTOR_FRAME_RATE_MAX, numericBounds?.frame_rate?.max ?? MINIMAX_H3_DIRECTOR_FRAME_RATE_MAX)}
                  step={0.01}
                  value={frameRateValue}
                  className={cn(invalidFields.has('frame_rate') && 'border-destructive')}
                  onValueCommit={(nextValue) => emit({ frame_rate: Number(nextValue) })}
                />
              </FormField>
            </div>
          ) : null}
          {isFieldVisible('ref_image_size') ? (
            <div className="space-y-1">
              {renderInputPort?.('ref_image_size')}
              <FormField label={t({ ko: '이미지 크기', en: 'Image size' })}>
                <Select value={refImageSizeValue} onChange={(event) => emit({ ref_image_size: event.target.value })}>
                  {refImageSizeValue === '' ? <option value="">{t({ ko: '선택', en: 'Select' })}</option> : null}
                  <option value="match">match</option>
                  <option value="max">max</option>
                </Select>
              </FormField>
            </div>
          ) : null}
        </div>
      ) : null}

      {isFieldVisible('timeline_data') ? (
        <MiniMaxH3DirectorPostprocessPanel
          value={postprocess}
          onChange={updatePostprocess}
          renderInputPort={renderInputPort}
        />
      ) : null}

      {issues.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>{t({ ko: 'Director 입력 확인', en: 'Check Director inputs' })}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {issues.slice(0, 6).map((issue) => (
                <li key={`${issue.code}-${issue.itemId ?? issue.field ?? ''}`}>
                  {issue.itemId ? (
                    <button type="button" className="text-left underline-offset-2 hover:underline" onClick={(event) => { event.stopPropagation(); setMenuItemId(issue.itemId ?? null) }}>
                      {t({ ko: issue.ko, en: issue.en })}
                    </button>
                  ) : t({ ko: issue.ko, en: issue.en })}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {isFieldVisible('timeline_data') ? <>
      <div className={cn('space-y-3 rounded-sm border bg-surface-low/50 p-3', selectedLane === 'visual' ? 'border-primary/50 ring-1 ring-primary/15' : 'border-border/80')} onClick={() => setSelectedLane('visual')} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleLaneDrop(event, 'visual')}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground"><Film className="h-4 w-4" />{isReferenceMediaMode ? t({ ko: '이미지 / 영상', en: 'Image / Video' }) : t({ ko: '키 프레임', en: 'Key frames' })}</div>
          <div className="flex items-center gap-1">
            {timeline.items.some((item) => getMediaLane(item) === 'visual') ? (
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => clearLane('visual')} aria-label={t({ ko: '이미지·영상 초기화', en: 'Clear image and video lane' })} title={t({ ko: '이미지·영상 초기화', en: 'Clear image and video lane' })}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            ) : null}
            <Button type="button" size="icon-sm" variant="outline" disabled={isUploading || baseFrameCapacityReached} onClick={() => visualInputRef.current?.click()} aria-label={t({ ko: '이미지 또는 영상 추가', en: 'Add image or video' })} title={t({ ko: '추가', en: 'Add' })}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <input ref={visualInputRef} type="file" accept={isReferenceMediaMode ? 'image/*,video/*' : 'image/*'} multiple={isReferenceMediaMode || mode === 'FL2VA'} hidden onChange={(event) => {
            const requestedFrameSlot = requestedFrameSlotRef.current
            requestedFrameSlotRef.current = null
            void handleFiles(Array.from(event.target.files ?? []), 'visual', requestedFrameSlot)
            event.target.value = ''
          }} />
        </div>

        {isReferenceMediaMode ? (
          <div className="grid gap-1 sm:grid-cols-2">
            {renderInputPort?.('reference_image')}
            {renderInputPort?.('reference_video')}
          </div>
        ) : null}

        {!isReferenceMediaMode && frameSlots.length > 0 ? (
          <div className={cn('grid gap-3', frameSlots.length > 1 && 'grid-cols-2')}>
            {frameSlots.map((descriptor, index) => {
              const frameItem = mode === 'Image Inpaint' ? visualItems[0] : visualItems.find((item) => item.slot === descriptor.slot)
              const inputKey = descriptor.slot === 0 ? 'start_image' : 'end_image'
              return frameItem
                ? renderMediaCard(frameItem, index + 1, descriptor.label, inputKey)
                : renderEmptyFrameSlot(descriptor.slot, descriptor.label, inputKey)
            })}
          </div>
        ) : mode === 'T2VA' ? (
          <div className="flex min-h-28 items-center justify-center rounded-sm border border-dashed border-border/60 text-xs text-muted-foreground">{t({ ko: 'T2VA는 입력 프레임 없이 텍스트로 생성해.', en: 'T2VA generates from text without input frames.' })}</div>
        ) : visualItems.length > 0 ? (
          <div className="grid items-start gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))' }}>
            {visualItems.map((item) => renderMediaCard(item, visualItems.filter((candidate) => candidate.type === item.type && candidate.slot <= item.slot).length))}
          </div>
        ) : (
          <button type="button" className="flex min-h-28 w-full items-center justify-center rounded-sm border border-dashed border-border/80 text-xs text-muted-foreground hover:border-primary/45 hover:text-foreground" onClick={() => visualInputRef.current?.click()}>
            {mode === null ? t({ ko: '실행 모드는 상위 노드가 결정해. 참조 미디어를 추가할 수 있어.', en: 'An upstream node selects the mode. You can add reference media.' }) : t({ ko: '이미지·영상을 추가하거나 여기에 놓아줘.', en: 'Add images or videos, or drop them here.' })}
          </button>
        )}
      </div>

      <div className={cn('space-y-3 rounded-sm border p-3', !isReferenceMediaMode ? 'border-border/50 bg-muted/20 opacity-60' : selectedLane === 'audio' ? 'border-primary/50 bg-surface-low/50 ring-1 ring-primary/15' : 'border-border/80 bg-surface-low/50')} onClick={() => { if (isReferenceMediaMode) setSelectedLane('audio') }} onDragOver={(event) => { if (isReferenceMediaMode) event.preventDefault() }} onDrop={(event) => isReferenceMediaMode ? handleLaneDrop(event, 'audio') : event.preventDefault()}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground"><Music2 className="h-4 w-4" />{t({ ko: '오디오', en: 'Audio' })}</div>
          <div className="flex items-center gap-1">
            {timeline.items.some((item) => getMediaLane(item) === 'audio') ? (
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => clearLane('audio')} aria-label={t({ ko: '오디오 초기화', en: 'Clear audio lane' })} title={t({ ko: '오디오 초기화', en: 'Clear audio lane' })}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            ) : null}
            <Button type="button" size="icon-sm" variant="outline" disabled={!isReferenceMediaMode || isUploading} onClick={() => audioInputRef.current?.click()} aria-label={t({ ko: '오디오 추가', en: 'Add audio' })} title={t({ ko: '추가', en: 'Add' })}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <input ref={audioInputRef} type="file" accept="audio/*" multiple hidden onChange={(event) => { void handleFiles(Array.from(event.target.files ?? []), 'audio'); event.target.value = '' }} />
        </div>
        {isReferenceMediaMode ? renderInputPort?.('reference_audio') : null}
        {!isReferenceMediaMode ? (
          <div className="flex min-h-20 items-center justify-center rounded-sm border border-dashed border-border/60 text-xs text-muted-foreground">{t({ ko: '기본 모드에서는 오디오 참조를 사용하지 않아.', en: 'Base modes do not use audio references.' })}</div>
        ) : audioItems.length > 0 ? (
          <div className="grid items-start gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))' }}>
            {audioItems.map((item, index) => renderMediaCard(item, index + 1))}
          </div>
        ) : (
          <button type="button" className="flex min-h-20 w-full items-center justify-center rounded-sm border border-dashed border-border/80 text-xs text-muted-foreground hover:border-primary/45 hover:text-foreground" onClick={() => audioInputRef.current?.click()}>
            {t({ ko: '오디오를 추가하거나 여기에 놓아줘.', en: 'Add audio or drop it here.' })}
          </button>
        )}
      </div>

      </> : null}

      {isFieldVisible('prompt') ? (
        <MiniMaxH3DirectorPromptBuilder
          state={builderState}
          items={activeItems}
          invalid={invalidFields.has('prompt')}
          onChange={updateBuilderState}
          onStatus={setStatus}
          renderInputPort={renderInputPort}
        />
      ) : null}

      {status ? <div className="rounded-sm border border-border/70 bg-background/35 px-3 py-2 text-xs text-muted-foreground">{status}</div> : null}

    </div>
  )
}
