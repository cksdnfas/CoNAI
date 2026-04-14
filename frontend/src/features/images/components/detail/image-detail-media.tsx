import { ChevronLeft, ChevronRight, Lock, RotateCcw, RotateCw, Undo2, Unlock, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Button } from '@/components/ui/button'
import type { ImageRecord } from '@/types/image'
import { getImageListMediaKind } from '@/features/images/components/image-list/image-list-utils'
import { cn } from '@/lib/utils'
import { EnhancedVideoPlayer } from './enhanced-video-player'

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
const IMAGE_WHEEL_ZOOM_ENABLED_STORAGE_KEY = 'conai:image-detail-media:wheel-zoom-enabled'
const IMAGE_CONTROLS_COLLAPSED_STORAGE_KEY = 'conai:image-detail-media:controls-collapsed'

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

function loadImageWheelZoomEnabled() {
  if (typeof window === 'undefined') {
    return true
  }

  const savedValue = window.localStorage.getItem(IMAGE_WHEEL_ZOOM_ENABLED_STORAGE_KEY)
  return savedValue !== 'false'
}

function persistImageWheelZoomEnabled(enabled: boolean) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(IMAGE_WHEEL_ZOOM_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false')
}

function loadImageControlsCollapsed() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem(IMAGE_CONTROLS_COLLAPSED_STORAGE_KEY) === 'true'
}

function persistImageControlsCollapsed(collapsed: boolean) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(IMAGE_CONTROLS_COLLAPSED_STORAGE_KEY, collapsed ? 'true' : 'false')
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
    return <EnhancedVideoPlayer renderUrl={renderUrl} className={mediaClassName} loop autoPlay />
  }

  return <InteractiveImageDetailMedia renderUrl={renderUrl} altText={altText} className={mediaClassName} />
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
  const viewportRef = useRef<HTMLDivElement | null>(null)
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
  const [isWheelZoomEnabled, setIsWheelZoomEnabled] = useState(() => loadImageWheelZoomEnabled())
  const [isControlsCollapsed, setIsControlsCollapsed] = useState(() => loadImageControlsCollapsed())

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

  const resetView = useCallback(() => {
    scaleRef.current = MIN_SCALE
    rotationRef.current = 0
    offsetRef.current = { x: 0, y: 0 }
    setScale(MIN_SCALE)
    setRotation(0)
    setOffset({ x: 0, y: 0 })
  }, [])

  const applyScale = useCallback((nextScale: number) => {
    const clampedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE)
    scaleRef.current = clampedScale
    setScale(clampedScale)

    if (clampedScale <= MIN_SCALE + 0.001) {
      offsetRef.current = { x: 0, y: 0 }
      setOffset({ x: 0, y: 0 })
    }
  }, [])

  const zoomBy = useCallback((delta: number) => {
    applyScale(scaleRef.current + delta)
  }, [applyScale])

  const rotateBy = useCallback((delta: number) => {
    const nextRotation = normalizeRotation(rotationRef.current + delta)
    rotationRef.current = nextRotation
    setRotation(nextRotation)
  }, [])

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

  const toggleWheelZoomEnabled = () => {
    setIsWheelZoomEnabled((current) => {
      const nextValue = !current
      persistImageWheelZoomEnabled(nextValue)
      return nextValue
    })
  }

  const toggleControlsCollapsed = () => {
    setIsControlsCollapsed((current) => {
      const nextValue = !current
      persistImageControlsCollapsed(nextValue)
      return nextValue
    })
  }

  useEffect(() => {
    const node = viewportRef.current
    if (!node) {
      return
    }

    const handleWheel = (event: WheelEvent) => {
      if (!isWheelZoomEnabled) {
        return
      }

      if (event.cancelable) {
        event.preventDefault()
      }
      event.stopPropagation()
      zoomBy(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
    }

    node.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      node.removeEventListener('wheel', handleWheel)
    }
  }, [isWheelZoomEnabled, zoomBy])

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return
    }

    if (!isWheelZoomEnabled && (event.pointerType === 'touch' || event.pointerType === 'pen')) {
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
      <div className="absolute bottom-3 right-3 z-10 flex items-end gap-2">
        <div
          className={cn(
            'flex flex-wrap items-center gap-1.5 rounded-sm border border-border bg-background p-2 text-foreground shadow-[0_16px_36px_rgba(0,0,0,0.38)] transition-all duration-200 ease-out',
            isControlsCollapsed ? 'pointer-events-none translate-x-3 opacity-0' : 'translate-x-0 opacity-100',
          )}
        >
          <div className="hidden px-2 text-[11px] text-muted-foreground sm:block">{transformSummary}</div>
          <Button
            size="icon-sm"
            type="button"
            variant="outline"
            className={cn('bg-surface-container hover:bg-surface-high', isWheelZoomEnabled && 'border-primary/40 text-primary')}
            onClick={toggleWheelZoomEnabled}
            title={isWheelZoomEnabled ? '확대/축소 잠금' : '확대/축소 허용'}
            aria-label={isWheelZoomEnabled ? '확대 및 축소 잠금' : '확대 및 축소 허용'}
          >
            {isWheelZoomEnabled ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
          </Button>
          <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={() => zoomBy(-ZOOM_STEP)} title="축소" aria-label="축소">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={() => zoomBy(ZOOM_STEP)} title="확대" aria-label="확대">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={() => rotateBy(-ROTATION_STEP)} title="왼쪽 회전" aria-label="왼쪽 회전">
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={() => rotateBy(ROTATION_STEP)} title="오른쪽 회전" aria-label="오른쪽 회전">
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={resetView} title="초기화" aria-label="초기화">
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={toggleControlsCollapsed} title="컨트롤 수납" aria-label="컨트롤 수납">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {isControlsCollapsed ? (
          <Button
            size="icon-sm"
            type="button"
            variant="outline"
            className="bg-background shadow-[0_16px_36px_rgba(0,0,0,0.38)]"
            onClick={toggleControlsCollapsed}
            title="컨트롤 펼치기"
            aria-label="컨트롤 펼치기"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <div
        ref={viewportRef}
        className={cn(
          'flex h-full w-full items-center justify-center overflow-hidden select-none',
          isPannable ? 'cursor-grab active:cursor-grabbing' : isWheelZoomEnabled ? 'cursor-zoom-in' : 'cursor-default',
        )}
        style={{ touchAction: isWheelZoomEnabled ? 'none' : 'pan-y', overscrollBehavior: isWheelZoomEnabled ? 'contain' : 'auto' }}
        onDoubleClick={() => {
          if (!isWheelZoomEnabled) {
            return
          }

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
