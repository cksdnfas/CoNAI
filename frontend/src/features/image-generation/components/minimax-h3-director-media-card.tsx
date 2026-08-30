import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Film, ImageIcon, Music2, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { buildWorkflowInputAssetUrl, type WorkflowInputAssetRef } from '@/lib/api-workflow-input-assets'
import { cn } from '@/lib/utils'
import {
  formatMiniMaxH3DirectorAspectRatio,
  type MiniMaxH3DirectorTimelineItem,
} from './minimax-h3-director-dasiwa-utils'

const LONG_PRESS_DELAY_MS = 280
const POINTER_MOVE_TOLERANCE_PX = 8

type MiniMaxH3DirectorMediaCardProps = {
  item: MiniMaxH3DirectorTimelineItem
  asset?: WorkflowInputAssetRef
  label: string
  hasIssue: boolean
  menuOpen: boolean
  disabled?: boolean
  sorting?: boolean
  children?: ReactNode
  replaceLabel: string
  deleteLabel: string
  menuLabel: string
  onToggleMenu: () => void
  onRequestReplace: () => void
  onDelete: () => void
  onReplaceFile: (file: File) => void
  onSourceDimensionsChange: (width: number, height: number) => void
  onSortStart: () => void
  onSortOver: (targetItemId: string) => void
  onSortEnd: () => void
  onKeyboardMove: (direction: -1 | 1) => void
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('[data-minimax-interactive="true"]'))
}

function MiniMaxDirectorMediaPreview({
  item,
  asset,
  onSourceDimensionsChange,
}: {
  item: MiniMaxH3DirectorTimelineItem
  asset?: WorkflowInputAssetRef
  onSourceDimensionsChange: (width: number, height: number) => void
}) {
  const src = asset ? buildWorkflowInputAssetUrl(asset) : null
  const [videoPoster, setVideoPoster] = useState<string | null>(null)

  useEffect(() => {
    setVideoPoster(null)
    if (item.type !== 'video' || !src) return

    let disposed = false
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    video.src = src
    video.onloadeddata = () => {
      if (disposed || video.videoWidth <= 0 || video.videoHeight <= 0) return
      try {
        const canvas = document.createElement('canvas')
        const scale = Math.min(1, 640 / video.videoWidth)
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
        setVideoPoster(canvas.toDataURL('image/jpeg', 0.72))
      } catch {
        setVideoPoster(null)
      }
    }
    return () => {
      disposed = true
      video.removeAttribute('src')
      video.load()
    }
  }, [item.type, src])

  if (item.type === 'image' && src) {
    return (
      <img
        src={src}
        alt={asset?.fileName || item.value}
        draggable={false}
        className="block h-auto max-h-64 w-auto max-w-full object-contain"
        onLoad={(event) => onSourceDimensionsChange(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
      />
    )
  }
  if (item.type === 'video' && src) {
    return (
      <video
        src={src}
        poster={videoPoster ?? undefined}
        aria-label={asset?.fileName || item.value}
        preload="metadata"
        muted
        playsInline
        draggable={false}
        className="block h-auto max-h-64 w-auto max-w-full bg-black object-contain"
        onLoadedMetadata={(event) => onSourceDimensionsChange(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
      />
    )
  }

  const Icon = item.type === 'image' ? ImageIcon : item.type === 'video' ? Film : Music2
  return <Icon className="h-7 w-7 text-muted-foreground" />
}

/** Compact media card with click actions and delayed pointer sorting for mouse and touch. */
export function MiniMaxH3DirectorMediaCard({
  item,
  asset,
  label,
  hasIssue,
  menuOpen,
  disabled = false,
  sorting = false,
  children,
  replaceLabel,
  deleteLabel,
  menuLabel,
  onToggleMenu,
  onRequestReplace,
  onDelete,
  onReplaceFile,
  onSourceDimensionsChange,
  onSortStart,
  onSortOver,
  onSortEnd,
  onKeyboardMove,
}: MiniMaxH3DirectorMediaCardProps) {
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerRef = useRef<{ id: number; x: number; y: number; activated: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const aspectRatioSourceKey = `${item.type}:${asset?.id ?? item.value}`
  const storedAspectRatio = formatMiniMaxH3DirectorAspectRatio(Number(item.source_width), Number(item.source_height))
  const [aspectRatioState, setAspectRatioState] = useState<{ sourceKey: string; value: string } | null>(null)
  const aspectRatio = storedAspectRatio ?? (aspectRatioState?.sourceKey === aspectRatioSourceKey ? aspectRatioState.value : null)
  const handleSourceDimensionsChange = (width: number, height: number) => {
    const nextAspectRatio = formatMiniMaxH3DirectorAspectRatio(width, height)
    setAspectRatioState(nextAspectRatio ? { sourceKey: aspectRatioSourceKey, value: nextAspectRatio } : null)
    if (width > 0 && height > 0 && (Number(item.source_width) !== width || Number(item.source_height) !== height)) {
      onSourceDimensionsChange(width, height)
    }
  }

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  useEffect(() => () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
    }
  }, [])

  const finishPointer = (event: PointerEvent<HTMLDivElement>) => {
    cancelLongPress()
    const pointer = pointerRef.current
    pointerRef.current = null
    if (!pointer || pointer.id !== event.pointerId || !pointer.activated) {
      return
    }

    suppressClickRef.current = true
    onSortEnd()
    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 0)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || isInteractiveTarget(event.target)) {
      return
    }
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowUp')) {
      event.preventDefault()
      onKeyboardMove(-1)
      return
    }
    if (event.altKey && (event.key === 'ArrowRight' || event.key === 'ArrowDown')) {
      event.preventDefault()
      onKeyboardMove(1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggleMenu()
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (disabled) {
      return
    }
    const [file] = Array.from(event.dataTransfer.files)
    if (file) {
      onReplaceFile(file)
    }
  }

  return (
    <div
      data-minimax-card-id={item.id}
      role="group"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || isInteractiveTarget(event.target)) {
          return
        }
        cancelLongPress()
        const card = event.currentTarget
        const pointerId = event.pointerId
        pointerRef.current = { id: pointerId, x: event.clientX, y: event.clientY, activated: false }
        longPressTimerRef.current = setTimeout(() => {
          const pointer = pointerRef.current
          if (!pointer || pointer.id !== pointerId) {
            return
          }
          pointer.activated = true
          card.setPointerCapture(pointerId)
          onSortStart()
        }, LONG_PRESS_DELAY_MS)
      }}
      onPointerMove={(event) => {
        const pointer = pointerRef.current
        if (!pointer || pointer.id !== event.pointerId) {
          return
        }
        if (!pointer.activated) {
          if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > POINTER_MOVE_TOLERANCE_PX) {
            cancelLongPress()
            pointerRef.current = null
          }
          return
        }
        event.preventDefault()
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-minimax-card-id]')
        const targetItemId = target?.dataset.minimaxCardId
        if (targetItemId && targetItemId !== item.id) {
          onSortOver(targetItemId)
        }
      }}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onDragOver={(event) => {
        if (!disabled && event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onDrop={handleDrop}
      onClick={(event) => {
        event.stopPropagation()
        if (disabled || suppressClickRef.current || isInteractiveTarget(event.target)) {
          return
        }
        onToggleMenu()
      }}
      className={cn(
        'relative min-w-0 overflow-hidden rounded-sm border bg-background/25 transition touch-pan-y select-none',
        disabled ? 'cursor-not-allowed opacity-65' : 'cursor-pointer hover:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        sorting && 'z-10 scale-[1.015] border-primary shadow-lg ring-2 ring-primary/25',
        hasIssue ? 'border-destructive ring-2 ring-destructive/20' : 'border-border/80',
      )}
    >
      <div className="relative flex min-h-28 max-h-64 w-full items-center justify-center overflow-hidden bg-black/20 p-1">
        <MiniMaxDirectorMediaPreview item={item} asset={asset} onSourceDimensionsChange={handleSourceDimensionsChange} />
        <Badge className="absolute left-2 top-2 max-w-[calc(100%-4rem)] truncate bg-background/88">{label}</Badge>
      </div>

      {aspectRatio || children ? (
        <div data-minimax-interactive="true" className="space-y-2 border-t border-border/70 p-3" onClick={(event) => event.stopPropagation()}>
          {aspectRatio ? (
            <Badge data-minimax-aspect-ratio variant="outline" className="normal-case tracking-normal tabular-nums">
              {aspectRatio}
            </Badge>
          ) : null}
          {children}
        </div>
      ) : null}

      {menuOpen && !disabled ? (
        <div data-minimax-interactive="true" role="menu" aria-label={menuLabel} className="absolute inset-x-2 top-11 z-20 overflow-hidden rounded-sm border border-border bg-background/96 p-1 shadow-xl backdrop-blur">
          <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-xs text-foreground hover:bg-surface-high" onClick={(event) => { event.stopPropagation(); onRequestReplace() }}>
            <RefreshCw className="h-4 w-4" />{replaceLabel}
          </button>
          <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-xs text-destructive hover:bg-destructive/10" onClick={(event) => { event.stopPropagation(); onDelete() }}>
            <Trash2 className="h-4 w-4" />{deleteLabel}
          </button>
        </div>
      ) : null}
    </div>
  )
}
