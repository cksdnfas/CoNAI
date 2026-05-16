import { ChevronLeft, ChevronRight, Grid2X2, ImageIcon, LoaderCircle, Lock, RotateCcw, RotateCw, ScanSearch, Undo2, Unlock, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Button } from '@/components/ui/button'
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

const MIN_SCALE = 0.25
const DEFAULT_SCALE = 1
const MAX_SCALE = 6
const ZOOM_STEP = 0.24
const DOUBLE_TAP_SCALE = 2
const ROTATION_STEP = 90
const IMAGE_WHEEL_ZOOM_ENABLED_STORAGE_KEY = 'conai:image-detail-media:wheel-zoom-enabled'
const IMAGE_CONTROLS_COLLAPSED_STORAGE_KEY = 'conai:image-detail-media:controls-collapsed'
const IMAGE_DETAIL_SCALE_STORAGE_KEY = 'conai:image-detail-media:scale'

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

function loadImageDetailScale() {
  if (typeof window === 'undefined') {
    return DEFAULT_SCALE
  }

  const value = Number(window.localStorage.getItem(IMAGE_DETAIL_SCALE_STORAGE_KEY))
  return Number.isFinite(value) ? clamp(value, MIN_SCALE, MAX_SCALE) : DEFAULT_SCALE
}

function persistImageDetailScale(scale: number) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(IMAGE_DETAIL_SCALE_STORAGE_KEY, String(clamp(scale, MIN_SCALE, MAX_SCALE)))
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
  const pixelPreviewModeLabels: Record<PixelPreviewMode, string> = {
    off: t({ ko: '꺼짐', en: 'Off' }),
    soft: t({ ko: '약', en: 'Soft' }),
    medium: t('images.components.detail.image.detail.media.medium'),
    strong: t('images.components.detail.image.detail.media.high'),
    custom: t('images.components.detail.image.detail.media.custom'),
  }
  const [hasRenderError, setHasRenderError] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    setHasRenderError(false)
  }, [renderUrl])

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const pointersRef = useRef(new Map<number, PointerPosition>())
  const initialScaleRef = useRef(loadImageDetailScale())
  const pinchStartDistanceRef = useRef<number | null>(null)
  const pinchStartScaleRef = useRef(initialScaleRef.current)
  const panOriginRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const scaleRef = useRef(initialScaleRef.current)
  const rotationRef = useRef(0)
  const offsetRef = useRef({ x: 0, y: 0 })
  const [scale, setScale] = useState(initialScaleRef.current)
  const [rotation, setRotation] = useState(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
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

  useEffect(() => {
    pointersRef.current.clear()
    pinchStartDistanceRef.current = null
    panOriginRef.current = null
    const savedScale = loadImageDetailScale()
    scaleRef.current = savedScale
    rotationRef.current = 0
    offsetRef.current = { x: 0, y: 0 }
    setScale(savedScale)
    setRotation(0)
    setOffset({ x: 0, y: 0 })
    setIsGestureActive(false)
  }, [renderUrl])

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
    persistImageDetailScale(DEFAULT_SCALE)
    rotationRef.current = 0
    offsetRef.current = { x: 0, y: 0 }
    setScale(DEFAULT_SCALE)
    setRotation(0)
    setOffset({ x: 0, y: 0 })
  }, [])

  const applyScale = useCallback((nextScale: number) => {
    const clampedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE)
    scaleRef.current = clampedScale
    persistImageDetailScale(clampedScale)
    setScale(clampedScale)

    if (clampedScale <= DEFAULT_SCALE + 0.001) {
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

    if (scaleRef.current <= DEFAULT_SCALE + 0.001) {
      offsetRef.current = { x: 0, y: 0 }
      setOffset({ x: 0, y: 0 })
    }
  }

  if (hasRenderError) {
    return <ImageDetailMediaFallback image={image} />
  }

  return (
    <div className="relative isolate flex h-full w-full items-center justify-center overflow-hidden">
      {canToggleRenderMode || canUsePixelPreview ? (
        <div className="absolute bottom-3 left-3 z-30 flex flex-col items-start gap-2" onPointerDown={(event) => event.stopPropagation()}>
          {canUsePixelPreview ? (
            <div className="relative">
              <Button
                size="icon-sm"
                type="button"
                variant="outline"
                className={cn('relative bg-background text-foreground shadow-[0_16px_36px_rgba(0,0,0,0.38)] hover:bg-surface-high', pixelPreviewMode !== 'off' && 'border-primary/45 text-primary')}
                onClick={() => setIsPixelPreviewPanelOpen((current) => !current)}
                title={t({ ko: '필터: {mode}', en: 'Filter: {mode}' }, { mode: pixelPreviewModeLabels[pixelPreviewMode] })}
                aria-label={t({ ko: '필터 설정 열기: {mode}', en: 'Open filter settings: {mode}' }, { mode: pixelPreviewModeLabels[pixelPreviewMode] })}
              >
                <Grid2X2 className="h-4 w-4 stroke-[2.5]" />
                {pixelPreviewMode !== 'off' ? (
                  <span className="absolute -right-1 -top-1 rounded-full border border-background bg-primary px-1 text-[9px] font-semibold leading-3 text-primary-foreground">{pixelPreviewModeLabels[pixelPreviewMode]}</span>
                ) : null}
              </Button>

              {isPixelPreviewPanelOpen ? (
                <div className="absolute bottom-full left-0 mb-2 w-72 rounded-md border border-border bg-background p-3 text-xs text-foreground shadow-[0_18px_42px_rgba(0,0,0,0.45)]">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="font-semibold">{t('images.components.detail.image.detail.media.filter')}</div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isPixelPreviewEnabled}
                      className={cn(
                        'flex h-7 items-center gap-2 rounded-full border px-1.5 text-[11px] font-medium transition-colors',
                        isPixelPreviewEnabled ? 'border-primary/60 bg-primary/18 text-primary' : 'border-border bg-surface-container text-muted-foreground',
                      )}
                      onClick={togglePixelPreviewEnabled}
                    >
                      <span className="min-w-8 text-center">{isPixelPreviewEnabled ? 'ON' : 'OFF'}</span>
                      <span className={cn('h-4 w-7 rounded-full p-0.5 transition-colors', isPixelPreviewEnabled ? 'bg-primary' : 'bg-muted-foreground/35')}>
                        <span className={cn('block size-3 rounded-full bg-background transition-transform', isPixelPreviewEnabled && 'translate-x-3')} />
                      </span>
                    </button>
                  </div>
                  <div className="mb-3 grid grid-cols-3 gap-1.5">
                    {(['soft', 'medium', 'strong'] as const).map((mode) => (
                      <Button key={mode} size="sm" type="button" variant={pixelPreviewMode === mode ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setPixelPreviewModeAndPersist(mode)}>
                        {pixelPreviewModeLabels[mode]}
                      </Button>
                    ))}
                  </div>
                  <div className="space-y-2.5">
                    <label className="block">
                      <div className="mb-1 flex justify-between text-muted-foreground"><span>{t('images.components.detail.image.detail.media.resolution')}</span><span>{activePixelPreviewSettings.targetLongEdge}px</span></div>
                      <input className="w-full accent-primary" type="range" min={64} max={1024} step={64} value={activePixelPreviewSettings.targetLongEdge} onChange={(event) => updatePixelPreviewSettings({ targetLongEdge: Number(event.currentTarget.value) })} />
                    </label>
                    <label className="block">
                      <div className="mb-1 flex justify-between text-muted-foreground"><span>{t('images.components.detail.image.detail.media.colors')}</span><span>{activePixelPreviewSettings.colorCount}</span></div>
                      <input className="w-full accent-primary" type="range" min={32} max={256} step={8} value={activePixelPreviewSettings.colorCount} onChange={(event) => updatePixelPreviewSettings({ colorCount: Number(event.currentTarget.value) })} />
                    </label>
                    <label className="block">
                      <div className="mb-1 flex justify-between text-muted-foreground"><span>{t('images.components.detail.image.detail.media.dithering')}</span><span>{Math.round(activePixelPreviewSettings.ditherStrength * 100)}</span></div>
                      <input className="w-full accent-primary" type="range" min={0} max={60} step={2} value={Math.round(activePixelPreviewSettings.ditherStrength * 100)} onChange={(event) => updatePixelPreviewSettings({ ditherStrength: Number(event.currentTarget.value) / 100 })} />
                    </label>
                    <label className="flex items-center justify-between gap-3 rounded-sm border border-border/70 bg-surface-container/50 px-2.5 py-2 text-muted-foreground">
                      <span>{t('images.components.detail.image.detail.media.smooth.downscale')}</span>
                      <input type="checkbox" className="size-4 accent-primary" checked={activePixelPreviewSettings.smoothing} onChange={(event) => updatePixelPreviewSettings({ smoothing: event.currentTarget.checked })} />
                    </label>
                    <label className="block">
                      <div className="mb-1 flex justify-between text-muted-foreground"><span>{t('images.components.detail.image.detail.media.edge.boost')}</span><span>{Math.round(activePixelPreviewSettings.edgeBoost * 100)}</span></div>
                      <input className="w-full accent-primary" type="range" min={0} max={24} step={1} value={Math.round(activePixelPreviewSettings.edgeBoost * 100)} onChange={(event) => updatePixelPreviewSettings({ edgeBoost: Number(event.currentTarget.value) / 100 })} />
                    </label>
                    <label className="block">
                      <div className="mb-1 flex justify-between text-muted-foreground"><span>{t('images.components.detail.image.detail.media.sharpening')}</span><span>{Math.round(activePixelPreviewSettings.sharpness * 100)}</span></div>
                      <input className="w-full accent-primary" type="range" min={0} max={50} step={2} value={Math.round(activePixelPreviewSettings.sharpness * 100)} onChange={(event) => updatePixelPreviewSettings({ sharpness: Number(event.currentTarget.value) / 100 })} />
                    </label>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {canToggleRenderMode ? (
            <Button
              size="icon-sm"
              type="button"
              variant="outline"
              className="bg-background shadow-[0_16px_36px_rgba(0,0,0,0.38)] hover:bg-surface-high"
              onClick={onToggleRenderMode}
              title={renderMode === 'original' ? t('images.components.detail.image.detail.media.view.thumbnails') : t('images.components.detail.image.detail.media.view.original')}
              aria-label={renderMode === 'original' ? t('images.components.detail.image.detail.media.view.thumbnails') : t('images.components.detail.image.detail.media.view.original')}
            >
              {renderMode === 'original' ? <ImageIcon className="h-4 w-4" /> : <ScanSearch className="h-4 w-4" />}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="absolute bottom-3 right-3 z-30 flex items-end gap-2" onPointerDown={(event) => event.stopPropagation()}>
        <div
          className={cn(
            'flex flex-wrap items-center gap-1.5 rounded-sm border border-border bg-background p-2 text-foreground shadow-[0_16px_36px_rgba(0,0,0,0.38)] transition-all duration-200 ease-out',
            isControlsCollapsed ? 'pointer-events-none translate-x-3 opacity-0' : 'translate-x-0 opacity-100',
          )}
        >
          {!isDefaultView ? <div className="hidden px-2 text-[11px] text-muted-foreground sm:block">{transformSummary}</div> : null}
          <Button
            size="icon-sm"
            type="button"
            variant="outline"
            className={cn('bg-surface-container hover:bg-surface-high', isWheelZoomEnabled && 'border-primary/40 text-primary')}
            onClick={toggleWheelZoomEnabled}
            title={isWheelZoomEnabled ? t('images.components.detail.image.detail.media.lock.zoom') : t('images.components.detail.image.detail.media.enable.zoom')}
            aria-label={isWheelZoomEnabled ? t('images.components.detail.image.detail.media.lock.zoom.in.out') : t('images.components.detail.image.detail.media.enable.zoom.in.out')}
          >
            {isWheelZoomEnabled ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
          </Button>
          <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={() => zoomBy(-ZOOM_STEP)} title={t('images.components.detail.image.detail.media.zoom.out')} aria-label={t('images.components.detail.image.detail.media.zoom.out')} disabled={!canZoomOut}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={() => zoomBy(ZOOM_STEP)} title={t('images.components.detail.image.detail.media.zoom.in')} aria-label={t('images.components.detail.image.detail.media.zoom.in')} disabled={!canZoomIn}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={() => rotateBy(-ROTATION_STEP)} title={t('images.components.detail.image.detail.media.rotate.left')} aria-label={t('images.components.detail.image.detail.media.rotate.left')}>
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={() => rotateBy(ROTATION_STEP)} title={t('images.components.detail.image.detail.media.rotate.right')} aria-label={t('images.components.detail.image.detail.media.rotate.right')}>
            <RotateCw className="h-4 w-4" />
          </Button>
          {!isDefaultView ? (
            <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={resetView} title={t('images.components.detail.image.detail.media.reset')} aria-label={t('images.components.detail.image.detail.media.reset')}>
              <Undo2 className="h-4 w-4" />
            </Button>
          ) : null}
          <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={toggleControlsCollapsed} title={t('images.components.detail.image.detail.media.collapse.controls')} aria-label={t('images.components.detail.image.detail.media.collapse.controls')}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {isControlsCollapsed ? (
          <Button
            size="icon-sm"
            type="button"
            variant="outline"
            className="border-primary/55 bg-primary text-primary-foreground shadow-[0_16px_36px_rgba(0,0,0,0.38)] hover:bg-primary/92 hover:text-primary-foreground"
            onClick={toggleControlsCollapsed}
            title={t('images.components.detail.image.detail.media.expand.controls')}
            aria-label={t('images.components.detail.image.detail.media.expand.controls')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

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
          className={cn('inline-flex max-h-full max-w-full will-change-transform', !isGestureActive && 'transition-transform duration-150 ease-out')}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
            transformOrigin: 'center center',
          }}
        >
          {shouldRenderPixelPreview ? (
            <div className="relative grid max-h-full max-w-full place-items-center">
              <img
                src={renderUrl}
                alt={altText}
                className={cn('col-start-1 row-start-1 block h-auto w-auto pointer-events-none select-none transition-opacity duration-150', className, isPixelPreviewReady && 'opacity-0')}
                draggable={false}
                onLoad={onPrimaryLoad}
                onError={() => setHasRenderError(true)}
              />
              <canvas
                ref={canvasRef}
                role="img"
                aria-label={altText}
                className={cn('absolute inset-0 h-full w-full pointer-events-none select-none object-contain transition-opacity duration-150', isPixelPreviewReady ? 'opacity-100' : 'opacity-0')}
                style={{ imageRendering: 'pixelated' }}
              />
              {!isPixelPreviewReady ? (
                <div className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-black/45 px-2 py-1 text-[11px] font-medium text-white/82 shadow-sm backdrop-blur-sm">
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                  {t({ ko: '적용 중', en: 'Applying' })}
                </div>
              ) : null}
            </div>
          ) : (
            <img src={renderUrl} alt={altText} className={cn('block h-auto w-auto pointer-events-none select-none', className)} draggable={false} onLoad={onPrimaryLoad} onError={() => setHasRenderError(true)} />
          )}
        </div>
      </div>
    </div>
  )
}
