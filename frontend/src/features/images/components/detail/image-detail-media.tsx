import { ChevronLeft, ChevronRight, Grid2X2, ImageIcon, Lock, RotateCcw, RotateCw, ScanSearch, Undo2, Unlock, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import type { ImageRecord } from '@/types/image'
import { getImagePreviewStateLabel, resolveImagePreviewState } from '@/features/images/components/image-preview-state'
import { ImagePreviewPlaceholder } from '@/features/images/components/image-preview-placeholder'
import { getImageListMediaKind } from '@/features/images/components/image-list/image-list-utils'
import { cn } from '@/lib/utils'
import {
  canToggleImageDetailRenderMode,
  getImageDetailRenderModeLabel,
  getImageDetailRenderUrl,
  getNextImageDetailRenderMode,
  loadImageDetailRenderMode,
  persistImageDetailRenderMode,
  type ImageDetailRenderMode,
} from './image-detail-utils'
import { EnhancedVideoPlayer } from './enhanced-video-player'

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
const IMAGE_PIXEL_PREVIEW_MODE_STORAGE_KEY = 'conai:image-detail-media:pixel-preview-enabled'
const IMAGE_PIXEL_PREVIEW_SETTINGS_STORAGE_KEY = 'conai:image-detail-media:pixel-preview-settings'

type PixelPreviewMode = 'off' | 'soft' | 'medium' | 'strong' | 'custom'

type PixelPreviewSettings = {
  targetLongEdge: number
  colorCount: number
  ditherStrength: number
  edgeBoost: number
  sharpness: number
  smoothing: boolean
}

type PixelPreviewProfile = PixelPreviewSettings & {
  label: string
  smoothing: boolean
  preFilter: string
}

const PIXEL_PREVIEW_MODE_LABELS: Record<PixelPreviewMode, string> = {
  off: '꺼짐',
  soft: '약',
  medium: '중',
  strong: '강',
  custom: '수동',
}
const IMAGE_PIXEL_PREVIEW_PRESETS: Record<Exclude<PixelPreviewMode, 'off' | 'custom'>, PixelPreviewSettings> = {
  soft: { targetLongEdge: 512, colorCount: 192, ditherStrength: 0.08, edgeBoost: 0.04, sharpness: 0.08, smoothing: true },
  medium: { targetLongEdge: 384, colorCount: 128, ditherStrength: 0.14, edgeBoost: 0.07, sharpness: 0.14, smoothing: true },
  strong: { targetLongEdge: 256, colorCount: 96, ditherStrength: 0.22, edgeBoost: 0.1, sharpness: 0.2, smoothing: false },
}
const DEFAULT_PIXEL_PREVIEW_SETTINGS: PixelPreviewSettings = IMAGE_PIXEL_PREVIEW_PRESETS.soft

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

function loadImagePixelPreviewMode(): PixelPreviewMode {
  if (typeof window === 'undefined') {
    return 'off'
  }

  const savedValue = window.localStorage.getItem(IMAGE_PIXEL_PREVIEW_MODE_STORAGE_KEY)
  if (savedValue === 'soft' || savedValue === 'medium' || savedValue === 'strong' || savedValue === 'custom' || savedValue === 'off') {
    return savedValue
  }

  // Migrate the old boolean toggle into the least destructive preview mode.
  return savedValue === 'true' ? 'soft' : 'off'
}

function persistImagePixelPreviewMode(mode: PixelPreviewMode) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(IMAGE_PIXEL_PREVIEW_MODE_STORAGE_KEY, mode)
}

function normalizePixelPreviewResolution(value: unknown) {
  const parsedValue = Number(value) || DEFAULT_PIXEL_PREVIEW_SETTINGS.targetLongEdge
  return Math.round(clamp(parsedValue, 64, 1024) / 64) * 64
}

function normalizePixelPreviewSettings(settings: Partial<PixelPreviewSettings>): PixelPreviewSettings {
  return {
    targetLongEdge: normalizePixelPreviewResolution(settings.targetLongEdge),
    colorCount: Math.round(clamp(Number(settings.colorCount) || DEFAULT_PIXEL_PREVIEW_SETTINGS.colorCount, 32, 256)),
    ditherStrength: clamp(Number(settings.ditherStrength) || 0, 0, 0.6),
    edgeBoost: clamp(Number(settings.edgeBoost) || 0, 0, 0.24),
    sharpness: clamp(Number(settings.sharpness) || 0, 0, 0.5),
    smoothing: typeof settings.smoothing === 'boolean' ? settings.smoothing : DEFAULT_PIXEL_PREVIEW_SETTINGS.smoothing,
  }
}

function loadImagePixelPreviewSettings(): PixelPreviewSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_PIXEL_PREVIEW_SETTINGS
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(IMAGE_PIXEL_PREVIEW_SETTINGS_STORAGE_KEY) || 'null') as Partial<PixelPreviewSettings> | null
    return normalizePixelPreviewSettings(parsed ?? DEFAULT_PIXEL_PREVIEW_SETTINGS)
  } catch {
    return DEFAULT_PIXEL_PREVIEW_SETTINGS
  }
}

function persistImagePixelPreviewSettings(settings: PixelPreviewSettings) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(IMAGE_PIXEL_PREVIEW_SETTINGS_STORAGE_KEY, JSON.stringify(normalizePixelPreviewSettings(settings)))
}

function getPixelPreviewProfile(mode: PixelPreviewMode, customSettings: PixelPreviewSettings): PixelPreviewProfile | null {
  if (mode === 'off') {
    return null
  }

  const settings = mode === 'custom' ? customSettings : IMAGE_PIXEL_PREVIEW_PRESETS[mode]
  const contrast = 1 + settings.edgeBoost * 0.18 + settings.sharpness * 0.03
  return {
    ...settings,
    label: PIXEL_PREVIEW_MODE_LABELS[mode],
    smoothing: settings.smoothing,
    preFilter: `contrast(${contrast.toFixed(3)})`,
  }
}

function getPixelLuminance(data: Uint8ClampedArray, index: number) {
  return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
}

function applyLuminanceScale(data: Uint8ClampedArray, index: number, currentLuminance: number, targetLuminance: number, minScale = 0.75, maxScale = 1.25) {
  const scale = clamp(targetLuminance / Math.max(1, currentLuminance), minScale, maxScale)
  data[index] = Math.round(clamp(data[index] * scale, 0, 255))
  data[index + 1] = Math.round(clamp(data[index + 1] * scale, 0, 255))
  data[index + 2] = Math.round(clamp(data[index + 2] * scale, 0, 255))
}

type PixelPreviewPaletteColor = { r: number; g: number; b: number }

function getClosestPaletteColor(red: number, green: number, blue: number, palette: PixelPreviewPaletteColor[]) {
  let closest = palette[0] ?? { r: red, g: green, b: blue }
  let closestDistance = Number.POSITIVE_INFINITY

  for (const color of palette) {
    const redDistance = red - color.r
    const greenDistance = green - color.g
    const blueDistance = blue - color.b
    const distance = redDistance * redDistance * 0.2126 + greenDistance * greenDistance * 0.7152 + blueDistance * blueDistance * 0.0722
    if (distance < closestDistance) {
      closest = color
      closestDistance = distance
    }
  }

  return closest
}

function applyImageToPixelStylePalette(imageData: ImageData, palette: PixelPreviewPaletteColor[], strength: number) {
  if (palette.length === 0) {
    return imageData
  }

  const { data, width, height } = imageData
  const source = new Uint8ClampedArray(data)
  const bayer4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ]
  const thresholdScale = strength * 64

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const threshold = (((bayer4[y % 4]?.[x % 4] ?? 0) + 0.5) / 16 - 0.5) * thresholdScale
      const closest = getClosestPaletteColor(
        clamp(source[index] + threshold, 0, 255),
        clamp(source[index + 1] + threshold, 0, 255),
        clamp(source[index + 2] + threshold, 0, 255),
        palette,
      )
      data[index] = closest.r
      data[index + 1] = closest.g
      data[index + 2] = closest.b
    }
  }

  return imageData
}

function boostPixelPreviewEdges(imageData: ImageData, strength: number) {
  if (strength <= 0) {
    return imageData
  }

  const { data, width, height } = imageData
  const original = new Uint8ClampedArray(data)
  const threshold = 28

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4
      const center = getPixelLuminance(original, index)
      const left = getPixelLuminance(original, index - 4)
      const right = getPixelLuminance(original, index + 4)
      const up = getPixelLuminance(original, index - width * 4)
      const down = getPixelLuminance(original, index + width * 4)
      const brightestNeighbor = Math.max(left, right, up, down)
      const gradient = brightestNeighbor - center

      if (gradient <= threshold) {
        continue
      }

      const targetLuminance = center * Math.max(0.82, 1 - strength * Math.min(1.25, gradient / 128))
      applyLuminanceScale(data, index, center, targetLuminance, 0.82, 1)
    }
  }

  return imageData
}

function sharpenPixelPreview(imageData: ImageData, amount: number) {
  if (amount <= 0) {
    return imageData
  }

  const { data, width, height } = imageData
  const original = new Uint8ClampedArray(data)
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4
      const center = getPixelLuminance(original, index)
      const neighborAverage =
        (getPixelLuminance(original, index - 4) +
          getPixelLuminance(original, index + 4) +
          getPixelLuminance(original, index - width * 4) +
          getPixelLuminance(original, index + width * 4)) /
        4
      const targetLuminance = clamp(center + (center - neighborAverage) * amount, 0, 255)
      applyLuminanceScale(data, index, center, targetLuminance, 0.86, 1.16)
    }
  }

  return imageData
}

/** Render the main detail media using the correct element for image, GIF, or video files. */
export function ImageDetailMedia({ image, renderUrl, className, onPrimaryLoad }: ImageDetailMediaProps) {
  const { showSnackbar } = useSnackbar()
  const [preferredRenderMode, setPreferredRenderMode] = useState<ImageDetailRenderMode>(() => loadImageDetailRenderMode())
  const mediaKind = getImageListMediaKind(image)
  const canToggleRenderMode = canToggleImageDetailRenderMode(image)
  const effectiveRenderUrl = canToggleRenderMode ? getImageDetailRenderUrl(image, preferredRenderMode) : renderUrl
  const previewState = resolveImagePreviewState({
    image,
    hasPreviewUrl: Boolean(effectiveRenderUrl),
  })

  if (!effectiveRenderUrl) {
    return <ImagePreviewPlaceholder label={getImagePreviewStateLabel(previewState)} className="min-h-[20rem] rounded-sm border border-dashed border-border/70 bg-surface-low text-sm text-muted-foreground" />
  }

  const altText = image.composite_hash || String(image.id)
  const mediaClassName = className ?? 'max-h-[80vh] max-w-full w-auto object-contain'

  const handleToggleRenderMode = () => {
    const nextMode = getNextImageDetailRenderMode(preferredRenderMode)
    setPreferredRenderMode(nextMode)
    persistImageDetailRenderMode(nextMode)
    showSnackbar({ message: `${getImageDetailRenderModeLabel(nextMode)} 보기로 바꿨어.`, tone: 'info' })
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
      return
    }

    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    let cancelled = false
    const sourceImage = new Image()

    sourceImage.onload = async () => {
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
      const canvasContext = canvas.getContext('2d')
      if (!sampleContext || !canvasContext) {
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

      try {
        const iq = await import('image-q')
        const sourceImageData = sampleContext.getImageData(0, 0, pixelWidth, pixelHeight)
        const sourceContainer = iq.utils.PointContainer.fromImageData(sourceImageData)
        const palette = iq.buildPaletteSync([sourceContainer], {
          colors: pixelPreviewProfile.colorCount,
          colorDistanceFormula: 'euclidean-bt709-noalpha',
          paletteQuantization: 'wuquant',
        })
        const quantizedImageData = applyImageToPixelStylePalette(sourceImageData, palette.getPointContainer().getPointArray().map((point) => ({ r: point.r, g: point.g, b: point.b })), pixelPreviewProfile.ditherStrength)
        sampleContext.putImageData(sharpenPixelPreview(boostPixelPreviewEdges(quantizedImageData, pixelPreviewProfile.edgeBoost), pixelPreviewProfile.sharpness), 0, 0)
      } catch (error) {
        const fallbackImageData = sampleContext.getImageData(0, 0, pixelWidth, pixelHeight)
        sampleContext.putImageData(sharpenPixelPreview(boostPixelPreviewEdges(fallbackImageData, pixelPreviewProfile.edgeBoost), pixelPreviewProfile.sharpness), 0, 0)
        console.warn('Failed to apply image-q pixel preview; falling back to plain pixel sampling.', error)
      }

      canvas.width = sourceWidth
      canvas.height = sourceHeight
      canvasContext.imageSmoothingEnabled = false
      canvasContext.clearRect(0, 0, sourceWidth, sourceHeight)
      canvasContext.drawImage(sampleCanvas, 0, 0, pixelWidth, pixelHeight, 0, 0, sourceWidth, sourceHeight)
      onPrimaryLoad?.()
    }

    sourceImage.onerror = () => {
      if (!cancelled) {
        setHasRenderError(true)
      }
    }
    sourceImage.src = renderUrl

    return () => {
      cancelled = true
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
                title={`필터: ${PIXEL_PREVIEW_MODE_LABELS[pixelPreviewMode]}`}
                aria-label={`필터 설정 열기: ${PIXEL_PREVIEW_MODE_LABELS[pixelPreviewMode]}`}
              >
                <Grid2X2 className="h-4 w-4 stroke-[2.5]" />
                {pixelPreviewMode !== 'off' ? (
                  <span className="absolute -right-1 -top-1 rounded-full border border-background bg-primary px-1 text-[9px] font-semibold leading-3 text-primary-foreground">{PIXEL_PREVIEW_MODE_LABELS[pixelPreviewMode]}</span>
                ) : null}
              </Button>

              {isPixelPreviewPanelOpen ? (
                <div className="absolute bottom-full left-0 mb-2 w-72 rounded-md border border-border bg-background p-3 text-xs text-foreground shadow-[0_18px_42px_rgba(0,0,0,0.45)]">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="font-semibold">필터</div>
                    <Button size="sm" type="button" variant={pixelPreviewMode === 'off' ? 'default' : 'outline'} className="h-7 px-2 text-xs" onClick={() => setPixelPreviewModeAndPersist('off')}>
                      끄기
                    </Button>
                  </div>
                  <div className="mb-3 grid grid-cols-3 gap-1.5">
                    {(['soft', 'medium', 'strong'] as const).map((mode) => (
                      <Button key={mode} size="sm" type="button" variant={pixelPreviewMode === mode ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setPixelPreviewModeAndPersist(mode)}>
                        {PIXEL_PREVIEW_MODE_LABELS[mode]}
                      </Button>
                    ))}
                  </div>
                  <div className="space-y-2.5">
                    <label className="block">
                      <div className="mb-1 flex justify-between text-muted-foreground"><span>해상도</span><span>{activePixelPreviewSettings.targetLongEdge}px</span></div>
                      <input className="w-full accent-primary" type="range" min={64} max={1024} step={64} value={activePixelPreviewSettings.targetLongEdge} onChange={(event) => updatePixelPreviewSettings({ targetLongEdge: Number(event.currentTarget.value) })} />
                    </label>
                    <label className="block">
                      <div className="mb-1 flex justify-between text-muted-foreground"><span>색상 수</span><span>{activePixelPreviewSettings.colorCount}</span></div>
                      <input className="w-full accent-primary" type="range" min={32} max={256} step={8} value={activePixelPreviewSettings.colorCount} onChange={(event) => updatePixelPreviewSettings({ colorCount: Number(event.currentTarget.value) })} />
                    </label>
                    <label className="block">
                      <div className="mb-1 flex justify-between text-muted-foreground"><span>디더링</span><span>{Math.round(activePixelPreviewSettings.ditherStrength * 100)}</span></div>
                      <input className="w-full accent-primary" type="range" min={0} max={60} step={2} value={Math.round(activePixelPreviewSettings.ditherStrength * 100)} onChange={(event) => updatePixelPreviewSettings({ ditherStrength: Number(event.currentTarget.value) / 100 })} />
                    </label>
                    <label className="flex items-center justify-between gap-3 rounded-sm border border-border/70 bg-surface-container/50 px-2.5 py-2 text-muted-foreground">
                      <span>부드러운 축소</span>
                      <input type="checkbox" className="size-4 accent-primary" checked={activePixelPreviewSettings.smoothing} onChange={(event) => updatePixelPreviewSettings({ smoothing: event.currentTarget.checked })} />
                    </label>
                    <label className="block">
                      <div className="mb-1 flex justify-between text-muted-foreground"><span>외곽선 강조</span><span>{Math.round(activePixelPreviewSettings.edgeBoost * 100)}</span></div>
                      <input className="w-full accent-primary" type="range" min={0} max={24} step={1} value={Math.round(activePixelPreviewSettings.edgeBoost * 100)} onChange={(event) => updatePixelPreviewSettings({ edgeBoost: Number(event.currentTarget.value) / 100 })} />
                    </label>
                    <label className="block">
                      <div className="mb-1 flex justify-between text-muted-foreground"><span>샤프닝</span><span>{Math.round(activePixelPreviewSettings.sharpness * 100)}</span></div>
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
              title={renderMode === 'original' ? '썸네일 보기' : '원본 보기'}
              aria-label={renderMode === 'original' ? '썸네일 보기' : '원본 보기'}
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
            title={isWheelZoomEnabled ? '확대/축소 잠금' : '확대/축소 허용'}
            aria-label={isWheelZoomEnabled ? '확대 및 축소 잠금' : '확대 및 축소 허용'}
          >
            {isWheelZoomEnabled ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
          </Button>
          <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={() => zoomBy(-ZOOM_STEP)} title="축소" aria-label="축소" disabled={!canZoomOut}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={() => zoomBy(ZOOM_STEP)} title="확대" aria-label="확대" disabled={!canZoomIn}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={() => rotateBy(-ROTATION_STEP)} title="왼쪽 회전" aria-label="왼쪽 회전">
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={() => rotateBy(ROTATION_STEP)} title="오른쪽 회전" aria-label="오른쪽 회전">
            <RotateCw className="h-4 w-4" />
          </Button>
          {!isDefaultView ? (
            <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={resetView} title="초기화" aria-label="초기화">
              <Undo2 className="h-4 w-4" />
            </Button>
          ) : null}
          <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={toggleControlsCollapsed} title="컨트롤 수납" aria-label="컨트롤 수납">
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
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={altText}
              className={cn('block h-auto w-auto pointer-events-none select-none', className)}
              style={{ imageRendering: 'pixelated' }}
            />
          ) : (
            <img src={renderUrl} alt={altText} className={cn('block h-auto w-auto pointer-events-none select-none', className)} draggable={false} onLoad={onPrimaryLoad} onError={() => setHasRenderError(true)} />
          )}
        </div>
      </div>
    </div>
  )
}
