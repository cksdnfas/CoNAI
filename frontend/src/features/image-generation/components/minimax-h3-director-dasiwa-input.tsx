import { useMemo, useRef, useState, type DragEvent } from 'react'
import { Film, Music2, Plus, RotateCcw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsModalFooter } from '@/features/settings/components/settings-primitives'
import { useI18n } from '@/i18n'
import {
  buildWorkflowInputAssetUrl,
  deleteWorkflowInputAsset,
  uploadWorkflowInputAsset,
  type WorkflowInputAssetRef,
} from '@/lib/api-workflow-input-assets'
import type { WorkflowNodeNumericBounds } from '@/lib/api-image-generation-types'
import { cn } from '@/lib/utils'
import {
  buildMiniMaxH3DirectorNodeValue,
  createMiniMaxH3DirectorItemId,
  getMiniMaxH3DirectorAssets,
  inferMiniMaxH3DirectorMediaType,
  isMiniMaxH3DirectorInputLink,
  MINIMAX_H3_DIRECTOR_DURATION_MAX_SECONDS,
  MINIMAX_H3_DIRECTOR_DURATION_MIN_SECONDS,
  MINIMAX_H3_DIRECTOR_VISIBLE_FIELDS,
  normalizeMiniMaxH3DirectorNodeValue,
  parseMiniMaxH3DirectorTimeline,
  validateMiniMaxH3DirectorNodeValue,
  type MiniMaxH3DirectorMediaType,
  type MiniMaxH3DirectorMode,
  type MiniMaxH3DirectorTimeline,
  type MiniMaxH3DirectorTimelineItem,
  type MiniMaxH3DirectorVideoMode,
  type MiniMaxH3DirectorVisibleField,
} from './minimax-h3-director-dasiwa-utils'
import { MiniMaxH3DirectorMediaCard } from './minimax-h3-director-media-card'

const MAX_MEDIA_COUNT = { image: 9, video: 3, audio: 3, total: 12 } as const
const MAX_AUDIO_WAVEFORM_DECODE_BYTES = 64 * 1024 * 1024

type MediaLane = 'visual' | 'audio'

type MiniMaxH3DirectorDasiwaInputProps = {
  value: Record<string, unknown>
  visibleFields?: string[]
  numericBounds?: WorkflowNodeNumericBounds
  onChange: (value: Record<string, unknown>) => void
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

function formatMediaBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function formatMediaTypeLabel(type: MiniMaxH3DirectorMediaType, index: number) {
  if (type === 'image') return `Picture ${index}`
  if (type === 'video') return `Video ${index}`
  return `Audio ${index}`
}

/** Render DaSiWa MiniMax H3 Director inputs as a CoNAI-native reference board. */
export function MiniMaxH3DirectorDasiwaInput({ value, visibleFields, numericBounds, onChange }: MiniMaxH3DirectorDasiwaInputProps) {
  const { t } = useI18n()
  const visualInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const replacementInputRef = useRef<HTMLInputElement>(null)
  const [menuItemId, setMenuItemId] = useState<string | null>(null)
  const [promptItemId, setPromptItemId] = useState<string | null>(null)
  const [promptDraft, setPromptDraft] = useState('')
  const [replacementItemId, setReplacementItemId] = useState<string | null>(null)
  const [sortingItemId, setSortingItemId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const nodeValue = normalizeMiniMaxH3DirectorNodeValue(value)
  const mode: MiniMaxH3DirectorMode | null = isMiniMaxH3DirectorInputLink(nodeValue.mode) ? null : nodeValue.mode
  const parsedTimeline = parseMiniMaxH3DirectorTimeline(isMiniMaxH3DirectorInputLink(nodeValue.timeline_data) ? '' : nodeValue.timeline_data)
  const timeline = parsedTimeline.timeline
  const promptValue = isMiniMaxH3DirectorInputLink(nodeValue.prompt) ? '' : nodeValue.prompt
  const widthValue = isMiniMaxH3DirectorInputLink(nodeValue.width) ? '' : String(nodeValue.width)
  const heightValue = isMiniMaxH3DirectorInputLink(nodeValue.height) ? '' : String(nodeValue.height)
  const durationValue = isMiniMaxH3DirectorInputLink(nodeValue.duration) ? '' : String(nodeValue.duration)
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
  const displayedItems = mode === 'FL2VA'
    ? activeItems.filter((item) => item.type === 'image').sort((left, right) => left.slot - right.slot).slice(0, 2)
    : activeItems
  const visualItems = displayedItems.filter((item) => item.type !== 'audio').sort((left, right) => left.slot - right.slot)
  const audioItems = mode === 'FL2VA' ? [] : displayedItems.filter((item) => item.type === 'audio').sort((left, right) => left.slot - right.slot)
  const promptItem = timeline.items.find((item) => item.id === promptItemId && item.type !== 'audio') ?? null
  const issues = useMemo(() => validateMiniMaxH3DirectorNodeValue(value), [value])
  const issueItemIds = useMemo(() => new Set(issues.flatMap((issue) => issue.itemId ? [issue.itemId] : [])), [issues])
  const invalidFields = useMemo(() => new Set(issues.flatMap((issue) => issue.field ? [issue.field] : [])), [issues])

  const emit = (
    inputPatch: Record<string, unknown>,
    nextTimeline?: MiniMaxH3DirectorTimeline,
    nextAssets = assets,
  ) => {
    onChange(buildMiniMaxH3DirectorNodeValue(nodeValue, inputPatch, nextTimeline, nextAssets))
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
    if (promptItemId && itemIds.has(promptItemId)) setPromptItemId(null)
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
    setPromptItemId(null)
    emit(
      isFieldVisible('prompt') ? { prompt: '' } : {},
      clearMedia ? { ...timeline, items: [], prompt_blocks: [] } : undefined,
      clearMedia ? {} : assets,
    )
    cleanupAssets(removableAssets)
  }

  const canAcceptFile = (type: MiniMaxH3DirectorMediaType, items: MiniMaxH3DirectorTimelineItem[]) => {
    if (mode === 'FL2VA') {
      return type === 'image' && items.filter((item) => item.enabled !== false && item.type === 'image').length < 2
    }

    const typeCount = items.filter((item) => item.enabled !== false && item.type === type).length
    return typeCount < MAX_MEDIA_COUNT[type] && items.filter((item) => item.enabled !== false).length < MAX_MEDIA_COUNT.total
  }

  const validateFileForLane = (file: File, lane: MediaLane) => {
    const type = inferMiniMaxH3DirectorMediaType(file)
    const laneMatches = lane === 'audio' ? type === 'audio' : type === 'image' || type === 'video'
    if (!type || !laneMatches || (mode === 'FL2VA' && type !== 'image')) {
      setStatus(mode === 'FL2VA'
        ? t({ ko: 'FL2VA 슬롯에는 이미지만 사용할 수 있어.', en: 'FL2VA slots accept images only.' })
        : t({ ko: '선택한 레인에 맞는 미디어 파일을 골라줘.', en: 'Choose media that matches the selected lane.' }))
      return null
    }
    return type
  }

  const handleFiles = async (files: File[], lane: MediaLane) => {
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
          setStatus(mode === 'FL2VA'
            ? t({ ko: 'FL2VA는 시작·끝 이미지 두 슬롯만 사용할 수 있어.', en: 'FL2VA uses only the start and end image slots.' })
            : t({ ko: 'REF2VA 참조 개수 제한에 도달했어.', en: 'The REF2VA reference limit has been reached.' }))
          continue
        }

        const sourceDuration = await probeMediaDuration(file, type)
        if (type !== 'image' && (sourceDuration === null || sourceDuration < 2)) {
          setStatus(t({ ko: '{name}: 영상·오디오는 최소 2초여야 해.', en: '{name}: Video and audio must be at least two seconds.' }, { name: file.name }))
          continue
        }

        setStatus(t({ ko: '{name} 업로드 중…', en: 'Uploading {name}…' }, { name: file.name }))
        const asset = await uploadWorkflowInputAsset(file)
        const id = createMiniMaxH3DirectorItemId(type)
        const targetLane = type === 'audio' ? 'audio' : 'visual'
        const flImages = nextTimeline.items.filter((item) => item.enabled !== false && item.type === 'image').sort((left, right) => left.slot - right.slot)
        const slotCapacity = targetLane === 'audio' ? MAX_MEDIA_COUNT.audio : MAX_MEDIA_COUNT.image + MAX_MEDIA_COUNT.video
        const slot = mode === 'FL2VA'
          ? flImages.length === 0 ? 0 : Math.max(...flImages.map((item) => item.slot)) + 1
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
      const sourceDuration = await probeMediaDuration(file, type)
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
      const nextItem: MiniMaxH3DirectorTimelineItem = {
        ...stableItem,
        type,
        value: asset.fileName,
        duration,
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

  const handleLaneDrop = (event: DragEvent<HTMLElement>, lane: MediaLane) => {
    event.preventDefault()
    void handleFiles(Array.from(event.dataTransfer.files), lane)
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

  const openPromptModal = (item: MiniMaxH3DirectorTimelineItem) => {
    setPromptItemId(item.id)
    setPromptDraft(String(item.prompt ?? ''))
    setMenuItemId(null)
  }

  const renderMediaCard = (item: MiniMaxH3DirectorTimelineItem, typeIndex: number, labelOverride?: string) => {
    const asset = assets[item.id]
    const sourceDuration = Math.max(2, Number(item.source_duration ?? item.duration ?? 2))
    const trimStart = Number(item.trim_start ?? 0)
    const trimEnd = Number(item.trim_end ?? sourceDuration)
    const label = labelOverride ?? formatMediaTypeLabel(item.type, typeIndex)
    return (
      <MiniMaxH3DirectorMediaCard
        key={item.id}
        item={item}
        asset={asset}
        label={label}
        hasIssue={issueItemIds.has(item.id)}
        menuOpen={menuItemId === item.id}
        disabled={isUploading}
        sorting={sortingItemId === item.id}
        replaceLabel={t({ ko: '미디어 교체', en: 'Replace media' })}
        promptLabel={t({ ko: '미디어 프롬프트', en: 'Media prompt' })}
        deleteLabel={t({ ko: '삭제', en: 'Delete' })}
        menuLabel={t({ ko: '{name} 메뉴', en: '{name} menu' }, { name: label })}
        onToggleMenu={() => setMenuItemId((current) => current === item.id ? null : item.id)}
        onRequestReplace={() => requestReplacement(item.id)}
        onOpenPrompt={item.type === 'audio' ? undefined : () => openPromptModal(item)}
        onDelete={() => removeTimelineItem(item.id)}
        onReplaceFile={(file) => void replaceTimelineItem(item.id, file)}
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

        {item.type === 'audio' && asset ? (
          <audio src={buildWorkflowInputAssetUrl(asset)} aria-label={asset.fileName} preload="metadata" controls className="w-full" />
        ) : null}

        {item.type === 'audio' && Array.isArray(item.waveform_peaks) && item.waveform_peaks.length > 0 ? (
          <div className="flex h-10 items-center gap-px overflow-hidden rounded-sm bg-surface-low px-1" aria-hidden="true">
            {item.waveform_peaks.map((peak, index) => (
              <span key={`${item.id}-peak-${index}`} className="min-w-px flex-1 bg-primary/70" style={{ height: `${Math.max(8, Math.round(peak * 100))}%` }} />
            ))}
          </div>
        ) : null}

        {item.type !== 'image' ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-[11px] text-muted-foreground">
              <span>{t({ ko: '시작', en: 'Start' })}</span>
              <NumberStepperInput min={0} max={Math.max(0, trimEnd - 2)} step={0.25} value={String(trimStart)} onValueCommit={(nextValue) => {
                const nextStart = Math.max(0, Math.min(trimEnd - 2, Number(nextValue)))
                updateTimelineItem(item.id, { trim_start: nextStart, duration: trimEnd - nextStart })
              }} />
            </label>
            <label className="space-y-1 text-[11px] text-muted-foreground">
              <span>{t({ ko: '끝', en: 'End' })}</span>
              <NumberStepperInput min={trimStart + 2} max={sourceDuration} step={0.25} value={String(trimEnd)} onValueCommit={(nextValue) => {
                const nextEnd = Math.min(sourceDuration, Math.max(trimStart + 2, Number(nextValue)))
                updateTimelineItem(item.id, { trim_end: nextEnd, duration: nextEnd - trimStart })
              }} />
            </label>
          </div>
        ) : null}
      </MiniMaxH3DirectorMediaCard>
    )
  }

  const renderEmptyFlSlot = (index: number) => {
    const isEndSlotUnavailable = index === 1 && visualItems.length === 0
    const label = index === 0 ? t({ ko: '시작 프레임', en: 'Start frame' }) : t({ ko: '끝 프레임', en: 'End frame' })
    return (
      <button
        key={`fl-slot-${index}`}
        type="button"
        disabled={isUploading || isEndSlotUnavailable}
        className="flex min-h-36 min-w-0 flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-border/80 px-3 text-xs text-muted-foreground hover:border-primary/45 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => visualInputRef.current?.click()}
        onDragOver={(event) => { if (!isEndSlotUnavailable) event.preventDefault() }}
        onDrop={(event) => { event.stopPropagation(); if (!isEndSlotUnavailable) handleLaneDrop(event, 'visual') }}
      >
        <span className="font-medium text-foreground">{label}</span>
        <span>{isEndSlotUnavailable
          ? t({ ko: '시작 프레임을 먼저 추가해줘.', en: 'Add the start frame first.' })
          : t({ ko: '이미지를 추가하거나 놓아줘.', en: 'Add or drop an image.' })}</span>
      </button>
    )
  }

  const fl2vaModelConnected = isMiniMaxH3DirectorInputLink(nodeValue.fl2va_model)
  const ref2vaModelConnected = isMiniMaxH3DirectorInputLink(nodeValue.ref2va_model)
  const hasVisibleDimensionField = (['width', 'height', 'duration', 'ref_image_size'] as const).some(isFieldVisible)
  const canReset = (isFieldVisible('timeline_data') && timeline.items.length > 0)
    || (isFieldVisible('prompt') && promptValue.trim().length > 0)

  return (
    <div className="space-y-4" onClick={() => setMenuItemId(null)}>
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
          {!fl2vaModelConnected ? <Badge variant="destructive">{t({ ko: 'FL2VA 미연결', en: 'FL2VA missing' })}</Badge> : null}
          {!ref2vaModelConnected ? <Badge variant="destructive">{t({ ko: 'REF2VA 미연결', en: 'REF2VA missing' })}</Badge> : null}
        </div>
        <div className="flex gap-1">
          {isFieldVisible('mode')
            ? (['FL2VA', 'REF2VA'] as const).map((nextMode) => (
                <Button key={nextMode} type="button" size="sm" variant={mode === nextMode ? 'default' : 'outline'} onClick={() => emit({ mode: nextMode })}>
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

      {hasVisibleDimensionField ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {isFieldVisible('width') ? (
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>{t({ ko: '너비', en: 'Width' })}</span>
              <NumberStepperInput min={numericBounds?.width?.min} max={numericBounds?.width?.max} step={1} value={widthValue} onValueCommit={(nextValue) => emit({ width: Number(nextValue) })} />
            </label>
          ) : null}
          {isFieldVisible('height') ? (
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>{t({ ko: '높이', en: 'Height' })}</span>
              <NumberStepperInput min={numericBounds?.height?.min} max={numericBounds?.height?.max} step={1} value={heightValue} onValueCommit={(nextValue) => emit({ height: Number(nextValue) })} />
            </label>
          ) : null}
          {isFieldVisible('duration') ? (
            <label className={cn('space-y-1 text-xs text-muted-foreground', invalidFields.has('duration') && 'text-destructive')}>
              <span>{t({ ko: '길이(초)', en: 'Duration (seconds)' })}</span>
              <NumberStepperInput
                min={Math.max(MINIMAX_H3_DIRECTOR_DURATION_MIN_SECONDS, numericBounds?.duration?.min ?? MINIMAX_H3_DIRECTOR_DURATION_MIN_SECONDS)}
                max={Math.min(MINIMAX_H3_DIRECTOR_DURATION_MAX_SECONDS, numericBounds?.duration?.max ?? MINIMAX_H3_DIRECTOR_DURATION_MAX_SECONDS)}
                step={1}
                value={durationValue}
                className={cn(invalidFields.has('duration') && 'border-destructive')}
                onValueCommit={(nextValue) => emit({ duration: Number(nextValue) })}
              />
            </label>
          ) : null}
          {isFieldVisible('ref_image_size') ? (
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>{t({ ko: '참조 이미지 크기', en: 'Reference image size' })}</span>
              <Select value={refImageSizeValue} onChange={(event) => emit({ ref_image_size: event.target.value })}>
                {refImageSizeValue === '' ? <option value="">{t({ ko: '선택', en: 'Select' })}</option> : null}
                <option value="match">match</option>
                <option value="max">max</option>
              </Select>
            </label>
          ) : null}
        </div>
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
      <div className="space-y-3 rounded-sm border border-border/80 bg-surface-low/50 p-3" onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleLaneDrop(event, 'visual')}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground"><Film className="h-4 w-4" />{mode === 'FL2VA' ? t({ ko: 'FL2VA 이미지', en: 'FL2VA images' }) : t({ ko: '이미지 / 영상', en: 'Image / Video' })}</div>
          <div className="flex items-center gap-1">
            {timeline.items.some((item) => getMediaLane(item) === 'visual') ? (
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => clearLane('visual')} aria-label={t({ ko: '이미지·영상 초기화', en: 'Clear image and video lane' })} title={t({ ko: '이미지·영상 초기화', en: 'Clear image and video lane' })}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            ) : null}
            <Button type="button" size="icon-sm" variant="outline" disabled={isUploading} onClick={() => visualInputRef.current?.click()} aria-label={t({ ko: '이미지 또는 영상 추가', en: 'Add image or video' })} title={t({ ko: '추가', en: 'Add' })}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <input ref={visualInputRef} type="file" accept={mode === 'FL2VA' ? 'image/*' : 'image/*,video/*'} multiple hidden onChange={(event) => { void handleFiles(Array.from(event.target.files ?? []), 'visual'); event.target.value = '' }} />
        </div>

        {mode === 'FL2VA' ? (
          <div className="grid grid-cols-2 gap-3">
            {[0, 1].map((index) => visualItems[index]
              ? renderMediaCard(visualItems[index], index + 1, index === 0 ? t({ ko: '시작 프레임', en: 'Start frame' }) : t({ ko: '끝 프레임', en: 'End frame' }))
              : renderEmptyFlSlot(index))}
          </div>
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

      <div className={cn('space-y-3 rounded-sm border p-3', mode === 'FL2VA' ? 'border-border/50 bg-muted/20 opacity-60' : 'border-border/80 bg-surface-low/50')} onDragOver={(event) => { if (mode !== 'FL2VA') event.preventDefault() }} onDrop={(event) => mode !== 'FL2VA' ? handleLaneDrop(event, 'audio') : event.preventDefault()}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground"><Music2 className="h-4 w-4" />{t({ ko: '오디오', en: 'Audio' })}</div>
          <div className="flex items-center gap-1">
            {timeline.items.some((item) => getMediaLane(item) === 'audio') ? (
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => clearLane('audio')} aria-label={t({ ko: '오디오 초기화', en: 'Clear audio lane' })} title={t({ ko: '오디오 초기화', en: 'Clear audio lane' })}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            ) : null}
            <Button type="button" size="icon-sm" variant="outline" disabled={mode === 'FL2VA' || isUploading} onClick={() => audioInputRef.current?.click()} aria-label={t({ ko: '오디오 추가', en: 'Add audio' })} title={t({ ko: '추가', en: 'Add' })}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <input ref={audioInputRef} type="file" accept="audio/*" multiple hidden onChange={(event) => { void handleFiles(Array.from(event.target.files ?? []), 'audio'); event.target.value = '' }} />
        </div>
        {mode === 'FL2VA' ? (
          <div className="flex min-h-20 items-center justify-center rounded-sm border border-dashed border-border/60 text-xs text-muted-foreground">{t({ ko: 'FL2VA에서는 오디오 참조를 사용하지 않아.', en: 'FL2VA does not use audio references.' })}</div>
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

      {visualItems.length > 0 ? (
        <section className="space-y-2 rounded-sm border border-border/70 bg-background/25 p-3" aria-label={t({ ko: '미디어 프롬프트 요약', en: 'Media prompt summary' })}>
          <div className="text-xs font-medium text-foreground">{t({ ko: '미디어 프롬프트 요약', en: 'Media prompt summary' })}</div>
          <div className="divide-y divide-border/60">
            {visualItems.map((item, index) => {
              const label = mode === 'FL2VA'
                ? index === 0 ? t({ ko: '시작 프레임', en: 'Start frame' }) : t({ ko: '끝 프레임', en: 'End frame' })
                : formatMediaTypeLabel(item.type, visualItems.filter((candidate) => candidate.type === item.type && candidate.slot <= item.slot).length)
              return (
                <div key={item.id} className="grid gap-1 py-2 text-xs sm:grid-cols-[8rem_minmax(0,1fr)]">
                  <span className="font-medium text-foreground">{label}</span>
                  <span className={cn('whitespace-pre-wrap break-words', String(item.prompt ?? '').trim() ? 'text-muted-foreground' : 'text-muted-foreground/60')}>
                    {String(item.prompt ?? '').trim() || t({ ko: '미작성', en: 'Not written' })}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}
      </> : null}

      {isFieldVisible('prompt') ? (
        <label className="block space-y-1.5 text-xs text-muted-foreground">
          <span>{t({ ko: '글로벌 프롬프트', en: 'Global prompt' })}</span>
          <Textarea rows={5} value={promptValue} placeholder={t({ ko: '전체 영상 프롬프트', en: 'Global video prompt' })} onChange={(event) => emit({ prompt: event.target.value })} />
        </label>
      ) : null}

      {status ? <div className="rounded-sm border border-border/70 bg-background/35 px-3 py-2 text-xs text-muted-foreground">{status}</div> : null}

      <SettingsModal
        open={isFieldVisible('timeline_data') && Boolean(promptItem)}
        title={t({ ko: '미디어 프롬프트', en: 'Media prompt' })}
        description={promptItem ? assets[promptItem.id]?.fileName || promptItem.value : undefined}
        widthClassName="max-w-xl"
        onClose={() => setPromptItemId(null)}
      >
        {promptItem ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-sm border border-border/70 bg-surface-low/45 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{t({ ko: '파일명', en: 'File name' })}</div>
                <div className="mt-2 break-all text-sm text-foreground">{assets[promptItem.id]?.fileName || promptItem.value}</div>
              </div>
              <div className="rounded-sm border border-border/70 bg-surface-low/45 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{t({ ko: '용량', en: 'Size' })}</div>
                <div className="mt-2 text-sm text-foreground">{assets[promptItem.id] ? formatMediaBytes(assets[promptItem.id].bytes) : t({ ko: '기존 Comfy 입력', en: 'Existing Comfy input' })}</div>
              </div>
            </div>
            <label className="block space-y-1.5 text-xs text-muted-foreground">
              <span>{t({ ko: '프롬프트', en: 'Prompt' })}</span>
              <Textarea rows={7} autoFocus value={promptDraft} placeholder={t({ ko: '이 미디어의 역할과 장면을 적어줘.', en: 'Describe this media role and scene.' })} onChange={(event) => setPromptDraft(event.target.value)} />
            </label>
            <SettingsModalFooter>
              <Button type="button" variant="outline" onClick={() => setPromptItemId(null)}>{t({ ko: '취소', en: 'Cancel' })}</Button>
              <Button type="button" onClick={() => { updateTimelineItem(promptItem.id, { prompt: promptDraft }); setPromptItemId(null) }}>{t({ ko: '저장', en: 'Save' })}</Button>
            </SettingsModalFooter>
          </div>
        ) : null}
      </SettingsModal>
    </div>
  )
}
