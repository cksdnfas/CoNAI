import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { isTypingTarget, openDialogCount } from '@/lib/keyboard-shortcut'

interface PointerPosition { x: number; y: number }
interface MediaSize { width: number; height: number }

export const ZOOM_STEP = 0.24
export const ROTATION_STEP = 90
const MIN_SCALE = 0.25
const DEFAULT_SCALE = 1
const MAX_SCALE = 6
const DOUBLE_TAP_SCALE = 2

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

function getElementSize(element: Element): MediaSize {
  const rect = element.getBoundingClientRect()
  return { width: Math.max(0, rect.width), height: Math.max(0, rect.height) }
}

/** Own zoom, rotation, pointer/pinch state, fitted sizing, and animation-frame cleanup. */
export function useImageDetailMediaGestures({ isWheelZoomEnabled, renderUrl, isModal = false }: { isWheelZoomEnabled: boolean; renderUrl: string; isModal?: boolean }) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const pointersRef = useRef(new Map<number, PointerPosition>())
  const pinchStartDistanceRef = useRef<number | null>(null)
  const pinchStartScaleRef = useRef(DEFAULT_SCALE)
  const panOriginRef = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | null>(null)
  const scaleRef = useRef(DEFAULT_SCALE)
  const rotationRef = useRef(0)
  const offsetRef = useRef({ x: 0, y: 0 })
  const pendingOffsetRef = useRef<PointerPosition | null>(null)
  const offsetAnimationFrameRef = useRef<number | null>(null)
  const [scale, setScale] = useState(DEFAULT_SCALE)
  const [rotation, setRotation] = useState(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [naturalMediaSize, setNaturalMediaSize] = useState<MediaSize | null>(null)
  const [viewportSize, setViewportSize] = useState<MediaSize>({ width: 0, height: 0 })
  const [isGestureActive, setIsGestureActive] = useState(false)

  useEffect(() => { scaleRef.current = scale }, [scale])
  useEffect(() => { rotationRef.current = rotation }, [rotation])
  useEffect(() => { offsetRef.current = offset }, [offset])
  useEffect(() => () => {
    if (offsetAnimationFrameRef.current !== null) window.cancelAnimationFrame(offsetAnimationFrameRef.current)
  }, [])

  const cancelPendingOffsetFrame = useCallback(() => {
    if (offsetAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(offsetAnimationFrameRef.current)
      offsetAnimationFrameRef.current = null
    }
    pendingOffsetRef.current = null
  }, [])
  const setOffsetOnAnimationFrame = useCallback((nextOffset: PointerPosition) => {
    pendingOffsetRef.current = nextOffset
    if (offsetAnimationFrameRef.current !== null) return
    offsetAnimationFrameRef.current = window.requestAnimationFrame(() => {
      offsetAnimationFrameRef.current = null
      const pendingOffset = pendingOffsetRef.current
      pendingOffsetRef.current = null
      if (pendingOffset) setOffset(pendingOffset)
    })
  }, [])

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    setViewportSize(getElementSize(node))
    if (typeof ResizeObserver === 'undefined') return
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (entry) setViewportSize(getElementSize(entry.target))
    })
    resizeObserver.observe(node)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    pointersRef.current.clear()
    pinchStartDistanceRef.current = null
    panOriginRef.current = null
    setNaturalMediaSize(null)
    scaleRef.current = DEFAULT_SCALE
    rotationRef.current = 0
    offsetRef.current = { x: 0, y: 0 }
    cancelPendingOffsetFrame()
    setScale(DEFAULT_SCALE)
    setRotation(0)
    setOffset({ x: 0, y: 0 })
    setIsGestureActive(false)
  }, [cancelPendingOffsetFrame, renderUrl])

  const fittedMediaSize = useMemo(() => {
    if (!naturalMediaSize || naturalMediaSize.width <= 0 || naturalMediaSize.height <= 0 || viewportSize.width <= 0 || viewportSize.height <= 0) return null
    const fitScale = Math.min(viewportSize.width / naturalMediaSize.width, viewportSize.height / naturalMediaSize.height)
    if (!Number.isFinite(fitScale) || fitScale <= 0) return null
    return { width: Math.max(1, Math.floor(naturalMediaSize.width * fitScale)), height: Math.max(1, Math.floor(naturalMediaSize.height * fitScale)) }
  }, [naturalMediaSize, viewportSize])
  const mediaFitFrameStyle = fittedMediaSize ? { width: `${fittedMediaSize.width}px`, height: `${fittedMediaSize.height}px` } : undefined
  const isScaled = Math.abs(scale - DEFAULT_SCALE) > 0.001
  const hasRotation = rotation !== 0
  const hasOffset = Math.abs(offset.x) > 0.5 || Math.abs(offset.y) > 0.5
  const isPannable = isScaled || hasRotation
  const isDefaultView = !isScaled && !hasRotation && !hasOffset

  const resetView = useCallback(() => {
    scaleRef.current = DEFAULT_SCALE
    rotationRef.current = 0
    offsetRef.current = { x: 0, y: 0 }
    cancelPendingOffsetFrame()
    setScale(DEFAULT_SCALE)
    setRotation(0)
    setOffset({ x: 0, y: 0 })
  }, [cancelPendingOffsetFrame])
  const applyScale = useCallback((nextScale: number, focalClientPoint?: PointerPosition) => {
    const previousScale = scaleRef.current
    const clampedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE)
    scaleRef.current = clampedScale
    setScale(clampedScale)
    if (clampedScale <= DEFAULT_SCALE + 0.001) {
      offsetRef.current = { x: 0, y: 0 }
      cancelPendingOffsetFrame()
      setOffset({ x: 0, y: 0 })
      return
    }
    if (focalClientPoint && viewportRef.current && previousScale > 0) {
      const rect = viewportRef.current.getBoundingClientRect()
      const mx = focalClientPoint.x - (rect.left + rect.width / 2)
      const my = focalClientPoint.y - (rect.top + rect.height / 2)
      const ratio = clampedScale / previousScale
      const nextOffset = {
        x: mx - ratio * (mx - offsetRef.current.x),
        y: my - ratio * (my - offsetRef.current.y),
      }
      offsetRef.current = nextOffset
      cancelPendingOffsetFrame()
      setOffset(nextOffset)
    }
  }, [cancelPendingOffsetFrame])
  const zoomBy = useCallback((delta: number, focalClientPoint?: PointerPosition) => applyScale(scaleRef.current + delta, focalClientPoint), [applyScale])
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
    panOriginRef.current = { pointerId, startX: point.x, startY: point.y, offsetX: offsetRef.current.x, offsetY: offsetRef.current.y }
  }

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const handleWheel = (event: WheelEvent) => {
      if (!isWheelZoomEnabled) return
      if (event.cancelable) event.preventDefault()
      event.stopPropagation()
      zoomBy(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP, { x: event.clientX, y: event.clientY })
    }
    node.addEventListener('wheel', handleWheel, { passive: false })
    return () => node.removeEventListener('wheel', handleWheel)
  }, [isWheelZoomEnabled, zoomBy])

  useEffect(() => {
    const expectedDialogs = isModal ? 1 : 0
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target instanceof Element && event.target.closest('[data-chat-dock]')) return
      if (isTypingTarget(event) || openDialogCount() > expectedDialogs) return

      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        zoomBy(ZOOM_STEP)
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        zoomBy(-ZOOM_STEP)
      } else if (event.key === '0') {
        event.preventDefault()
        resetView()
      } else if (event.code === 'KeyR' && !event.shiftKey) {
        event.preventDefault()
        rotateBy(ROTATION_STEP)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isModal, resetView, rotateBy, zoomBy])

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    // On inline pages with zoom locked, only block single-finger pan while unzoomed so vertical page scroll stays smooth;
    // two-finger pinch zoom always remains available.
    if (!isWheelZoomEnabled && !isPannable && pointersRef.current.size === 0 && (event.pointerType === 'touch' || event.pointerType === 'pen')) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      return
    }
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    setIsGestureActive(true)
    if (pointersRef.current.size === 1) {
      panOriginRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, offsetX: offsetRef.current.x, offsetY: offsetRef.current.y }
      pinchStartDistanceRef.current = null
      return
    }
    const [first, second] = Array.from(pointersRef.current.values())
    pinchStartDistanceRef.current = getPointerDistance(first, second)
    pinchStartScaleRef.current = scaleRef.current
    panOriginRef.current = null
  }
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointersRef.current.size >= 2) {
      event.stopPropagation()
      const [first, second] = Array.from(pointersRef.current.values())
      const startDistance = pinchStartDistanceRef.current
      if (!startDistance || startDistance <= 0) {
        pinchStartDistanceRef.current = getPointerDistance(first, second)
        pinchStartScaleRef.current = scaleRef.current
        return
      }
      event.preventDefault()
      applyScale(
        pinchStartScaleRef.current * (getPointerDistance(first, second) / startDistance),
        { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
      )
      return
    }
    if (!isPannable) return
    event.stopPropagation()
    const panOrigin = panOriginRef.current
    if (!panOrigin || panOrigin.pointerId !== event.pointerId) return
    event.preventDefault()
    const nextOffset = { x: panOrigin.offsetX + event.clientX - panOrigin.startX, y: panOrigin.offsetY + event.clientY - panOrigin.startY }
    offsetRef.current = nextOffset
    setOffsetOnAnimationFrame(nextOffset)
  }
  const finishPointerInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
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
    if (scaleRef.current <= DEFAULT_SCALE + 0.001) {
      offsetRef.current = { x: 0, y: 0 }
      cancelPendingOffsetFrame()
      setOffset({ x: 0, y: 0 })
    }
  }
  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (scaleRef.current > DEFAULT_SCALE + 0.001) resetView()
    else applyScale(DOUBLE_TAP_SCALE, { x: event.clientX, y: event.clientY })
  }
  const recordNaturalMediaSize = (element: HTMLImageElement) => {
    const width = element.naturalWidth || element.width
    const height = element.naturalHeight || element.height
    if (width > 0 && height > 0) setNaturalMediaSize({ width, height })
  }

  return {
    canZoomIn: scale < MAX_SCALE - 0.001,
    canZoomOut: scale > MIN_SCALE + 0.001,
    finishPointerInteraction,
    fittedMediaSize,
    handleDoubleClick,
    handlePointerDown,
    handlePointerMove,
    isDefaultView,
    isGestureActive,
    isPannable,
    mediaFitFrameStyle,
    offset,
    recordNaturalMediaSize,
    resetView,
    rotateBy,
    rotation,
    scale,
    transformSummary: `${Math.round(scale * 100)}%${rotation !== 0 ? ` · ${rotation}°` : ''}`,
    viewportRef,
    zoomBy,
  }
}
