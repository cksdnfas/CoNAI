import 'plyr/dist/plyr.css'
import './image-detail-media.css'

import type Plyr from 'plyr'
import { RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react'
import { Button } from '@/components/ui/button'
import type { ImageRecord } from '@/types/image'
import { getImageListMediaKind } from '@/features/images/components/image-list/image-list-utils'
import { cn } from '@/lib/utils'

interface ImageDetailMediaProps {
  image: ImageRecord
  renderUrl: string | null
  className?: string
}

interface PointerPosition {
  x: number
  y: number
}

const MIN_SCALE = 1
const MAX_SCALE = 6
const ZOOM_STEP = 0.24
const DOUBLE_TAP_SCALE = 2
const ROTATION_STEP = 90

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizeRotation(value: number) {
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function getPointerDistance(first: PointerPosition, second: PointerPosition) {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

/** Render the main detail media using the correct element for image, GIF, or video files. */
export function ImageDetailMedia({ image, renderUrl, className }: ImageDetailMediaProps) {
  if (!renderUrl) {
    return <div className="text-sm text-muted-foreground">표시할 이미지가 없어</div>
  }

  const mediaKind = getImageListMediaKind(image)
  const altText = image.composite_hash || String(image.id)

  const mediaClassName = className ?? 'max-h-[80vh] w-full object-contain'

  if (mediaKind === 'video') {
    return <EnhancedVideoDetailMedia renderUrl={renderUrl} className={mediaClassName} />
  }

  return <InteractiveImageDetailMedia renderUrl={renderUrl} altText={altText} className={mediaClassName} />
}

function EnhancedVideoDetailMedia({ renderUrl, className }: { renderUrl: string; className: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<Plyr | null>(null)

  useEffect(() => {
    let disposed = false

    const setup = async () => {
      const node = videoRef.current
      if (!node) {
        return
      }

      const { default: PlyrClass } = await import('plyr')
      if (disposed || !videoRef.current) {
        return
      }

      playerRef.current?.destroy()
      playerRef.current = new PlyrClass(videoRef.current, {
        autoplay: false,
        controls: ['play-large', 'restart', 'rewind', 'play', 'fast-forward', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'pip', 'airplay', 'fullscreen'],
        hideControls: true,
        keyboard: { focused: true, global: false },
        clickToPlay: true,
        resetOnEnd: false,
        seekTime: 5,
        fullscreen: { enabled: true, iosNative: true },
        tooltips: { controls: true, seek: true },
      })
    }

    void setup()

    return () => {
      disposed = true
      playerRef.current?.destroy()
      playerRef.current = null
    }
  }, [renderUrl])

  return (
    <div
      className={cn('conai-video-player w-full overflow-hidden rounded-sm bg-black', className)}
      style={{
        ['--plyr-color-main' as string]: 'var(--primary)',
        ['--plyr-control-icon-size' as string]: '18px',
        ['--plyr-control-spacing' as string]: '0.5rem',
        ['--plyr-control-radius' as string]: '999px',
        ['--plyr-video-control-background-hover' as string]: 'color-mix(in srgb, var(--primary) 32%, black)',
        ['--plyr-video-controls-background' as string]: 'linear-gradient(transparent, rgba(0, 0, 0, 0.82))',
        ['--plyr-menu-background' as string]: 'rgba(18, 18, 22, 0.96)',
        ['--plyr-menu-color' as string]: 'white',
        ['--plyr-menu-radius' as string]: '14px',
        ['--plyr-range-thumb-height' as string]: '13px',
        ['--plyr-range-thumb-shadow' as string]: '0 0 0 4px rgb(249 94 20 / 0.18)',
        ['--plyr-video-progress-buffered-background' as string]: 'rgb(255 255 255 / 0.14)',
      }}
    >
      <video
        key={renderUrl}
        ref={videoRef}
        className="conai-video-player__media h-full w-full bg-black object-contain"
        controls
        playsInline
        preload="metadata"
      >
        <source src={renderUrl} />
      </video>
    </div>
  )
}

function InteractiveImageDetailMedia({
  renderUrl,
  altText,
  className,
}: {
  renderUrl: string
  altText: string
  className: string
}) {
  const pointersRef = useRef(new Map<number, PointerPosition>())
  const pinchStartDistanceRef = useRef<number | null>(null)
  const pinchStartScaleRef = useRef(MIN_SCALE)
  const panOriginRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const scaleRef = useRef(MIN_SCALE)
  const rotationRef = useRef(0)
  const offsetRef = useRef({ x: 0, y: 0 })
  const [scale, setScale] = useState(MIN_SCALE)
  const [rotation, setRotation] = useState(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isGestureActive, setIsGestureActive] = useState(false)

  useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  useEffect(() => {
    rotationRef.current = rotation
  }, [rotation])

  useEffect(() => {
    offsetRef.current = offset
  }, [offset])

  useEffect(() => {
    pointersRef.current.clear()
    pinchStartDistanceRef.current = null
    panOriginRef.current = null
    scaleRef.current = MIN_SCALE
    rotationRef.current = 0
    offsetRef.current = { x: 0, y: 0 }
    setScale(MIN_SCALE)
    setRotation(0)
    setOffset({ x: 0, y: 0 })
    setIsGestureActive(false)
  }, [renderUrl])

  const isPannable = scale > MIN_SCALE + 0.001 || rotation !== 0
  const transformSummary = `${Math.round(scale * 100)}%${rotation !== 0 ? ` · ${rotation}°` : ''}`

  const resetView = () => {
    scaleRef.current = MIN_SCALE
    rotationRef.current = 0
    offsetRef.current = { x: 0, y: 0 }
    setScale(MIN_SCALE)
    setRotation(0)
    setOffset({ x: 0, y: 0 })
  }

  const applyScale = (nextScale: number) => {
    const clampedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE)
    scaleRef.current = clampedScale
    setScale(clampedScale)

    if (clampedScale <= MIN_SCALE + 0.001) {
      offsetRef.current = { x: 0, y: 0 }
      setOffset({ x: 0, y: 0 })
    }
  }

  const zoomBy = (delta: number) => {
    applyScale(scaleRef.current + delta)
  }

  const rotateBy = (delta: number) => {
    const nextRotation = normalizeRotation(rotationRef.current + delta)
    rotationRef.current = nextRotation
    setRotation(nextRotation)
  }

  const syncRemainingPointerAsPanOrigin = () => {
    const remainingEntry = Array.from(pointersRef.current.entries())[0]
    if (!remainingEntry) {
      panOriginRef.current = null
      return
    }

    const [pointerId, point] = remainingEntry
    panOriginRef.current = {
      pointerId,
      startX: point.x,
      startY: point.y,
      offsetX: offsetRef.current.x,
      offsetY: offsetRef.current.y,
    }
  }

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    zoomBy(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return
    }

    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    setIsGestureActive(true)

    if (pointersRef.current.size === 1) {
      panOriginRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: offsetRef.current.x,
        offsetY: offsetRef.current.y,
      }
      pinchStartDistanceRef.current = null
      return
    }

    if (pointersRef.current.size >= 2) {
      const [first, second] = Array.from(pointersRef.current.values())
      pinchStartDistanceRef.current = getPointerDistance(first, second)
      pinchStartScaleRef.current = scaleRef.current
      panOriginRef.current = null
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) {
      return
    }

    event.stopPropagation()
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointersRef.current.size >= 2) {
      const [first, second] = Array.from(pointersRef.current.values())
      const startDistance = pinchStartDistanceRef.current
      if (!startDistance || startDistance <= 0) {
        return
      }

      event.preventDefault()
      const nextDistance = getPointerDistance(first, second)
      applyScale(pinchStartScaleRef.current * (nextDistance / startDistance))
      return
    }

    if (!isPannable) {
      return
    }

    const panOrigin = panOriginRef.current
    if (!panOrigin || panOrigin.pointerId !== event.pointerId) {
      return
    }

    event.preventDefault()
    const nextOffset = {
      x: panOrigin.offsetX + (event.clientX - panOrigin.startX),
      y: panOrigin.offsetY + (event.clientY - panOrigin.startY),
    }
    offsetRef.current = nextOffset
    setOffset(nextOffset)
  }

  const finishPointerInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation()

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    pointersRef.current.delete(event.pointerId)

    if (pointersRef.current.size >= 2) {
      const [first, second] = Array.from(pointersRef.current.values())
      pinchStartDistanceRef.current = getPointerDistance(first, second)
      pinchStartScaleRef.current = scaleRef.current
      return
    }

    if (pointersRef.current.size === 1) {
      pinchStartDistanceRef.current = null
      syncRemainingPointerAsPanOrigin()
      return
    }

    pinchStartDistanceRef.current = null
    panOriginRef.current = null
    setIsGestureActive(false)

    if (scaleRef.current <= MIN_SCALE + 0.001) {
      offsetRef.current = { x: 0, y: 0 }
      setOffset({ x: 0, y: 0 })
    }
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full border border-white/12 bg-black/58 px-2 py-2 text-white shadow-lg backdrop-blur-sm">
        <div className="hidden px-2 text-[11px] text-white/72 sm:block">보기 전용 · {transformSummary}</div>
        <Button size="icon-sm" type="button" variant="secondary" className="border-white/12 bg-white/10 text-white hover:bg-white/18 hover:text-white" onClick={() => zoomBy(-ZOOM_STEP)} title="축소" aria-label="축소">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button size="icon-sm" type="button" variant="secondary" className="border-white/12 bg-white/10 text-white hover:bg-white/18 hover:text-white" onClick={() => zoomBy(ZOOM_STEP)} title="확대" aria-label="확대">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button size="icon-sm" type="button" variant="secondary" className="border-white/12 bg-white/10 text-white hover:bg-white/18 hover:text-white" onClick={() => rotateBy(-ROTATION_STEP)} title="왼쪽 회전" aria-label="왼쪽 회전">
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button size="icon-sm" type="button" variant="secondary" className="border-white/12 bg-white/10 text-white hover:bg-white/18 hover:text-white" onClick={() => rotateBy(ROTATION_STEP)} title="오른쪽 회전" aria-label="오른쪽 회전">
          <RotateCw className="h-4 w-4" />
        </Button>
        <Button size="sm" type="button" variant="secondary" className="border-white/12 bg-white/10 px-3 text-white hover:bg-white/18 hover:text-white" onClick={resetView} title="초기화" aria-label="초기화">
          초기화
        </Button>
      </div>

      <div
        className={cn(
          'flex h-full w-full items-center justify-center overflow-hidden select-none',
          isPannable ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in',
        )}
        style={{ touchAction: 'none' }}
        onWheel={handleWheel}
        onDoubleClick={() => {
          if (scaleRef.current > MIN_SCALE + 0.001) {
            resetView()
            return
          }

          applyScale(DOUBLE_TAP_SCALE)
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerInteraction}
        onPointerCancel={finishPointerInteraction}
      >
        <div
          className={cn('will-change-transform', !isGestureActive && 'transition-transform duration-150 ease-out')}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
            transformOrigin: 'center center',
          }}
        >
          <img src={renderUrl} alt={altText} className={cn(className, 'pointer-events-none select-none')} draggable={false} />
        </div>
      </div>
    </div>
  )
}
