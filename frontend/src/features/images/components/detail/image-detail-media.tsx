import { LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type SyntheticEvent as ReactSyntheticEvent } from 'react'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import type { ImageRecord } from '@/types/image'
import { getImagePreviewStateLabel, resolveImagePreviewState } from '@/features/images/components/image-preview-state'
import { ImagePreviewPlaceholder } from '@/features/images/components/image-preview-placeholder'
import { getImageListMediaKind } from '@/features/images/components/image-list/image-list-utils'
import { cn } from '@/lib/utils'
import {
  canToggleImageDetailRenderMode,
  getImageDetailRenderUrl,
  getNextImageDetailRenderMode,
  loadImageDetailRenderMode,
  persistImageDetailRenderMode,
  type ImageDetailRenderMode,
} from './image-detail-utils'
import { EnhancedVideoPlayer } from './enhanced-video-player'
import { ImageDetailAuxiliaryControls, ImageDetailTransformControls } from './image-detail-media-controls'
import { createPixelPreviewWorkerTask } from './image-detail-pixel-preview-worker-client'
import {
  IMAGE_PIXEL_PREVIEW_PRESETS,
  getPixelPreviewProfile,
  loadImagePixelPreviewMode,
  loadImagePixelPreviewSettings,
  loadLastActiveImagePixelPreviewMode,
  normalizePixelPreviewSettings,
  persistImagePixelPreviewMode,
  persistImagePixelPreviewSettings,
  type PixelPreviewMode,
  type PixelPreviewSettings,
} from './image-detail-pixel-preview-utils'

interface ImageDetailMediaProps {
  image: ImageRecord
  renderUrl: string | null
  className?: string
  onPrimaryLoad?: () => void
}

interface PointerPosition {
  x: number
  y: number
}

interface MediaSize {
  width: number
  height: number
}

const MIN_SCALE = 0.25
const DEFAULT_SCALE = 1
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
    return false
  }

  const savedValue = window.localStorage.getItem(IMAGE_WHEEL_ZOOM_ENABLED_STORAGE_KEY)
  if (savedValue === 'true') {
    return true
  }

  if (savedValue === 'false') {
    return false
  }

  return false
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

function getElementSize(element: Element): MediaSize {
  const rect = element.getBoundingClientRect()
  return {
    width: Math.max(0, rect.width),
    height: Math.max(0, rect.height),
  }
}

/** Render the main detail media using the correct element for image, GIF, or video files. */
export function ImageDetailMedia({ image, renderUrl, className, onPrimaryLoad }: ImageDetailMediaProps) {
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const [preferredRenderMode, setPreferredRenderMode] = useState<ImageDetailRenderMode>(() => loadImageDetailRenderMode())
  const mediaKind = getImageListMediaKind(image)
  const canToggleRenderMode = canToggleImageDetailRenderMode(image)
  const effectiveRenderUrl = canToggleRenderMode ? getImageDetailRenderUrl(image, preferredRenderMode) : renderUrl
  const previewState = resolveImagePreviewState({
    image,
    hasPreviewUrl: Boolean(effectiveRenderUrl),
  })

  if (!effectiveRenderUrl) {
    return (
      <ImagePreviewPlaceholder
        label={getImagePreviewStateLabel(previewState, t('images.components.image.preview.state.no.preview'), {
          empty: t('images.components.image.preview.state.no.preview'),
          processing: t('images.components.image.preview.state.active'),
          failed: t('images.components.image.preview.state.failed'),
          unavailable: t('images.components.image.preview.state.unavailable'),
        })}
        className="min-h-[20rem] rounded-sm border border-dashed border-border/70 bg-surface-low text-sm text-muted-foreground"
      />
    )
  }

  const altText = image.composite_hash || String(image.id)
  const mediaClassName = className ?? 'max-h-[80vh] max-w-full w-auto object-contain'

  const handleToggleRenderMode = () => {
    const nextMode = getNextImageDetailRenderMode(preferredRenderMode)
    setPreferredRenderMode(nextMode)
    persistImageDetailRenderMode(nextMode)
    showSnackbar({
      message: t(
        { ko: '{mode} 보기로 바꿨어.', en: 'Switched to {mode} view.' },
        { mode: nextMode === 'original' ? t('images.components.detail.image.detail.utils.original') : t('images.components.detail.image.detail.utils.thumbnails') },
      ),
      tone: 'info',
    })
  }

  if (mediaKind === 'video') {
    return <EnhancedVideoPlayer renderUrl={effectiveRenderUrl} className={mediaClassName} loop autoPlay />
  }

  return (
    <InteractiveImageDetailMedia
      image={image}
      renderUrl={effectiveRenderUrl}
      altText={altText}
      className={mediaClassName}
      renderMode={preferredRenderMode}
      canToggleRenderMode={canToggleRenderMode}
      onToggleRenderMode={handleToggleRenderMode}
      canUsePixelPreview
      onPrimaryLoad={onPrimaryLoad}
    />
  )
}

function ImageDetailMediaFallback({ image }: { image: ImageRecord }) {
  const previewState = resolveImagePreviewState({
    image,
    hasPreviewUrl: Boolean(image.thumbnail_url || image.image_url),
    hasPreviewError: true,
  })

  return <ImagePreviewPlaceholder label={getImagePreviewStateLabel(previewState)} className="min-h-[20rem] rounded-sm border border-dashed border-border/70 bg-surface-low text-sm text-muted-foreground" />
}

function InteractiveImageDetailMedia({
  image,
  renderUrl,
  altText,
  className,
  renderMode,
  canToggleRenderMode,
  onToggleRenderMode,
  canUsePixelPreview,
  onPrimaryLoad,
}: {
  image: ImageRecord
  renderUrl: string
  altText: string
  className: string
  renderMode: ImageDetailRenderMode
  canToggleRenderMode: boolean
  onToggleRenderMode: () => void
  canUsePixelPreview: boolean
  onPrimaryLoad?: () => void
}) {
  const { t } = useI18n()
  const [hasRenderError, setHasRenderError] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    setHasRenderError(false)
  }, [renderUrl])

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const pointersRef = useRef(new Map<number, PointerPosition>())
  const pinchStartDistanceRef = useRef<number | null>(null)
  const pinchStartScaleRef = useRef(DEFAULT_SCALE)
  const panOriginRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    offsetX: number
    offsetY: number
  } | null>(null)
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
  const [isWheelZoomEnabled, setIsWheelZoomEnabled] = useState(() => loadImageWheelZoomEnabled())
  const [isControlsCollapsed, setIsControlsCollapsed] = useState(() => loadImageControlsCollapsed())
  const [pixelPreviewMode, setPixelPreviewMode] = useState<PixelPreviewMode>(() => loadImagePixelPreviewMode())
  const [pixelPreviewSettings, setPixelPreviewSettings] = useState<PixelPreviewSettings>(() => loadImagePixelPreviewSettings())
  const [isPixelPreviewPanelOpen, setIsPixelPreviewPanelOpen] = useState(false)
  const [isPixelPreviewReady, setIsPixelPreviewReady] = useState(false)
  const isPixelPreviewEnabled = pixelPreviewMode !== 'off'

  useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  useEffect(() => {
    rotationRef.current = rotation
  }, [rotation])

  useEffect(() => {
    offsetRef.current = offset
  }, [offset])

  useEffect(() => () => {
    if (offsetAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(offsetAnimationFrameRef.current)
    }
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
    if (offsetAnimationFrameRef.current !== null) {
      return
    }

    offsetAnimationFrameRef.current = window.requestAnimationFrame(() => {
      offsetAnimationFrameRef.current = null
      const pendingOffset = pendingOffsetRef.current
      pendingOffsetRef.current = null
      if (pendingOffset) {
        setOffset(pendingOffset)
      }
    })
  }, [])

  useEffect(() => {
    const node = viewportRef.current
    if (!node) {
      return
    }

    setViewportSize(getElementSize(node))

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) {
        return
      }
      setViewportSize(getElementSize(entry.target))
    })
    resizeObserver.observe(node)

    return () => {
      resizeObserver.disconnect()
    }
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
    if (!naturalMediaSize || naturalMediaSize.width <= 0 || naturalMediaSize.height <= 0 || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return null
    }

    const fitScale = Math.min(viewportSize.width / naturalMediaSize.width, viewportSize.height / naturalMediaSize.height)
    if (!Number.isFinite(fitScale) || fitScale <= 0) {
      return null
    }

    return {
      width: Math.max(1, Math.floor(naturalMediaSize.width * fitScale)),
      height: Math.max(1, Math.floor(naturalMediaSize.height * fitScale)),
    }
  }, [naturalMediaSize, viewportSize])
  const mediaFitFrameStyle = fittedMediaSize
    ? {
        width: `${fittedMediaSize.width}px`,
        height: `${fittedMediaSize.height}px`,
      }
    : undefined

  const isScaled = Math.abs(scale - DEFAULT_SCALE) > 0.001
  const hasRotation = rotation !== 0
  const hasOffset = Math.abs(offset.x) > 0.5 || Math.abs(offset.y) > 0.5
  const isPannable = isScaled || hasRotation
  const isDefaultView = !isScaled && !hasRotation && !hasOffset
  const canZoomOut = scale > MIN_SCALE + 0.001
  const canZoomIn = scale < MAX_SCALE - 0.001
  const transformSummary = `${Math.round(scale * 100)}%${rotation !== 0 ? ` · ${rotation}°` : ''}`
  const pixelPreviewProfile = useMemo(() => getPixelPreviewProfile(pixelPreviewMode, pixelPreviewSettings), [pixelPreviewMode, pixelPreviewSettings])
  const activePixelPreviewSettings = pixelPreviewProfile ?? pixelPreviewSettings
  const shouldRenderPixelPreview = canUsePixelPreview && pixelPreviewProfile !== null

  const resetView = useCallback(() => {
    scaleRef.current = DEFAULT_SCALE
    rotationRef.current = 0
    offsetRef.current = { x: 0, y: 0 }
    cancelPendingOffsetFrame()
    setScale(DEFAULT_SCALE)
    setRotation(0)
    setOffset({ x: 0, y: 0 })
  }, [cancelPendingOffsetFrame])

  const applyScale = useCallback((nextScale: number) => {
    const clampedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE)
    scaleRef.current = clampedScale
    setScale(clampedScale)

    if (clampedScale <= DEFAULT_SCALE + 0.001) {
      offsetRef.current = { x: 0, y: 0 }
      cancelPendingOffsetFrame()
      setOffset({ x: 0, y: 0 })
    }
  }, [cancelPendingOffsetFrame])

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

  const setPixelPreviewModeAndPersist = (mode: PixelPreviewMode) => {
    setPixelPreviewMode(mode)
    persistImagePixelPreviewMode(mode)
    if (mode === 'soft' || mode === 'medium' || mode === 'strong') {
      setPixelPreviewSettings(IMAGE_PIXEL_PREVIEW_PRESETS[mode])
      persistImagePixelPreviewSettings(IMAGE_PIXEL_PREVIEW_PRESETS[mode])
    }
  }

  const togglePixelPreviewEnabled = () => {
    if (pixelPreviewMode === 'off') {
      setPixelPreviewModeAndPersist(loadLastActiveImagePixelPreviewMode())
      return
    }

    setPixelPreviewModeAndPersist('off')
  }

  const updatePixelPreviewSettings = (patch: Partial<PixelPreviewSettings>) => {
    setPixelPreviewSettings((current) => {
      const baseSettings = pixelPreviewMode === 'soft' || pixelPreviewMode === 'medium' || pixelPreviewMode === 'strong' ? IMAGE_PIXEL_PREVIEW_PRESETS[pixelPreviewMode] : current
      const nextSettings = normalizePixelPreviewSettings({ ...baseSettings, ...patch })
      persistImagePixelPreviewSettings(nextSettings)
      persistImagePixelPreviewMode('custom')
      setPixelPreviewMode('custom')
      return nextSettings
    })
  }

  useEffect(() => {
    if (!shouldRenderPixelPreview || !pixelPreviewProfile) {
      setIsPixelPreviewReady(false)
      return
    }

    let cancelled = false
    let pixelPreviewTask: ReturnType<typeof createPixelPreviewWorkerTask> | null = null
    setIsPixelPreviewReady(false)
    const sourceImage = new Image()
    sourceImage.decoding = 'async'

    sourceImage.onload = () => {
      if (cancelled) {
        return
      }

      const sourceWidth = sourceImage.naturalWidth || sourceImage.width
      const sourceHeight = sourceImage.naturalHeight || sourceImage.height
      if (sourceWidth <= 0 || sourceHeight <= 0) {
        setHasRenderError(true)
        return
      }

      const targetScale = Math.min(1, pixelPreviewProfile.targetLongEdge / Math.max(sourceWidth, sourceHeight))
      const pixelWidth = Math.max(1, Math.round(sourceWidth * targetScale))
      const pixelHeight = Math.max(1, Math.round(sourceHeight * targetScale))
      const sampleCanvas = document.createElement('canvas')
      sampleCanvas.width = pixelWidth
      sampleCanvas.height = pixelHeight

      const sampleContext = sampleCanvas.getContext('2d')
      if (!sampleContext) {
        setHasRenderError(true)
        return
      }

      sampleContext.imageSmoothingEnabled = pixelPreviewProfile.smoothing
      if (pixelPreviewProfile.smoothing) {
        sampleContext.imageSmoothingQuality = 'high'
      }
      sampleContext.filter = pixelPreviewProfile.preFilter
      sampleContext.clearRect(0, 0, pixelWidth, pixelHeight)
      sampleContext.drawImage(sourceImage, 0, 0, pixelWidth, pixelHeight)

      const sourceImageData = sampleContext.getImageData(0, 0, pixelWidth, pixelHeight)
      pixelPreviewTask = createPixelPreviewWorkerTask(sourceImageData, pixelPreviewProfile)
      pixelPreviewTask.promise
        .then((result) => {
          if (cancelled) {
            return
          }

          const canvas = canvasRef.current
          const canvasContext = canvas?.getContext('2d')
          if (!canvas || !canvasContext) {
            setHasRenderError(true)
            return
          }

          if (result.warning) {
            console.warn('Failed to apply image-q pixel preview; falling back to plain pixel sampling.', result.warning)
          }

          const { imageData } = result
          sampleContext.putImageData(imageData, 0, 0)
          canvas.width = sourceWidth
          canvas.height = sourceHeight
          canvasContext.imageSmoothingEnabled = false
          canvasContext.clearRect(0, 0, sourceWidth, sourceHeight)
          canvasContext.drawImage(sampleCanvas, 0, 0, imageData.width, imageData.height, 0, 0, sourceWidth, sourceHeight)
          setIsPixelPreviewReady(true)
          onPrimaryLoad?.()
          pixelPreviewTask = null
        })
        .catch((error) => {
          if (cancelled) {
            return
          }
          console.warn('Failed to run pixel preview worker; falling back to plain pixel sampling.', error)
          const canvas = canvasRef.current
          const canvasContext = canvas?.getContext('2d')
          if (!canvas || !canvasContext) {
            setHasRenderError(true)
            return
          }
          canvas.width = sourceWidth
          canvas.height = sourceHeight
          canvasContext.imageSmoothingEnabled = false
          canvasContext.clearRect(0, 0, sourceWidth, sourceHeight)
          canvasContext.drawImage(sampleCanvas, 0, 0, pixelWidth, pixelHeight, 0, 0, sourceWidth, sourceHeight)
          setIsPixelPreviewReady(true)
          onPrimaryLoad?.()
          pixelPreviewTask = null
        })
    }

    sourceImage.onerror = () => {
      if (!cancelled) {
        setIsPixelPreviewReady(false)
        setHasRenderError(true)
      }
    }
    sourceImage.src = renderUrl

    return () => {
      cancelled = true
      sourceImage.onload = null
      sourceImage.onerror = null
      pixelPreviewTask?.cancel()
    }
  }, [onPrimaryLoad, pixelPreviewProfile, renderUrl, shouldRenderPixelPreview])

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
    setOffsetOnAnimationFrame(nextOffset)
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

    if (scaleRef.current <= DEFAULT_SCALE + 0.001) {
      offsetRef.current = { x: 0, y: 0 }
      cancelPendingOffsetFrame()
      setOffset({ x: 0, y: 0 })
    }
  }

  const handlePrimaryImageLoad = useCallback((event: ReactSyntheticEvent<HTMLImageElement>) => {
    const element = event.currentTarget
    const width = element.naturalWidth || element.width
    const height = element.naturalHeight || element.height

    if (width > 0 && height > 0) {
      setNaturalMediaSize({ width, height })
    }

    onPrimaryLoad?.()
  }, [onPrimaryLoad])

  if (hasRenderError) {
    return <ImageDetailMediaFallback image={image} />
  }

  return (
    <div className="relative isolate flex h-full w-full items-center justify-center overflow-hidden">
      <ImageDetailAuxiliaryControls
        canToggleRenderMode={canToggleRenderMode}
        canUsePixelPreview={canUsePixelPreview}
        renderMode={renderMode}
        pixelPreviewMode={pixelPreviewMode}
        isPixelPreviewEnabled={isPixelPreviewEnabled}
        isPixelPreviewPanelOpen={isPixelPreviewPanelOpen}
        activePixelPreviewSettings={activePixelPreviewSettings}
        onToggleRenderMode={onToggleRenderMode}
        onTogglePixelPreviewPanel={() => setIsPixelPreviewPanelOpen((current) => !current)}
        onTogglePixelPreviewEnabled={togglePixelPreviewEnabled}
        onSetPixelPreviewMode={setPixelPreviewModeAndPersist}
        onUpdatePixelPreviewSettings={updatePixelPreviewSettings}
      />

      <ImageDetailTransformControls
        canZoomIn={canZoomIn}
        canZoomOut={canZoomOut}
        isControlsCollapsed={isControlsCollapsed}
        isDefaultView={isDefaultView}
        isWheelZoomEnabled={isWheelZoomEnabled}
        transformSummary={transformSummary}
        onToggleWheelZoomEnabled={toggleWheelZoomEnabled}
        onZoomIn={() => zoomBy(ZOOM_STEP)}
        onZoomOut={() => zoomBy(-ZOOM_STEP)}
        onRotateLeft={() => rotateBy(-ROTATION_STEP)}
        onRotateRight={() => rotateBy(ROTATION_STEP)}
        onResetView={resetView}
        onToggleControlsCollapsed={toggleControlsCollapsed}
      />

      <div
        ref={viewportRef}
        className={cn(
          'relative z-0 flex h-full w-full items-center justify-center overflow-hidden select-none',
          isPannable ? 'cursor-grab active:cursor-grabbing' : isWheelZoomEnabled ? 'cursor-zoom-in' : 'cursor-default',
        )}
        style={{ touchAction: isWheelZoomEnabled ? 'none' : 'pan-y', overscrollBehavior: isWheelZoomEnabled ? 'contain' : 'auto' }}
        onDoubleClick={() => {
          if (!isWheelZoomEnabled) {
            return
          }

          if (scaleRef.current > DEFAULT_SCALE + 0.001) {
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
          className={cn('inline-flex will-change-transform', !fittedMediaSize && 'max-h-full max-w-full', !isGestureActive && 'transition-transform duration-150 ease-out')}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
            transformOrigin: 'center center',
          }}
        >
          <div className={cn('relative grid place-items-center', !fittedMediaSize && 'max-h-full max-w-full')} style={mediaFitFrameStyle}>
            <img
              src={renderUrl}
              alt={altText}
              className={cn(
                'col-start-1 row-start-1 block pointer-events-none select-none transition-opacity duration-150',
                fittedMediaSize ? 'h-full w-full object-contain' : cn('h-auto w-auto', className),
                shouldRenderPixelPreview && isPixelPreviewReady && 'opacity-0',
              )}
              draggable={false}
              onLoad={handlePrimaryImageLoad}
              onError={() => setHasRenderError(true)}
            />

            {shouldRenderPixelPreview ? (
              <canvas
                ref={canvasRef}
                role="img"
                aria-label={altText}
                className={cn('absolute inset-0 h-full w-full pointer-events-none select-none object-contain transition-opacity duration-150', isPixelPreviewReady ? 'opacity-100' : 'opacity-0')}
                style={{ imageRendering: 'pixelated' }}
              />
            ) : null}
            {shouldRenderPixelPreview && !isPixelPreviewReady ? (
              <div className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-black/45 px-2 py-1 text-[11px] font-medium text-white/82 shadow-sm backdrop-blur-sm">
                <LoaderCircle className="h-3 w-3 animate-spin" />
                {t({ ko: '적용 중', en: 'Applying' })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
