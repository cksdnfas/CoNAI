import { useMemo, useRef, useState, type DragEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Film,
  ImageIcon,
  Music2,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import {
  buildWorkflowInputAssetUrl,
  deleteWorkflowInputAsset,
  uploadWorkflowInputAsset,
  type WorkflowInputAssetRef,
} from '@/lib/api-workflow-input-assets'
import { cn } from '@/lib/utils'
import {
  buildMiniMaxH3DirectorNodeValue,
  createMiniMaxH3DirectorItemId,
  getMiniMaxH3DirectorAssets,
  inferMiniMaxH3DirectorMediaType,
  normalizeMiniMaxH3DirectorNodeValue,
  parseMiniMaxH3DirectorTimeline,
  validateMiniMaxH3DirectorNodeValue,
  type MiniMaxH3DirectorMediaType,
  type MiniMaxH3DirectorTimeline,
  type MiniMaxH3DirectorTimelineItem,
  type MiniMaxH3DirectorVideoMode,
} from './minimax-h3-director-dasiwa-utils'

const MAX_MEDIA_COUNT = { image: 9, video: 3, audio: 3, total: 12 } as const
const MAX_AUDIO_WAVEFORM_DECODE_BYTES = 64 * 1024 * 1024

type MiniMaxH3DirectorDasiwaInputProps = {
  value: Record<string, unknown>
  onChange: (value: Record<string, unknown>) => void
}

function getMediaLane(item: MiniMaxH3DirectorTimelineItem) {
  return item.type === 'audio' ? 'audio' : 'visual'
}

function getNextMediaSlot(items: MiniMaxH3DirectorTimelineItem[], lane: 'visual' | 'audio', capacity: number) {
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

function MiniMaxDirectorMediaPreview({ item, asset }: { item: MiniMaxH3DirectorTimelineItem; asset?: WorkflowInputAssetRef }) {
  const src = asset ? buildWorkflowInputAssetUrl(asset) : null
  if (item.type === 'image' && src) {
    return <img src={src} alt={asset?.fileName || item.value} className="h-28 w-full object-cover" />
  }
  if (item.type === 'video' && src) {
    return <video src={src} preload="metadata" muted controls className="h-28 w-full bg-black object-cover" />
  }
  if (item.type === 'audio' && src) {
    return <audio src={src} preload="metadata" controls className="w-full" />
  }

  const Icon = item.type === 'image' ? ImageIcon : item.type === 'video' ? Film : Music2
  return (
    <div className="flex h-28 items-center justify-center bg-background/45 text-muted-foreground">
      <Icon className="h-7 w-7" />
    </div>
  )
}

/** Render DaSiWa MiniMax H3 Director inputs as a CoNAI-native reference board. */
export function MiniMaxH3DirectorDasiwaInput({ value, onChange }: MiniMaxH3DirectorDasiwaInputProps) {
  const { t } = useI18n()
  const visualInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const nodeValue = normalizeMiniMaxH3DirectorNodeValue(value)
  const parsedTimeline = parseMiniMaxH3DirectorTimeline(nodeValue.timeline_data)
  const timeline = parsedTimeline.timeline
  const assets = getMiniMaxH3DirectorAssets(nodeValue)
  const mode = nodeValue.mode
  const activeItems = timeline.items.filter((item) => item.enabled !== false)
  const displayedItems = mode === 'FL2VA'
    ? activeItems.filter((item) => item.type === 'image').sort((left, right) => left.slot - right.slot).slice(0, 2)
    : activeItems
  const visualItems = displayedItems.filter((item) => item.type !== 'audio').sort((left, right) => left.slot - right.slot)
  const audioItems = mode === 'REF2VA' ? displayedItems.filter((item) => item.type === 'audio').sort((left, right) => left.slot - right.slot) : []
  const selectedItem = timeline.items.find((item) => item.id === selectedItemId) ?? null
  const issues = useMemo(() => validateMiniMaxH3DirectorNodeValue(value), [value])
  const issueItemIds = useMemo(() => new Set(issues.flatMap((issue) => issue.itemId ? [issue.itemId] : [])), [issues])
  const invalidFields = useMemo(() => new Set(issues.flatMap((issue) => issue.field ? [issue.field] : [])), [issues])

  const emit = (
    inputPatch: Record<string, unknown>,
    nextTimeline = timeline,
    nextAssets = assets,
  ) => {
    onChange(buildMiniMaxH3DirectorNodeValue(nodeValue, inputPatch, nextTimeline, nextAssets))
  }

  const updateTimelineItem = (itemId: string, patch: Partial<MiniMaxH3DirectorTimelineItem>) => {
    emit({}, {
      ...timeline,
      items: timeline.items.map((item) => item.id === itemId ? { ...item, ...patch } : item),
    })
  }

  const removeTimelineItem = (itemId: string) => {
    const asset = assets[itemId]
    const nextAssets = { ...assets }
    delete nextAssets[itemId]
    emit({}, {
      ...timeline,
      items: timeline.items.filter((item) => item.id !== itemId),
    }, nextAssets)
    if (selectedItemId === itemId) {
      setSelectedItemId(null)
    }
    if (asset) {
      void deleteWorkflowInputAsset(asset.id).catch((error) => {
        setStatus(error instanceof Error ? error.message : t({ ko: '미디어 자산 정리에 실패했어.', en: 'Failed to clean up the media asset.' }))
      })
    }
  }

  const clearTimeline = () => {
    const removableAssets = Object.values(assets)
    setSelectedItemId(null)
    emit({ prompt: '' }, { ...timeline, items: [], prompt_blocks: [] }, {})
    void Promise.all(removableAssets.map((asset) => deleteWorkflowInputAsset(asset.id))).catch((error) => {
      setStatus(error instanceof Error ? error.message : t({ ko: '일부 미디어 자산 정리에 실패했어.', en: 'Failed to clean up some media assets.' }))
    })
  }

  const canAcceptFile = (type: MiniMaxH3DirectorMediaType, items: MiniMaxH3DirectorTimelineItem[]) => {
    if (mode === 'FL2VA') {
      return type === 'image' && items.filter((item) => item.enabled !== false && item.type === 'image').length < 2
    }

    const typeCount = items.filter((item) => item.enabled !== false && item.type === type).length
    return typeCount < MAX_MEDIA_COUNT[type] && items.filter((item) => item.enabled !== false).length < MAX_MEDIA_COUNT.total
  }

  const handleFiles = async (files: File[], lane: 'visual' | 'audio') => {
    if (files.length === 0 || isUploading) {
      return
    }

    setIsUploading(true)
    let nextTimeline: MiniMaxH3DirectorTimeline = { ...timeline, items: [...timeline.items] }
    const nextAssets = { ...assets }
    let hasChanges = false

    try {
      for (const file of files) {
        const type = inferMiniMaxH3DirectorMediaType(file)
        const laneMatches = lane === 'audio' ? type === 'audio' : type === 'image' || type === 'video'
        if (!type || !laneMatches) {
          setStatus(t({ ko: '선택한 레인에 맞는 미디어 파일을 골라줘.', en: 'Choose media that matches the selected lane.' }))
          continue
        }
        if (!canAcceptFile(type, nextTimeline.items)) {
          setStatus(mode === 'FL2VA'
            ? t({ ko: 'FL2VA는 이미지를 최대 2개까지 사용할 수 있어.', en: 'FL2VA supports at most two images.' })
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
        const slotCapacity = targetLane === 'audio' ? MAX_MEDIA_COUNT.audio : mode === 'FL2VA' ? 2 : MAX_MEDIA_COUNT.image + MAX_MEDIA_COUNT.video
        const slot = getNextMediaSlot(nextTimeline.items, targetLane, slotCapacity)
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
        setSelectedItemId(id)
        setStatus(sourceDuration !== null && sourceDuration > 15
          ? t({ ko: '{name}을 추가하고 처음 15초로 잘랐어.', en: 'Added {name} and cropped it to the first 15 seconds.' }, { name: file.name })
          : t({ ko: '{name}을 추가했어.', en: 'Added {name}.' }, { name: file.name }))
      }

    } catch (error) {
      setStatus(error instanceof Error ? error.message : t({ ko: '미디어 업로드에 실패했어.', en: 'Media upload failed.' }))
    } finally {
      if (hasChanges) {
        emit({}, nextTimeline, nextAssets)
      }
      setIsUploading(false)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>, lane: 'visual' | 'audio') => {
    event.preventDefault()
    const movedItemId = event.dataTransfer.getData('application/x-conai-minimax-item')
    if (movedItemId) {
      const targetItemId = event.currentTarget.dataset.itemId
      const moved = timeline.items.find((item) => item.id === movedItemId)
      const target = timeline.items.find((item) => item.id === targetItemId)
      if (moved && target && getMediaLane(moved) === getMediaLane(target)) {
        emit({}, {
          ...timeline,
          items: timeline.items.map((item) => {
            if (item.id === moved.id) return { ...item, slot: target.slot, start: target.slot }
            if (item.id === target.id) return { ...item, slot: moved.slot, start: moved.slot }
            return item
          }),
        })
      }
      return
    }

    void handleFiles(Array.from(event.dataTransfer.files), lane)
  }

  const moveSelectedItem = (item: MiniMaxH3DirectorTimelineItem, direction: -1 | 1) => {
    const laneItems = timeline.items.filter((candidate) => getMediaLane(candidate) === getMediaLane(item)).sort((left, right) => left.slot - right.slot)
    const index = laneItems.findIndex((candidate) => candidate.id === item.id)
    const other = laneItems[index + direction]
    if (!other) return
    emit({}, {
      ...timeline,
      items: timeline.items.map((candidate) => {
        if (candidate.id === item.id) return { ...candidate, slot: other.slot, start: other.slot }
        if (candidate.id === other.id) return { ...candidate, slot: item.slot, start: item.slot }
        return candidate
      }),
    })
  }

  const renderMediaCard = (item: MiniMaxH3DirectorTimelineItem, typeIndex: number) => {
    const asset = assets[item.id]
    const isSelected = selectedItemId === item.id
    const sourceDuration = Math.max(2, Number(item.source_duration ?? item.duration ?? 2))
    const trimStart = Number(item.trim_start ?? 0)
    const trimEnd = Number(item.trim_end ?? sourceDuration)
    return (
      <div
        key={item.id}
        data-item-id={item.id}
        draggable
        onDragStart={(event) => event.dataTransfer.setData('application/x-conai-minimax-item', item.id)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleDrop(event, getMediaLane(item))}
        onClick={() => setSelectedItemId(item.id)}
        className={cn(
          'overflow-hidden rounded-sm border bg-background/25 transition',
          isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border/80 hover:border-primary/45',
          issueItemIds.has(item.id) && 'border-destructive ring-2 ring-destructive/20',
        )}
      >
        <div className="relative">
          <MiniMaxDirectorMediaPreview item={item} asset={asset} />
          <Badge className="absolute left-2 top-2 bg-background/85">{formatMediaTypeLabel(item.type, typeIndex)}</Badge>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="absolute right-1 top-1 bg-background/80"
            aria-label={t({ ko: '{name} 제거', en: 'Remove {name}' }, { name: asset?.fileName || item.value })}
            title={t({ ko: '제거', en: 'Remove' })}
            onClick={(event) => {
              event.stopPropagation()
              removeTimelineItem(item.id)
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2 p-3">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-foreground">{asset?.fileName || item.value}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {asset ? formatMediaBytes(asset.bytes) : t({ ko: '기존 Comfy 입력', en: 'Existing Comfy input' })}
            </div>
          </div>

          {item.type === 'video' ? (
            <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
              {([
                ['video', 'V'],
                ['audio', 'A'],
                ['video_audio', 'V+A'],
              ] as Array<[MiniMaxH3DirectorVideoMode, string]>).map(([videoMode, label]) => (
                <Button
                  key={videoMode}
                  type="button"
                  size="sm"
                  variant={(item.media_mode ?? 'video') === videoMode ? 'default' : 'outline'}
                  className="h-7 px-2 text-[11px]"
                  onClick={() => updateTimelineItem(item.id, { media_mode: videoMode })}
                >
                  {label}
                </Button>
              ))}
            </div>
          ) : null}

          {item.type === 'audio' && Array.isArray(item.waveform_peaks) && item.waveform_peaks.length > 0 ? (
            <div className="flex h-10 items-center gap-px overflow-hidden rounded-sm bg-surface-low px-1" aria-hidden="true">
              {item.waveform_peaks.map((peak, index) => (
                <span key={`${item.id}-peak-${index}`} className="min-w-px flex-1 bg-primary/70" style={{ height: `${Math.max(8, Math.round(peak * 100))}%` }} />
              ))}
            </div>
          ) : null}

          {item.type !== 'image' ? (
            <div className="grid grid-cols-2 gap-2" onClick={(event) => event.stopPropagation()}>
              <label className="space-y-1 text-[11px] text-muted-foreground">
                <span>{t({ ko: '시작', en: 'Start' })}</span>
                <ScrubbableNumberInput
                  min={0}
                  max={Math.max(0, trimEnd - 2)}
                  step={0.25}
                  value={String(trimStart)}
                  onChange={(nextValue) => {
                    const nextStart = Math.max(0, Math.min(trimEnd - 2, Number(nextValue)))
                    updateTimelineItem(item.id, { trim_start: nextStart, duration: trimEnd - nextStart })
                  }}
                />
              </label>
              <label className="space-y-1 text-[11px] text-muted-foreground">
                <span>{t({ ko: '끝', en: 'End' })}</span>
                <ScrubbableNumberInput
                  min={trimStart + 2}
                  max={sourceDuration}
                  step={0.25}
                  value={String(trimEnd)}
                  onChange={(nextValue) => {
                    const nextEnd = Math.min(sourceDuration, Math.max(trimStart + 2, Number(nextValue)))
                    updateTimelineItem(item.id, { trim_end: nextEnd, duration: nextEnd - trimStart })
                  }}
                />
              </label>
            </div>
          ) : null}

          <div className="flex justify-end gap-1">
            <Button type="button" size="icon-sm" variant="ghost" onClick={(event) => { event.stopPropagation(); moveSelectedItem(item, -1) }} aria-label={t({ ko: '왼쪽으로 이동', en: 'Move left' })} title={t({ ko: '왼쪽으로 이동', en: 'Move left' })}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button type="button" size="icon-sm" variant="ghost" onClick={(event) => { event.stopPropagation(); moveSelectedItem(item, 1) }} aria-label={t({ ko: '오른쪽으로 이동', en: 'Move right' })} title={t({ ko: '오른쪽으로 이동', en: 'Move right' })}>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-foreground">MiniMax H3 Director</div>
          <Badge variant="outline">DaSiWa</Badge>
        </div>
        <div className="flex gap-1">
          {(['FL2VA', 'REF2VA'] as const).map((nextMode) => (
            <Button key={nextMode} type="button" size="sm" variant={mode === nextMode ? 'default' : 'outline'} onClick={() => emit({ mode: nextMode })}>
              {nextMode}
            </Button>
          ))}
          {timeline.items.length > 0 || String(nodeValue.prompt).trim() ? (
            <Button type="button" size="icon-sm" variant="ghost" onClick={clearTimeline} aria-label={t({ ko: 'Director 초기화', en: 'Reset Director' })} title={t({ ko: '초기화', en: 'Reset' })}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={cn('space-y-1 text-xs text-muted-foreground', invalidFields.has('width') && 'text-destructive')}>
          <span>{t({ ko: '너비', en: 'Width' })}</span>
          <ScrubbableNumberInput min={32} max={8192} step={32} value={String(nodeValue.width)} className={cn(invalidFields.has('width') && 'border-destructive')} onChange={(nextValue) => emit({ width: Number(nextValue) })} />
        </label>
        <label className={cn('space-y-1 text-xs text-muted-foreground', invalidFields.has('height') && 'text-destructive')}>
          <span>{t({ ko: '높이', en: 'Height' })}</span>
          <ScrubbableNumberInput min={32} max={8192} step={32} value={String(nodeValue.height)} className={cn(invalidFields.has('height') && 'border-destructive')} onChange={(nextValue) => emit({ height: Number(nextValue) })} />
        </label>
        <label className={cn('space-y-1 text-xs text-muted-foreground', invalidFields.has('duration') && 'text-destructive')}>
          <span>{t({ ko: '길이(초)', en: 'Duration (seconds)' })}</span>
          <ScrubbableNumberInput min={1} max={1000} step={1} value={String(nodeValue.duration)} className={cn(invalidFields.has('duration') && 'border-destructive')} onChange={(nextValue) => emit({ duration: Number(nextValue) })} />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>{t({ ko: '참조 이미지 크기', en: 'Reference image size' })}</span>
          <Select value={String(nodeValue.ref_image_size)} onChange={(event) => emit({ ref_image_size: event.target.value })}>
            <option value="match">match</option>
            <option value="max">max</option>
          </Select>
        </label>
      </div>

      {issues.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>{t({ ko: 'Director 입력 확인', en: 'Check Director inputs' })}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {issues.slice(0, 6).map((issue) => (
                <li key={`${issue.code}-${issue.itemId ?? issue.field ?? ''}`}>
                  {issue.itemId ? (
                    <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => setSelectedItemId(issue.itemId ?? null)}>
                      {t({ ko: issue.ko, en: issue.en })}
                    </button>
                  ) : t({ ko: issue.ko, en: issue.en })}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div
        className="space-y-3 rounded-sm border border-border/80 bg-surface-low/50 p-3"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleDrop(event, 'visual')}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground"><Film className="h-4 w-4" />{t({ ko: '이미지 / 영상', en: 'Image / Video' })}</div>
          <Button type="button" size="icon-sm" variant="outline" disabled={isUploading} onClick={() => visualInputRef.current?.click()} aria-label={t({ ko: '이미지 또는 영상 추가', en: 'Add image or video' })} title={t({ ko: '추가', en: 'Add' })}>
            <Plus className="h-4 w-4" />
          </Button>
          <input ref={visualInputRef} type="file" accept={mode === 'FL2VA' ? 'image/*' : 'image/*,video/*'} multiple hidden onChange={(event) => { void handleFiles(Array.from(event.target.files ?? []), 'visual'); event.target.value = '' }} />
        </div>
        {visualItems.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visualItems.map((item) => renderMediaCard(item, visualItems.filter((candidate) => candidate.type === item.type && candidate.slot <= item.slot).length))}
          </div>
        ) : (
          <button type="button" className="flex min-h-28 w-full items-center justify-center rounded-sm border border-dashed border-border/80 text-xs text-muted-foreground hover:border-primary/45 hover:text-foreground" onClick={() => visualInputRef.current?.click()}>
            {mode === 'FL2VA' ? t({ ko: '이미지를 추가하거나 여기에 놓아줘.', en: 'Add images or drop them here.' }) : t({ ko: '이미지·영상을 추가하거나 여기에 놓아줘.', en: 'Add images or videos, or drop them here.' })}
          </button>
        )}
      </div>

      <div
        className={cn('space-y-3 rounded-sm border p-3', mode === 'FL2VA' ? 'border-border/50 bg-muted/20 opacity-60' : 'border-border/80 bg-surface-low/50')}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => mode === 'REF2VA' ? handleDrop(event, 'audio') : event.preventDefault()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground"><Music2 className="h-4 w-4" />{t({ ko: '오디오', en: 'Audio' })}</div>
          <Button type="button" size="icon-sm" variant="outline" disabled={mode === 'FL2VA' || isUploading} onClick={() => audioInputRef.current?.click()} aria-label={t({ ko: '오디오 추가', en: 'Add audio' })} title={t({ ko: '추가', en: 'Add' })}>
            <Plus className="h-4 w-4" />
          </Button>
          <input ref={audioInputRef} type="file" accept="audio/*" multiple hidden onChange={(event) => { void handleFiles(Array.from(event.target.files ?? []), 'audio'); event.target.value = '' }} />
        </div>
        {mode === 'FL2VA' ? (
          <div className="flex min-h-20 items-center justify-center rounded-sm border border-dashed border-border/60 text-xs text-muted-foreground">{t({ ko: 'FL2VA에서는 오디오 참조를 사용하지 않아.', en: 'FL2VA does not use audio references.' })}</div>
        ) : audioItems.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {audioItems.map((item, index) => renderMediaCard(item, index + 1))}
          </div>
        ) : (
          <button type="button" className="flex min-h-20 w-full items-center justify-center rounded-sm border border-dashed border-border/80 text-xs text-muted-foreground hover:border-primary/45 hover:text-foreground" onClick={() => audioInputRef.current?.click()}>
            {t({ ko: '오디오를 추가하거나 여기에 놓아줘.', en: 'Add audio or drop it here.' })}
          </button>
        )}
      </div>

      <label className="block space-y-1.5 text-xs text-muted-foreground">
        <span>{selectedItem && selectedItem.type !== 'audio'
          ? t({ ko: '미디어 프롬프트 · {name}', en: 'Media prompt · {name}' }, { name: assets[selectedItem.id]?.fileName || selectedItem.value })
          : t({ ko: '미디어 프롬프트', en: 'Media prompt' })}</span>
        <Textarea
          rows={4}
          disabled={!selectedItem || selectedItem.type === 'audio'}
          value={selectedItem && selectedItem.type !== 'audio' ? String(selectedItem.prompt ?? '') : ''}
          placeholder={t({ ko: '이미지 또는 영상을 선택하면 개별 역할을 적을 수 있어.', en: 'Select an image or video to describe its role.' })}
          onChange={(event) => selectedItem && updateTimelineItem(selectedItem.id, { prompt: event.target.value })}
        />
      </label>

      <label className="block space-y-1.5 text-xs text-muted-foreground">
        <span>{t({ ko: '글로벌 프롬프트', en: 'Global prompt' })}</span>
        <Textarea rows={5} value={String(nodeValue.prompt)} placeholder={t({ ko: '전체 영상 프롬프트', en: 'Global video prompt' })} onChange={(event) => emit({ prompt: event.target.value })} />
      </label>

      {status ? <div className="rounded-sm border border-border/70 bg-background/35 px-3 py-2 text-xs text-muted-foreground">{status}</div> : null}
    </div>
  )
}
