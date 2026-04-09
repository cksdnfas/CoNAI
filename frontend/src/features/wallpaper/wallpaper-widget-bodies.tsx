import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { buildPreviewImageRecord } from '@/features/images/components/inline-media-preview'
import { formatDateTime, getArtifactPreviewUrl, parseMetadataValue } from '@/features/module-graph/module-graph-shared'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import type { WallpaperImageHoverMotion, WallpaperImageTransitionSpeed, WallpaperImageTransitionStyle, WallpaperWidgetInstance } from './wallpaper-types'
import { useWallpaperBrowseContentQuery, useWallpaperGroupPreviewImagesQuery } from './wallpaper-widget-data'
import {
  buildWallpaperFinalResultArtifact,
  getWallpaperImageUrl,
  getWallpaperMotionStrengthMultiplier,
  useWallpaperClockText,
  useWallpaperMotionTick,
  useWallpaperRotatingIndex,
} from './wallpaper-widget-utils'

const WALLPAPER_IMAGE_TRANSITION_DURATIONS: Record<WallpaperImageTransitionSpeed, number> = {
  fast: 220,
  normal: 340,
  slow: 520,
}
const WALLPAPER_IMAGE_TRANSITION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

export interface WallpaperWidgetPreviewImage {
  image: ImageRecord
  alt: string
}

interface WallpaperPreviewImageSurfaceProps {
  image: ImageRecord
  alt: string
  className: string
  imageClassName: string
  style?: CSSProperties
  imageStyle?: CSSProperties
  children?: ReactNode
  onOpenImage?: (image: WallpaperWidgetPreviewImage) => void
  transitionStyle?: WallpaperImageTransitionStyle
  transitionSpeed?: WallpaperImageTransitionSpeed
  hoverMotion?: WallpaperImageHoverMotion
}

function getWallpaperArtifactPreviewImage(src: string, alt: string, metadata?: string | null) {
  const parsedMetadata = parseMetadataValue(metadata)
  const mimeType = parsedMetadata && typeof parsedMetadata === 'object' && !Array.isArray(parsedMetadata) && typeof parsedMetadata.mimeType === 'string'
    ? parsedMetadata.mimeType
    : null

  return buildPreviewImageRecord({
    src,
    mimeType,
    fileName: alt,
    alt,
  })
}

function isSameWallpaperPreviewImage(left: WallpaperWidgetPreviewImage, right: WallpaperWidgetPreviewImage) {
  return left.alt === right.alt
    && left.image.image_url === right.image.image_url
    && left.image.thumbnail_url === right.image.thumbnail_url
    && left.image.mime_type === right.image.mime_type
}

function getWallpaperTransitionStateClassName(transitionStyle: WallpaperImageTransitionStyle, layer: 'current' | 'previous', isTransitionActive: boolean) {
  if (transitionStyle === 'none') {
    return layer === 'current' ? 'opacity-100 scale-100 translate-y-0 blur-0' : 'opacity-0'
  }

  if (transitionStyle === 'fade') {
    if (layer === 'current') {
      return isTransitionActive ? 'opacity-100 scale-100 translate-y-0 blur-0' : 'opacity-0 scale-[1.02] translate-y-0 blur-[3px]'
    }
    return isTransitionActive ? 'opacity-0 scale-[0.98] translate-y-0 blur-[4px]' : 'opacity-100 scale-100 translate-y-0 blur-0'
  }

  if (transitionStyle === 'slide') {
    if (layer === 'current') {
      return isTransitionActive ? 'opacity-100 scale-100 translate-y-0 blur-0' : 'opacity-0 scale-[0.985] translate-y-3 blur-[2px]'
    }
    return isTransitionActive ? 'opacity-0 scale-[1.015] -translate-y-3 blur-[4px]' : 'opacity-100 scale-100 translate-y-0 blur-0'
  }

  if (transitionStyle === 'blur') {
    if (layer === 'current') {
      return isTransitionActive ? 'opacity-100 scale-100 translate-y-0 blur-0' : 'opacity-0 scale-[1.035] translate-y-0 blur-[14px]'
    }
    return isTransitionActive ? 'opacity-0 scale-[0.97] translate-y-0 blur-[18px]' : 'opacity-100 scale-100 translate-y-0 blur-0'
  }

  if (transitionStyle === 'flip') {
    if (layer === 'current') {
      return isTransitionActive ? 'opacity-100 [transform:perspective(1200px)_rotateX(0deg)_scale(1)] blur-0' : 'opacity-0 [transform:perspective(1200px)_rotateX(-84deg)_scale(0.96)] blur-[2px]'
    }
    return isTransitionActive ? 'opacity-0 [transform:perspective(1200px)_rotateX(84deg)_scale(1.03)] blur-[4px]' : 'opacity-100 [transform:perspective(1200px)_rotateX(0deg)_scale(1)] blur-0'
  }

  if (transitionStyle === 'shuffle') {
    if (layer === 'current') {
      return isTransitionActive ? 'opacity-100 scale-100 translate-x-0 translate-y-0 rotate-0 blur-0' : 'opacity-0 scale-[0.92] -translate-x-3 translate-y-2 -rotate-[3deg] blur-[4px]'
    }
    return isTransitionActive ? 'opacity-0 scale-[1.05] translate-x-3 -translate-y-2 rotate-[3deg] blur-[5px]' : 'opacity-100 scale-100 translate-x-0 translate-y-0 rotate-0 blur-0'
  }

  if (layer === 'current') {
    return isTransitionActive ? 'opacity-100 scale-100 translate-y-0 blur-0' : 'opacity-0 scale-[0.9] translate-y-[2%] blur-[4px]'
  }

  return isTransitionActive ? 'opacity-0 scale-[1.08] translate-y-[-2%] blur-[6px]' : 'opacity-100 scale-100 translate-y-0 blur-0'
}

function clampWallpaperMetric(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function resolveWallpaperClockMetrics(width: number, height: number, visualStyle: 'minimal' | 'glow' | 'split', showSeconds: boolean) {
  const safeWidth = Math.max(width, 220)
  const safeHeight = Math.max(height, 120)
  const timeDivisor = visualStyle === 'split' ? (showSeconds ? 5.9 : 5.1) : (showSeconds ? 4.7 : 4)
  const timeSize = clampWallpaperMetric(
    Math.min(safeWidth / timeDivisor, safeHeight * (visualStyle === 'split' ? 0.34 : 0.42)),
    26,
    visualStyle === 'split' ? 76 : 96,
  )

  return {
    labelSize: clampWallpaperMetric(Math.min(safeWidth * 0.028, safeHeight * 0.095), 10, 16),
    dateSize: clampWallpaperMetric(Math.min(safeWidth * 0.045, safeHeight * 0.16), 12, 24),
    timeSize,
    secondaryTimeSize: clampWallpaperMetric(timeSize * 0.38, 12, 30),
    sidePanelWidth: clampWallpaperMetric(safeWidth * 0.24, 76, 140),
  }
}

const WALLPAPER_FLOATING_COLLAGE_SLOT_ASPECTS = [0.78, 1.08, 0.86, 1.18, 0.92, 1.28]

interface WallpaperFloatingCollageSlot {
  centerX: number
  centerY: number
  width: number
  rotate: number
  depth: number
  aspectRatio: number
  velocityX: number
  velocityY: number
  scalePhase: number
}

interface WallpaperFloatingCollageCardState {
  key: string
  x: number
  y: number
  vx: number
  vy: number
  width: number
  rotate: number
  depth: number
  aspectRatio: number
  scalePhase: number
  imageIndex: number
  bounceCount: number
  elapsedSinceSwapMs: number
}

function getWallpaperFloatingCollageClusterConfig(layoutSpread: 'compact' | 'balanced' | 'wide') {
  if (layoutSpread === 'wide') {
    return { radiusX: 19, radiusY: 14, minWidth: 16, maxWidth: 22 }
  }

  if (layoutSpread === 'balanced') {
    return { radiusX: 13, radiusY: 10, minWidth: 17, maxWidth: 23 }
  }

  return { radiusX: 8, radiusY: 6, minWidth: 18, maxWidth: 24 }
}

function clampWallpaperFloatingCollageSpeed(value: number | undefined) {
  return clampWallpaperMetric(typeof value === 'number' && Number.isFinite(value) ? value : 1, 0.2, 20)
}

function clampWallpaperFloatingCollageSwapIntervalSec(value: number | undefined) {
  return Math.round(clampWallpaperMetric(typeof value === 'number' && Number.isFinite(value) ? value : 12, 2, 60))
}

function clampWallpaperFloatingCollageSwapBounceCount(value: number | undefined) {
  return Math.round(clampWallpaperMetric(typeof value === 'number' && Number.isFinite(value) ? value : 3, 1, 12))
}

function resolveWallpaperFloatingCollageAspectRatio(
  image: { width?: number | null; height?: number | null } | null | undefined,
  fallback: number,
) {
  return typeof image?.width === 'number' && image.width > 0 && typeof image?.height === 'number' && image.height > 0
    ? clampWallpaperMetric(image.width / image.height, 0.58, 1.9)
    : fallback
}

function getNextWallpaperFloatingCollageImageIndex(currentIndex: number, totalImages: number) {
  if (totalImages <= 1) {
    return currentIndex
  }

  return (currentIndex + 1) % totalImages
}

function buildWallpaperFloatingCollageSlots(visibleCount: number, layoutSpread: 'compact' | 'balanced' | 'wide'): WallpaperFloatingCollageSlot[] {
  const config = getWallpaperFloatingCollageClusterConfig(layoutSpread)

  return Array.from({ length: visibleCount }, (_, index) => {
    const angle = (-Math.PI / 2) + ((index / Math.max(visibleCount, 1)) * Math.PI * 2) + (index % 2 === 0 ? -0.12 : 0.12)
    const width = clampWallpaperMetric(config.maxWidth - ((index % 3) * 1.8), config.minWidth, config.maxWidth)
    const aspectRatio = WALLPAPER_FLOATING_COLLAGE_SLOT_ASPECTS[index % WALLPAPER_FLOATING_COLLAGE_SLOT_ASPECTS.length]

    return {
      centerX: 50 + Math.cos(angle) * config.radiusX,
      centerY: 50 + Math.sin(angle) * config.radiusY,
      width,
      rotate: (Math.sin(angle * 1.4) * 7) + ((index % 2 === 0 ? -1 : 1) * 2.4),
      depth: (index % 3) + 1,
      aspectRatio,
      velocityX: 5.5 + ((index % 4) * 1.35),
      velocityY: 4.4 + (((index + 2) % 4) * 1.2),
      scalePhase: index * 0.85,
    }
  })
}

function resolveWallpaperFloatingCollageCardGeometry(
  widthPercent: number,
  aspectRatio: number,
  containerWidth: number,
  containerHeight: number,
  imageScalePercent: number,
) {
  const safeContainerWidth = Math.max(containerWidth, 1)
  const safeContainerHeight = Math.max(containerHeight, 1)
  const scaledWidthPx = (safeContainerWidth * widthPercent * imageScalePercent) / 10_000
  const maxWidthByHeightPx = safeContainerHeight * Math.max(aspectRatio, 0.58) * 0.92
  const resolvedWidthPx = clampWallpaperMetric(Math.min(scaledWidthPx, maxWidthByHeightPx, safeContainerWidth * 0.92), 36, safeContainerWidth * 0.92)
  const resolvedHeightPx = resolvedWidthPx / Math.max(aspectRatio, 0.58)

  return {
    widthPx: resolvedWidthPx,
    halfWidthPx: resolvedWidthPx / 2,
    halfHeightPx: clampWallpaperMetric(resolvedHeightPx / 2, 24, safeContainerHeight * 0.46),
  }
}

function buildWallpaperFloatingCollageCardStates(
  slots: WallpaperFloatingCollageSlot[],
  images: Array<{ width?: number | null; height?: number | null }>,
  motionStrength: number,
  motionSpeed: number,
  containerWidth: number,
  containerHeight: number,
  aspectMode: 'slot' | 'image',
  imageScalePercent: number,
): WallpaperFloatingCollageCardState[] {
  if (images.length === 0 || containerWidth <= 0 || containerHeight <= 0) {
    return []
  }

  const speedMultiplier = motionStrength * clampWallpaperFloatingCollageSpeed(motionSpeed)

  return slots.map((slot, index) => {
    const imageIndex = index % images.length
    const aspectRatio = aspectMode === 'image'
      ? resolveWallpaperFloatingCollageAspectRatio(images[imageIndex], slot.aspectRatio)
      : slot.aspectRatio
    const geometry = resolveWallpaperFloatingCollageCardGeometry(slot.width, aspectRatio, containerWidth, containerHeight, imageScalePercent)
    const startX = (containerWidth * slot.centerX) / 100
    const startY = (containerHeight * slot.centerY) / 100
    const x = clampWallpaperMetric(startX, geometry.halfWidthPx, containerWidth - geometry.halfWidthPx)
    const y = clampWallpaperMetric(startY, geometry.halfHeightPx, containerHeight - geometry.halfHeightPx)
    let vx = slot.velocityX * speedMultiplier * 5.2 * (index % 2 === 0 ? 1 : -1)
    let vy = slot.velocityY * speedMultiplier * 7.4 * (index % 3 === 0 ? -1 : 1)

    if (x <= geometry.halfWidthPx + 1) {
      vx = Math.abs(vx)
    } else if (x >= containerWidth - geometry.halfWidthPx - 1) {
      vx = -Math.abs(vx)
    }

    if (y <= geometry.halfHeightPx + 1) {
      vy = Math.abs(vy)
    } else if (y >= containerHeight - geometry.halfHeightPx - 1) {
      vy = -Math.abs(vy)
    }

    return {
      key: `floating-collage-card-${index}`,
      x,
      y,
      vx,
      vy,
      width: geometry.widthPx,
      rotate: slot.rotate,
      depth: slot.depth,
      aspectRatio,
      scalePhase: slot.scalePhase,
      imageIndex,
      bounceCount: 0,
      elapsedSinceSwapMs: 0,
    }
  })
}

function getWallpaperHoverSurfaceClassName(hoverMotion: WallpaperImageHoverMotion) {
  if (hoverMotion === 'none') {
    return ''
  }

  if (hoverMotion === 'soft') {
    return 'hover:scale-[1.01] hover:shadow-[0_10px_26px_rgba(0,0,0,0.16)]'
  }

  if (hoverMotion === 'strong') {
    return 'hover:scale-[1.03] hover:shadow-[0_20px_52px_rgba(0,0,0,0.28)]'
  }

  return 'hover:scale-[1.018] hover:shadow-[0_16px_42px_rgba(0,0,0,0.22)]'
}

function getWallpaperHoverImageClassName(hoverMotion: WallpaperImageHoverMotion) {
  if (hoverMotion === 'none') {
    return ''
  }

  if (hoverMotion === 'soft') {
    return 'group-hover/image-surface:scale-[1.015]'
  }

  if (hoverMotion === 'strong') {
    return 'group-hover/image-surface:scale-[1.045]'
  }

  return 'group-hover/image-surface:scale-[1.03]'
}

/** Render one optionally clickable wallpaper image surface. */
function WallpaperPreviewImageSurface({ image, alt, className, imageClassName, style, imageStyle, children, onOpenImage, transitionStyle = 'none', transitionSpeed = 'normal', hoverMotion = 'medium' }: WallpaperPreviewImageSurfaceProps) {
  const [currentImage, setCurrentImage] = useState<WallpaperWidgetPreviewImage>({ image, alt })
  const [previousImage, setPreviousImage] = useState<WallpaperWidgetPreviewImage | null>(null)
  const [isTransitionActive, setIsTransitionActive] = useState(true)
  const currentImageRef = useRef<WallpaperWidgetPreviewImage>({ image, alt })
  const transitionTimeoutRef = useRef<number | null>(null)
  const transitionDurationMs = WALLPAPER_IMAGE_TRANSITION_DURATIONS[transitionSpeed]

  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current !== null) {
        window.clearTimeout(transitionTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const nextImage = { image, alt }
    const activeImage = currentImageRef.current
    if (isSameWallpaperPreviewImage(activeImage, nextImage)) {
      return
    }

    if (transitionTimeoutRef.current !== null) {
      window.clearTimeout(transitionTimeoutRef.current)
      transitionTimeoutRef.current = null
    }

    currentImageRef.current = nextImage
    queueMicrotask(() => {
      setCurrentImage(nextImage)

      if (transitionStyle === 'none') {
        setPreviousImage(null)
        setIsTransitionActive(true)
        return
      }

      setPreviousImage(activeImage)
      setIsTransitionActive(false)
      window.requestAnimationFrame(() => {
        setIsTransitionActive(true)
      })
      transitionTimeoutRef.current = window.setTimeout(() => {
        setPreviousImage(null)
        setIsTransitionActive(true)
        transitionTimeoutRef.current = null
      }, transitionDurationMs)
    })
  }, [alt, image, transitionDurationMs, transitionStyle])

  const imageLayerStyle = {
    transitionDuration: `${transitionDurationMs}ms`,
    transitionTimingFunction: WALLPAPER_IMAGE_TRANSITION_EASING,
    ...imageStyle,
  }

  const imageLayers = (
    <>
      {previousImage ? (
        <ImagePreviewMedia
          image={previousImage.image}
          alt={previousImage.alt}
          className={cn(
            'absolute inset-0 h-full w-full transition-[opacity,transform,filter] will-change-transform',
            imageClassName,
            getWallpaperTransitionStateClassName(transitionStyle, 'previous', isTransitionActive),
          )}
          style={imageLayerStyle}
          loading="lazy"
          draggable={false}
        />
      ) : null}
      <ImagePreviewMedia
        image={currentImage.image}
        alt={currentImage.alt}
        className={cn(
          'absolute inset-0 h-full w-full transition-[opacity,transform,filter] will-change-transform',
          imageClassName,
          onOpenImage ? getWallpaperHoverImageClassName(hoverMotion) : undefined,
          getWallpaperTransitionStateClassName(transitionStyle, 'current', isTransitionActive),
        )}
        style={imageLayerStyle}
        loading="lazy"
        draggable={false}
      />
    </>
  )

  if (!onOpenImage) {
    return (
      <div className={cn(className, 'relative isolate')} style={style}>
        {imageLayers}
        {children}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={cn(className, 'group/image-surface relative isolate block w-full cursor-zoom-in transform-gpu transition-transform duration-200 ease-out', getWallpaperHoverSurfaceClassName(hoverMotion))}
      style={style}
      onClick={(event) => {
        event.stopPropagation()
        onOpenImage({ image: currentImage.image, alt: currentImage.alt })
      }}
    >
      {imageLayers}
      {children}
    </button>
  )
}

/** Render the live clock body without forcing timers on every widget. */
function WallpaperClockBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'clock' }> }) {
  const currentTime = useWallpaperClockText()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerSize, setContainerSize] = useState({ width: widget.w * 72, height: widget.h * 56 })
  const timeFormat = widget.settings.timeFormat
  const showSeconds = widget.settings.showSeconds
  const visualStyle = widget.settings.visualStyle ?? 'minimal'
  const timeText = currentTime.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: showSeconds ? '2-digit' : undefined,
    hour12: timeFormat === '12h',
  })
  const [hourText, minuteText, secondText] = timeText.split(':')
  const dateText = currentTime.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })
  const metrics = resolveWallpaperClockMetrics(containerSize.width, containerSize.height, visualStyle, showSeconds)
  const labelTracking = `${Math.max(1.5, metrics.labelSize * 0.2)}px`

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    const updateSize = () => {
      setContainerSize({
        width: Math.max(element.clientWidth, widget.w * 72),
        height: Math.max(element.clientHeight, widget.h * 56),
      })
    }

    updateSize()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }

    const observer = new ResizeObserver(() => {
      updateSize()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [widget.h, widget.w])

  if (visualStyle === 'split') {
    return (
      <div ref={containerRef} className="grid h-full grid-cols-[1fr_auto] gap-3">
        <div className="flex min-w-0 flex-col justify-center rounded-sm border border-border/70 bg-surface-low px-3 py-3">
          <div className="uppercase text-secondary" style={{ fontSize: metrics.labelSize, letterSpacing: labelTracking }}>지금</div>
          <div className="mt-1 flex items-end gap-2 font-semibold tracking-[-0.08em] text-foreground" style={{ fontSize: metrics.timeSize, lineHeight: 0.92 }}>
            <span>{hourText}:{minuteText}</span>
            {showSeconds ? <span className="pb-0.5 text-muted-foreground" style={{ fontSize: metrics.secondaryTimeSize, lineHeight: 1 }}>{secondText}</span> : null}
          </div>
        </div>
        <div
          className="flex flex-col justify-between rounded-sm border border-border/70 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--secondary)_16%,transparent),transparent),var(--surface-low)] px-3 py-3 text-right"
          style={{ width: metrics.sidePanelWidth }}
        >
          <div className="uppercase text-muted-foreground" style={{ fontSize: metrics.labelSize, letterSpacing: labelTracking }}>시계</div>
          <div className="text-muted-foreground" style={{ fontSize: metrics.dateSize, lineHeight: 1.2 }}>{dateText}</div>
        </div>
      </div>
    )
  }

  if (visualStyle === 'glow') {
    return (
      <div ref={containerRef} className="flex h-full flex-col justify-center rounded-sm bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--secondary)_22%,transparent),transparent_46%),linear-gradient(180deg,color-mix(in_srgb,var(--primary)_10%,transparent),transparent_56%)] px-3">
        <div
          className="font-semibold tracking-[-0.08em] text-foreground drop-shadow-[0_0_18px_color-mix(in_srgb,var(--secondary)_22%,transparent)]"
          style={{ fontSize: metrics.timeSize, lineHeight: 0.92 }}
        >
          {timeText}
        </div>
        <div className="mt-1 text-muted-foreground" style={{ fontSize: metrics.dateSize, lineHeight: 1.2 }}>{dateText}</div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col justify-center">
      <div className="font-semibold tracking-[-0.06em] text-foreground" style={{ fontSize: metrics.timeSize, lineHeight: 0.92 }}>
        {timeText}
      </div>
      <div className="text-muted-foreground" style={{ fontSize: metrics.dateSize, lineHeight: 1.2 }}>{dateText}</div>
    </div>
  )
}

/** Render one queue status widget using existing graph browse-content APIs. */
function WallpaperQueueStatusBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'queue-status' }> }) {
  const refreshInterval = Math.max(2, widget.settings.refreshIntervalSec) * 1000
  const visualMode = widget.settings.visualMode ?? 'tiles'

  const queueQuery = useWallpaperBrowseContentQuery('queue-status', refreshInterval)

  const queueSummary = useMemo(() => {
    const executions = queueQuery.data?.executions ?? []
    return {
      queued: executions.filter((item) => item.status === 'queued').length,
      running: executions.filter((item) => item.status === 'running').length,
      failed: executions.filter((item) => item.status === 'failed').length,
      workflows: queueQuery.data?.scope.workflow_count ?? 0,
    }
  }, [queueQuery.data])

  if (queueQuery.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">큐 상태 불러오는 중…</div>
  }

  if (queueQuery.isError) {
    return <div className="flex h-full items-center justify-center text-center text-sm text-destructive">큐 상태를 불러오지 못했어.</div>
  }

  const queueItems = [
    { label: '대기', value: queueSummary.queued, tone: 'var(--secondary)', short: 'Q' },
    { label: '실행', value: queueSummary.running, tone: '#3ddc97', short: 'R' },
    { label: '실패', value: queueSummary.failed, tone: '#ff6b6b', short: 'F' },
    { label: '워크플로', value: queueSummary.workflows, tone: 'var(--primary)', short: 'W' },
  ]
  const maxValue = Math.max(...queueItems.map((item) => item.value), 1)
  const totalActive = queueSummary.queued + queueSummary.running

  if (visualMode === 'bars') {
    return (
      <div className="flex h-full flex-col justify-center gap-3 rounded-sm bg-[linear-gradient(180deg,color-mix(in_srgb,var(--primary)_10%,transparent),transparent_55%)] px-1 py-1 text-xs sm:text-sm">
        <div className="mb-0.5 flex items-center justify-between gap-2 rounded-sm border border-border/60 bg-background/45 px-3 py-2 backdrop-blur-sm">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">큐</div>
            <div className="text-sm font-semibold text-foreground">{totalActive.toLocaleString('ko-KR')} 진행 중</div>
          </div>
          <div className="rounded-full border border-border/70 bg-surface-low px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {queueSummary.failed > 0 ? '주의' : '안정'}
          </div>
        </div>

        {queueItems.map((item) => {
          const ratio = Math.max(0.08, item.value / maxValue)
          return (
            <div key={item.label} className="space-y-1.5 rounded-sm border border-border/60 bg-background/35 px-3 py-2.5 backdrop-blur-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold text-background" style={{ backgroundColor: item.tone }}>
                    {item.short}
                  </span>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{item.label}</div>
                </div>
                <div className={cn('text-sm font-semibold text-foreground', item.label === '실행' && item.value > 0 ? 'animate-pulse' : undefined)}>
                  {item.value.toLocaleString('ko-KR')}
                </div>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-surface-lowest/90">
                <div
                  className={cn('h-full rounded-full transition-[width] duration-700 ease-out', item.label === '실행' && item.value > 0 ? 'animate-pulse' : undefined)}
                  style={{
                    width: `${ratio * 100}%`,
                    background: `linear-gradient(90deg, ${item.tone}, color-mix(in srgb, ${item.tone} 68%, white))`,
                    boxShadow: `0 0 18px color-mix(in srgb, ${item.tone} 26%, transparent)`,
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  if (visualMode === 'rings') {
    return (
      <div className="grid h-full grid-cols-2 gap-2 text-center text-xs sm:text-sm">
        {queueItems.map((item) => {
          const ratio = item.value / maxValue
          const degrees = Math.max(12, Math.round(ratio * 360))
          return (
            <div key={item.label} className="relative flex flex-col items-center justify-center overflow-hidden rounded-sm border border-border/70 bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--secondary)_12%,transparent),transparent_54%),var(--surface-low)] px-2 py-3">
              <div
                className={cn('absolute inset-0 opacity-60', item.label === '실행' && item.value > 0 ? 'animate-pulse' : undefined)}
                style={{ background: `radial-gradient(circle at center, color-mix(in srgb, ${item.tone} 18%, transparent), transparent 62%)` }}
              />
              <div
                className={cn('relative flex h-14 w-14 items-center justify-center rounded-full border border-border/60 text-sm font-semibold text-foreground transition-transform', item.label === '실행' && item.value > 0 ? 'animate-pulse' : undefined)}
                style={{ background: `conic-gradient(${item.tone} 0deg ${degrees}deg, color-mix(in srgb, var(--surface-lowest) 92%, transparent) ${degrees}deg 360deg)` }}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background/92 shadow-[0_0_20px_rgba(0,0,0,0.18)] backdrop-blur-sm">
                  {item.value.toLocaleString('ko-KR')}
                </div>
              </div>
              <div className="relative mt-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{item.label}</div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="grid h-full grid-cols-2 gap-2 text-center text-xs sm:text-sm">
      {queueItems.map((item) => (
        <div key={item.label} className="relative overflow-hidden rounded-sm border border-border/70 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background)_20%,transparent),transparent),var(--surface-low)] px-2 py-3">
          <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: item.tone }} />
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{item.label}</div>
          <div className={cn('mt-1 text-lg font-semibold text-foreground', item.label === '실행' && item.value > 0 ? 'animate-pulse' : undefined)}>
            {item.value.toLocaleString('ko-KR')}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-lowest/90">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{
                width: `${Math.max(0.12, item.value / maxValue) * 100}%`,
                background: `linear-gradient(90deg, ${item.tone}, color-mix(in srgb, ${item.tone} 70%, white))`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Render one recent-results widget using the latest graph outputs. */
function WallpaperRecentResultsBody({ widget, mode, onOpenImage }: { widget: Extract<WallpaperWidgetInstance, { type: 'recent-results' }>; mode: 'editor' | 'runtime'; onOpenImage?: (image: WallpaperWidgetPreviewImage) => void }) {
  const refreshInterval = Math.max(5, widget.settings.refreshIntervalSec) * 1000
  const visibleCount = Math.max(1, Math.min(6, widget.settings.visibleCount))
  const displayMode = widget.settings.displayMode ?? 'grid'
  const shiftInterval = Math.max(4, widget.settings.shiftIntervalSec ?? 8) * 1000
  const imageTransitionStyle = widget.settings.imageTransitionStyle ?? 'zoom'
  const imageTransitionSpeed = widget.settings.imageTransitionSpeed ?? 'normal'
  const imageHoverMotion = widget.settings.imageHoverMotion ?? 'medium'

  const resultsQuery = useWallpaperBrowseContentQuery('recent-results', refreshInterval)

  const recentEntries = useMemo(() => {
    const browseContent = resultsQuery.data
    if (!browseContent) {
      return [] as Array<{ id: string; previewImage: ImageRecord; workflowName: string; createdLabel: string; badge: string }>
    }

    const workflowById = new Map(browseContent.workflows.map((workflow) => [workflow.id, workflow]))
    const executionById = new Map(browseContent.executions.map((execution) => [execution.id, execution]))
    const claimedArtifactIds = new Set<number>()

    const finalEntries = [...browseContent.final_results]
      .sort((left, right) => new Date(right.created_date).getTime() - new Date(left.created_date).getTime())
      .flatMap((finalResult) => {
        claimedArtifactIds.add(finalResult.source_artifact_id)
        const artifact = buildWallpaperFinalResultArtifact(finalResult)
        if (artifact.artifact_type !== 'image' && artifact.artifact_type !== 'mask') {
          return []
        }

        const previewUrl = getArtifactPreviewUrl(artifact)
        if (!previewUrl) {
          return []
        }

        const execution = executionById.get(finalResult.source_execution_id ?? finalResult.execution_id)
        const workflowName = execution ? (workflowById.get(execution.graph_workflow_id)?.name ?? '워크플로') : '워크플로'
        const previewImage = getWallpaperArtifactPreviewImage(previewUrl, workflowName, finalResult.source_metadata)
        if (!previewImage) {
          return []
        }

        return [{
          id: `final-${finalResult.id}`,
          previewImage,
          workflowName,
          createdLabel: formatDateTime(finalResult.created_date),
          badge: '최종',
        }]
      })

    const artifactEntries = [...browseContent.artifacts]
      .sort((left, right) => new Date(right.created_date).getTime() - new Date(left.created_date).getTime())
      .flatMap((artifact) => {
        if (claimedArtifactIds.has(artifact.id) || (artifact.artifact_type !== 'image' && artifact.artifact_type !== 'mask')) {
          return []
        }

        const previewUrl = getArtifactPreviewUrl(artifact)
        if (!previewUrl) {
          return []
        }

        const execution = executionById.get(artifact.execution_id)
        const workflowName = execution ? (workflowById.get(execution.graph_workflow_id)?.name ?? '워크플로') : '워크플로'
        const previewImage = getWallpaperArtifactPreviewImage(previewUrl, workflowName, artifact.metadata)
        if (!previewImage) {
          return []
        }

        return [{
          id: `artifact-${artifact.id}`,
          previewImage,
          workflowName,
          createdLabel: formatDateTime(artifact.created_date),
          badge: '실시간',
        }]
      })

    return [...finalEntries, ...artifactEntries].slice(0, visibleCount)
  }, [resultsQuery.data, visibleCount])

  const stackIndex = useWallpaperRotatingIndex(recentEntries.length, shiftInterval, displayMode === 'stack' && recentEntries.length > 1)

  if (resultsQuery.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">최근 결과 불러오는 중…</div>
  }

  if (resultsQuery.isError) {
    return <div className="flex h-full items-center justify-center text-center text-sm text-destructive">최근 결과를 불러오지 못했어.</div>
  }

  if (displayMode === 'stack') {
    const stackedEntries = recentEntries.map((entry, index) => ({
      entry,
      order: (index - stackIndex + recentEntries.length) % Math.max(recentEntries.length, 1),
    })).sort((left, right) => right.order - left.order)

    return (
      <div className="relative h-full overflow-hidden rounded-sm border border-border/70 bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--secondary)_12%,transparent),transparent_40%),var(--surface-low)]">
        {recentEntries.length === 0 ? (
          <div className="flex h-full items-center justify-center px-3 text-center text-sm text-muted-foreground">아직 최근 이미지 결과가 없어.</div>
        ) : null}

        {stackedEntries.map(({ entry, order }) => {
          const offsetX = order * 14
          const offsetY = order * 10
          const scale = Math.max(0.82, 1 - order * 0.05)
          const opacity = Math.max(0.28, 1 - order * 0.18)
          const rotate = (order % 2 === 0 ? -1 : 1) * order * 1.8
          const isFront = order === 0

          return (
            <WallpaperPreviewImageSurface
              key={`recent-stack-slot-${order}`}
              image={entry.previewImage}
              alt={entry.workflowName}
              onOpenImage={mode === 'runtime' ? onOpenImage : undefined}
              transitionStyle={imageTransitionStyle}
              transitionSpeed={imageTransitionSpeed}
              hoverMotion={imageHoverMotion}
              className="absolute inset-0 overflow-hidden rounded-xl border border-white/12 bg-surface-high shadow-[0_16px_42px_rgba(0,0,0,0.34)] transition-all duration-[1600ms] ease-out"
              imageClassName="h-full w-full object-cover"
              style={{
                inset: `${offsetY}px ${offsetX}px ${Math.max(0, offsetY * 0.4)}px ${Math.max(0, offsetX * 0.35)}px`,
                transform: `translate3d(${offsetX}px, ${offsetY}px, 0) rotate(${rotate}deg) scale(${scale})`,
                opacity,
                zIndex: 100 - order,
              }}
            >
              <div className="absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--background)_84%,transparent))] p-2">
                <div className="truncate text-xs font-medium text-white">{entry.workflowName}</div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.16em] text-white/78">
                  <span>{entry.badge}</span>
                  <span className="truncate">{isFront ? entry.createdLabel : `-${order}`}</span>
                </div>
              </div>
            </WallpaperPreviewImageSurface>
          )
        })}

        {recentEntries.length > 1 ? (
          <div className="pointer-events-none absolute right-2 top-2 rounded-full bg-background/72 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-foreground/90 backdrop-blur-sm">
            스택
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn('grid h-full gap-2', visibleCount >= 4 ? 'grid-cols-2' : 'grid-cols-1')}>
      {recentEntries.length === 0 ? (
        <div className="col-span-full flex h-full items-center justify-center rounded-sm border border-dashed border-border/80 bg-surface-low px-3 text-center text-sm text-muted-foreground">
          아직 최근 이미지 결과가 없어.
        </div>
      ) : null}

      {recentEntries.map((entry, index) => (
        <WallpaperPreviewImageSurface
          key={`recent-grid-slot-${index}`}
          image={entry.previewImage}
          alt={entry.workflowName}
          onOpenImage={mode === 'runtime' ? onOpenImage : undefined}
          transitionStyle={imageTransitionStyle}
          transitionSpeed={imageTransitionSpeed}
          hoverMotion={imageHoverMotion}
          className="relative overflow-hidden rounded-xl border border-border/70 bg-surface-low"
          imageClassName="h-full w-full object-cover"
        >
          <div className="absolute inset-x-0 bottom-0 z-[1] bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--background)_84%,transparent))] p-2">
            <div className="truncate text-xs font-medium text-white">{entry.workflowName}</div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.16em] text-white/78">
              <span>{entry.badge}</span>
              <span className="truncate">{entry.createdLabel}</span>
            </div>
          </div>
        </WallpaperPreviewImageSurface>
      ))}
    </div>
  )
}

/** Render one group-backed preview grid using the existing groups preview API. */
function WallpaperGroupImageViewBody({ widget, mode, onOpenImage }: { widget: Extract<WallpaperWidgetInstance, { type: 'group-image-view' }>; mode: 'editor' | 'runtime'; onOpenImage?: (image: WallpaperWidgetPreviewImage) => void }) {
  const groupId = widget.settings.groupId
  const includeChildren = widget.settings.includeChildren
  const visibleCount = Math.max(1, Math.min(9, widget.settings.visibleCount))
  const motionMode = widget.settings.motionMode ?? 'static'
  const motionStrength = getWallpaperMotionStrengthMultiplier(widget.settings.motionStrength ?? 'medium')
  const imageTransitionStyle = widget.settings.imageTransitionStyle ?? 'fade'
  const imageTransitionSpeed = widget.settings.imageTransitionSpeed ?? 'normal'
  const imageHoverMotion = widget.settings.imageHoverMotion ?? 'medium'
  const allowPointerMotion = motionMode === 'pointer' && mode === 'runtime'
  const ambientTick = useWallpaperMotionTick(motionMode === 'ambient')
  const [pointerOffset, setPointerOffset] = useState<{ x: number; y: number } | null>(null)

  const previewQuery = useWallpaperGroupPreviewImagesQuery('group-image-view', groupId, includeChildren, visibleCount)

  if (groupId === null) {
    return <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-border/80 bg-surface-low px-3 text-center text-sm text-muted-foreground">설정에서 그룹을 선택해.</div>
  }

  if (previewQuery.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">그룹 미리보기 불러오는 중…</div>
  }

  if (previewQuery.isError) {
    return <div className="flex h-full items-center justify-center text-center text-sm text-destructive">그룹 미리보기를 불러오지 못했어.</div>
  }

  const images = previewQuery.data ?? []
  const columnCount = visibleCount >= 6 ? 3 : visibleCount >= 4 ? 2 : 1
  const rowCount = Math.max(1, Math.ceil(Math.max(images.length, 1) / columnCount))

  return (
    <div
      className="relative grid h-full gap-2"
      style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
      onPointerMove={allowPointerMotion ? (event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const nextX = ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2
        const nextY = ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2
        setPointerOffset({ x: nextX, y: nextY })
      } : undefined}
      onPointerLeave={allowPointerMotion ? () => setPointerOffset(null) : undefined}
    >
      {images.length === 0 ? (
        <div className="col-span-full flex h-full items-center justify-center rounded-sm border border-dashed border-border/80 bg-surface-low px-3 text-center text-sm text-muted-foreground">
          이 그룹에는 아직 미리보기 이미지가 없어.
        </div>
      ) : null}
      {images.map((image, index) => {
        const imageUrl = getWallpaperImageUrl(image)
        const columnIndex = index % columnCount
        const rowIndex = Math.floor(index / columnCount)
        const columnBias = columnIndex - (columnCount - 1) / 2
        const rowBias = rowIndex - (rowCount - 1) / 2
        let translateX = 0
        let translateY = 0
        let scale = 1

        if (motionMode === 'ambient') {
          const phase = ambientTick / 8 + index * 0.72
          translateX = (Math.sin(phase) * 2.8 + columnBias * 1.35) * motionStrength
          translateY = (Math.cos(phase * 0.9) * 2.4 + rowBias * 1.15) * motionStrength
          scale = 1.025
        } else if (allowPointerMotion && pointerOffset) {
          translateX = (pointerOffset.x * 7 + columnBias * 1.8) * motionStrength
          translateY = (pointerOffset.y * 7 + rowBias * 1.8) * motionStrength
          scale = 1
        }

        return imageUrl ? (
          <WallpaperPreviewImageSurface
            key={`group-grid-slot-${index}`}
            image={image}
            alt="그룹 미리보기"
            onOpenImage={mode === 'runtime' ? onOpenImage : undefined}
            transitionStyle={imageTransitionStyle}
            transitionSpeed={imageTransitionSpeed}
            hoverMotion={imageHoverMotion}
            className="overflow-hidden rounded-lg border border-border/70 bg-surface-low transition-transform duration-200 ease-out will-change-transform"
            imageClassName="h-full w-full object-cover"
            style={{ transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})` }}
          />
        ) : (
          <div
            key={`group-grid-slot-${index}`}
            className="flex h-full min-h-16 items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-surface-low text-xs text-muted-foreground transition-transform duration-200 ease-out will-change-transform"
            style={{ transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})` }}
          >
            이미지 없음
          </div>
        )
      })}

    </div>
  )
}

/** Render one layered floating collage from one chosen image group. */
function WallpaperFloatingCollageBody({ widget, mode, onOpenImage }: { widget: Extract<WallpaperWidgetInstance, { type: 'floating-collage' }>; mode: 'editor' | 'runtime'; onOpenImage?: (image: WallpaperWidgetPreviewImage) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [cardStates, setCardStates] = useState<WallpaperFloatingCollageCardState[]>([])
  const groupId = widget.settings.groupId
  const includeChildren = widget.settings.includeChildren
  const visibleCount = Math.max(2, Math.min(6, widget.settings.visibleCount))
  const motionStrength = getWallpaperMotionStrengthMultiplier(widget.settings.motionStrength ?? 'medium')
  const motionSpeed = clampWallpaperFloatingCollageSpeed(widget.settings.motionSpeed ?? 1)
  const imageScalePercent = clampWallpaperMetric(widget.settings.imageScalePercent ?? 100, 50, 200)
  const layoutSpread = widget.settings.layoutSpread ?? 'compact'
  const aspectMode = widget.settings.aspectMode ?? 'image'
  const fitMode = widget.settings.fitMode ?? 'cover'
  const imageHoverMotion = widget.settings.imageHoverMotion ?? 'medium'
  const imageSwapMode = widget.settings.imageSwapMode ?? 'bounce'
  const swapIntervalSec = clampWallpaperFloatingCollageSwapIntervalSec(widget.settings.swapIntervalSec)
  const swapBounceCount = clampWallpaperFloatingCollageSwapBounceCount(widget.settings.swapBounceCount)
  const previewPoolCount = Math.max(visibleCount * 4, 16)
  const effectiveContainerWidth = Math.max(containerSize.width, 960)
  const effectiveContainerHeight = Math.max(containerSize.height, 540)

  const previewQuery = useWallpaperGroupPreviewImagesQuery('floating-collage', groupId, includeChildren, previewPoolCount)
  const collageSlots = useMemo(() => buildWallpaperFloatingCollageSlots(visibleCount, layoutSpread), [layoutSpread, visibleCount])
  const images = useMemo(() => previewQuery.data ?? [], [previewQuery.data])
  const imageCount = images.length
  const initialCardStates = useMemo(
    () => buildWallpaperFloatingCollageCardStates(
      collageSlots,
      images,
      motionStrength,
      motionSpeed,
      effectiveContainerWidth,
      effectiveContainerHeight,
      aspectMode,
      imageScalePercent,
    ),
    [aspectMode, collageSlots, effectiveContainerHeight, effectiveContainerWidth, imageScalePercent, images, motionSpeed, motionStrength],
  )

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    const updateSize = () => {
      const nextWidth = Math.max(0, element.clientWidth)
      const nextHeight = Math.max(0, element.clientHeight)
      setContainerSize((current) => (current.width === nextWidth && current.height === nextHeight ? current : { width: nextWidth, height: nextHeight }))
    }

    updateSize()
    const observer = new ResizeObserver(() => {
      updateSize()
    })
    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setCardStates(initialCardStates)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [initialCardStates])

  useEffect(() => {
    if (imageCount === 0 || cardStates.length === 0) {
      return
    }

    let frameId = 0
    let lastFrameTime = performance.now()
    const swapIntervalMs = swapIntervalSec * 1000

    const step = (now: number) => {
      const deltaMs = Math.min(48, now - lastFrameTime)
      lastFrameTime = now

      setCardStates((currentCards) => currentCards.map((card, index) => {
        const currentImage = images[card.imageIndex % imageCount] ?? images[index % imageCount]
        const resolvedAspectRatio = aspectMode === 'image'
          ? resolveWallpaperFloatingCollageAspectRatio(currentImage, card.aspectRatio)
          : card.aspectRatio
        const geometry = resolveWallpaperFloatingCollageCardGeometry(
          (card.width / Math.max(effectiveContainerWidth, 1)) * 100,
          resolvedAspectRatio,
          effectiveContainerWidth,
          effectiveContainerHeight,
          100,
        )
        const halfWidth = geometry.halfWidthPx
        const halfHeight = geometry.halfHeightPx

        let nextX = card.x + ((card.vx * deltaMs) / 1000)
        let nextY = card.y + ((card.vy * deltaMs) / 1000)
        let nextVx = card.vx
        let nextVy = card.vy
        let bounceEvents = 0

        if (nextX < halfWidth) {
          nextX = halfWidth + (halfWidth - nextX)
          nextVx = Math.abs(nextVx)
          bounceEvents += 1
        } else if (nextX > effectiveContainerWidth - halfWidth) {
          nextX = (effectiveContainerWidth - halfWidth) - (nextX - (effectiveContainerWidth - halfWidth))
          nextVx = -Math.abs(nextVx)
          bounceEvents += 1
        }

        if (nextY < halfHeight) {
          nextY = halfHeight + (halfHeight - nextY)
          nextVy = Math.abs(nextVy)
          bounceEvents += 1
        } else if (nextY > effectiveContainerHeight - halfHeight) {
          nextY = (effectiveContainerHeight - halfHeight) - (nextY - (effectiveContainerHeight - halfHeight))
          nextVy = -Math.abs(nextVy)
          bounceEvents += 1
        }

        const bounceCountDelta = bounceEvents > 0 ? 1 : 0
        let nextImageIndex = card.imageIndex
        let nextBounceCount = card.bounceCount + bounceCountDelta
        let nextElapsedSinceSwapMs = imageSwapMode === 'time' ? card.elapsedSinceSwapMs + deltaMs : 0

        if (imageCount > 1) {
          if (imageSwapMode === 'time') {
            if (nextElapsedSinceSwapMs >= swapIntervalMs) {
              nextImageIndex = getNextWallpaperFloatingCollageImageIndex(card.imageIndex, imageCount)
              nextBounceCount = 0
              nextElapsedSinceSwapMs = 0
            }
          } else if (bounceCountDelta > 0 && nextBounceCount >= swapBounceCount) {
            nextImageIndex = getNextWallpaperFloatingCollageImageIndex(card.imageIndex, imageCount)
            nextBounceCount = 0
            nextElapsedSinceSwapMs = 0
          }
        }

        return {
          ...card,
          x: nextX,
          y: nextY,
          vx: nextVx,
          vy: nextVy,
          width: geometry.widthPx,
          aspectRatio: resolvedAspectRatio,
          imageIndex: nextImageIndex,
          bounceCount: nextBounceCount,
          elapsedSinceSwapMs: nextElapsedSinceSwapMs,
        }
      }))

      frameId = window.requestAnimationFrame(step)
    }

    frameId = window.requestAnimationFrame(step)
    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [aspectMode, cardStates.length, effectiveContainerHeight, effectiveContainerWidth, imageCount, imageSwapMode, images, swapBounceCount, swapIntervalSec])

  if (groupId === null) {
    return <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-border/80 bg-surface-low px-3 text-center text-sm text-muted-foreground">설정에서 그룹을 선택해.</div>
  }

  if (previewQuery.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">콜라주 불러오는 중…</div>
  }

  if (previewQuery.isError) {
    return <div className="flex h-full items-center justify-center text-center text-sm text-destructive">콜라주 이미지를 불러오지 못했어.</div>
  }

  return (
    <div ref={containerRef} className="relative h-full overflow-hidden rounded-sm border border-border/70 bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--secondary)_14%,transparent),transparent_42%),var(--surface-low)]">
      {imageCount === 0 ? (
        <div className="flex h-full items-center justify-center px-3 text-center text-sm text-muted-foreground">표시할 콜라주 이미지가 없어.</div>
      ) : null}

      {cardStates.map((card, index) => {
        const image = images[card.imageIndex % imageCount] ?? images[index % imageCount]
        const imageUrl = getWallpaperImageUrl(image)
        const resolvedAspectRatio = aspectMode === 'image'
          ? resolveWallpaperFloatingCollageAspectRatio(image, card.aspectRatio)
          : card.aspectRatio
        const wobblePhase = (card.x * 0.07) + (card.y * 0.05) + card.scalePhase
        const scale = 1.01 + ((Math.sin(wobblePhase) + 1) * 0.012 * motionStrength)
        const rotate = card.rotate + (Math.sin((card.x + card.y) * 0.045 + card.scalePhase) * (4.2 + card.depth) * motionStrength)
        const zIndex = 20 + Math.round(card.y / 8) + card.depth

        return imageUrl ? (
          <WallpaperPreviewImageSurface
            key={card.key}
            image={image}
            alt="플로팅 콜라주"
            onOpenImage={mode === 'runtime' ? onOpenImage : undefined}
            transitionStyle="fade"
            transitionSpeed="fast"
            hoverMotion={imageHoverMotion}
            className="absolute overflow-hidden rounded-2xl border border-white/15 bg-surface-high shadow-[0_18px_48px_rgba(0,0,0,0.30)] transition-transform duration-75 ease-linear will-change-transform"
            imageClassName={cn('h-full w-full', fitMode === 'contain' ? 'object-contain' : 'object-cover')}
            style={{
              left: `${card.x}px`,
              top: `${card.y}px`,
              width: `${card.width}px`,
              aspectRatio: resolvedAspectRatio,
              zIndex,
              transform: `translate3d(-50%, -50%, 0) rotate(${rotate}deg) scale(${scale})`,
            }}
          />
        ) : (
          <div
            key={card.key}
            className="absolute flex items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-surface-high text-xs text-muted-foreground shadow-[0_18px_48px_rgba(0,0,0,0.30)] transition-transform duration-75 ease-linear will-change-transform"
            style={{
              left: `${card.x}px`,
              top: `${card.y}px`,
              width: `${card.width}px`,
              aspectRatio: resolvedAspectRatio,
              zIndex,
              transform: `translate3d(-50%, -50%, 0) rotate(${rotate}deg) scale(${scale})`,
            }}
          >
            이미지 없음
          </div>
        )
      })}

      {imageCount > 0 ? <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,color-mix(in_srgb,var(--background)_22%,transparent))]" /> : null}
    </div>
  )
}

/** Render one showcase-style image widget with optional motion playback. */
function WallpaperImageShowcaseBody({ widget, mode, onOpenImage }: { widget: Extract<WallpaperWidgetInstance, { type: 'image-showcase' }>; mode: 'editor' | 'runtime'; onOpenImage?: (image: WallpaperWidgetPreviewImage) => void }) {
  const groupId = widget.settings.groupId
  const includeChildren = widget.settings.includeChildren
  const playbackMode = widget.settings.playbackMode ?? 'carousel'
  const previewCount = playbackMode === 'static' ? 1 : 10
  const slideshowInterval = Math.max(4, widget.settings.slideshowIntervalSec) * 1000
  const imageTransitionStyle = widget.settings.imageTransitionStyle ?? 'fade'
  const imageTransitionSpeed = widget.settings.imageTransitionSpeed ?? 'normal'
  const imageHoverMotion = widget.settings.imageHoverMotion ?? 'medium'

  const previewQuery = useWallpaperGroupPreviewImagesQuery('image-showcase', groupId, includeChildren, previewCount)

  const images = previewQuery.data ?? []
  const rotationEnabled = playbackMode !== 'static' && images.length > 1
  const kenBurnsEnabled = playbackMode === 'ken-burns'
  const currentIndex = useWallpaperRotatingIndex(images.length, slideshowInterval, rotationEnabled)
  const motionTick = useWallpaperMotionTick(kenBurnsEnabled)
  const currentImage = images[currentIndex] ?? images[0] ?? null
  const imageUrl = getWallpaperImageUrl(currentImage)

  if (groupId === null) {
    return (
      <div className="flex h-full items-end rounded-sm border border-border/70 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--secondary)_24%,transparent),transparent_55%),linear-gradient(180deg,transparent,color-mix(in_srgb,var(--primary)_10%,transparent)),var(--surface-low)] p-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-secondary">대표 이미지</div>
          <div className="text-sm font-medium text-foreground">설정에서 쇼케이스용 그룹을 골라.</div>
        </div>
      </div>
    )
  }

  if (previewQuery.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">쇼케이스 불러오는 중…</div>
  }

  if (!imageUrl) {
    return <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-border/80 bg-surface-low px-3 text-center text-sm text-muted-foreground">표시할 쇼케이스 이미지가 없어.</div>
  }

  const motionPhase = motionTick / 18 + currentIndex * 0.8
  const kenBurnsTranslateX = Math.sin(motionPhase * 0.8) * 8
  const kenBurnsTranslateY = Math.cos(motionPhase * 0.6) * 6
  const kenBurnsScale = 1.08 + ((Math.sin(motionPhase * 0.5) + 1) * 0.03)
  const showcaseTransform = kenBurnsEnabled
    ? `translate3d(${kenBurnsTranslateX}px, ${kenBurnsTranslateY}px, 0) scale(${kenBurnsScale})`
    : rotationEnabled
      ? 'scale(1.03)'
      : 'scale(1)'

  return (
    <WallpaperPreviewImageSurface
      image={currentImage}
      alt="쇼케이스"
      onOpenImage={mode === 'runtime' ? onOpenImage : undefined}
      transitionStyle={imageTransitionStyle}
      transitionSpeed={imageTransitionSpeed}
      hoverMotion={imageHoverMotion}
      className="relative h-full overflow-hidden rounded-xl border border-border/70 bg-surface-low"
      imageClassName={cn(
        'h-full w-full rounded-xl ease-out will-change-transform',
        widget.settings.fitMode === 'contain' ? 'object-contain' : 'object-cover',
        kenBurnsEnabled ? 'transition-transform duration-200' : 'transition-transform duration-[1600ms]',
      )}
      imageStyle={{ transform: showcaseTransform }}
    >
      {rotationEnabled ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--background)_74%,transparent))] px-3 py-2">
          <div className="flex items-center gap-1.5">
            {images.slice(0, 6).map((image, index) => (
              <span
                key={String(image.composite_hash ?? image.id ?? index)}
                className={cn(
                  'block h-1.5 rounded-full bg-white/55 transition-all duration-300',
                  index === currentIndex ? 'w-4 bg-white' : 'w-1.5',
                )}
              />
            ))}
          </div>
          <div className="rounded-full bg-background/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-foreground/92 backdrop-blur-sm">
            {kenBurnsEnabled ? '켄 번즈' : '자동'}
          </div>
        </div>
      ) : null}
    </WallpaperPreviewImageSurface>
  )
}

/** Render one subtle activity pulse widget from shared queue and result activity. */
function WallpaperActivityPulseBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'activity-pulse' }> }) {
  const refreshInterval = Math.max(2, widget.settings.refreshIntervalSec) * 1000
  const motionStrength = getWallpaperMotionStrengthMultiplier(widget.settings.motionStrength ?? 'medium')
  const emphasis = widget.settings.emphasis ?? 'mixed'
  const motionTick = useWallpaperMotionTick(true)
  const activityQuery = useWallpaperBrowseContentQuery('activity-pulse', refreshInterval)

  const summary = useMemo(() => {
    const browseContent = activityQuery.data
    if (!browseContent) {
      return {
        queued: 0,
        running: 0,
        failed: 0,
        completed: 0,
        recentResults: 0,
        lastUpdated: null as string | null,
      }
    }

    const executions = browseContent.executions
    const queued = executions.filter((item) => item.status === 'queued').length
    const running = executions.filter((item) => item.status === 'running').length
    const failed = executions.filter((item) => item.status === 'failed').length
    const completed = executions.filter((item) => item.status === 'completed').length
    const recentResults = browseContent.final_results.length
    const latestExecution = [...executions].sort((left, right) => new Date(right.updated_date).getTime() - new Date(left.updated_date).getTime())[0]

    return {
      queued,
      running,
      failed,
      completed,
      recentResults,
      lastUpdated: latestExecution?.updated_date ?? null,
    }
  }, [activityQuery.data])

  if (activityQuery.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">활동 흐름 불러오는 중…</div>
  }

  if (activityQuery.isError) {
    return <div className="flex h-full items-center justify-center text-center text-sm text-destructive">활동 흐름을 불러오지 못했어.</div>
  }

  const emphasisWeight = emphasis === 'queue'
    ? summary.running * 1.35 + summary.queued * 1.1 + summary.failed * 0.5
    : emphasis === 'results'
      ? summary.completed * 0.8 + summary.recentResults * 1.35
      : summary.running * 1.15 + summary.queued * 0.9 + summary.recentResults * 0.95 + summary.failed * 0.6
  const intensity = Math.min(1, emphasisWeight / 10)
  const pulseBars = Array.from({ length: 16 }, (_, index) => {
    const phase = motionTick / 10 + index * 0.72
    const wave = (Math.sin(phase) + Math.cos(phase * 0.65 + intensity * 2.8)) / 2
    const emphasisBoost = emphasis === 'queue'
      ? (index % 4 === 0 ? 0.18 : 0)
      : emphasis === 'results'
        ? (index % 5 === 2 ? 0.22 : 0)
        : (index % 3 === 1 ? 0.1 : 0)
    return Math.max(0.16, Math.min(1, 0.22 + intensity * 0.5 + wave * 0.22 * motionStrength + emphasisBoost))
  })
  const statusTone = summary.failed > 0 ? '#ff6b6b' : summary.running > 0 ? '#3ddc97' : 'var(--secondary)'
  const activityBadge = summary.running > 0 ? '실행 중' : summary.queued > 0 ? '대기 중' : summary.recentResults > 0 ? '최근 결과' : '한가함'

  return (
    <div className="flex h-full flex-col justify-between gap-3 rounded-sm bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--secondary)_18%,transparent),transparent_46%),linear-gradient(180deg,color-mix(in_srgb,var(--primary)_8%,transparent),transparent_60%)] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">활동</div>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-2xl font-semibold tracking-[-0.08em] text-foreground sm:text-3xl">{summary.running + summary.queued}</span>
            <span className="pb-1 text-xs text-muted-foreground">진행 부하</span>
          </div>
        </div>
        <div className="rounded-full border border-border/70 bg-background/50 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-foreground/92 backdrop-blur-sm">
          {activityBadge}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-end gap-1 rounded-sm border border-border/60 bg-background/35 px-2 py-2 backdrop-blur-sm">
        {pulseBars.map((heightRatio, index) => (
          <div
            key={index}
            className="flex-1 rounded-full transition-[height,opacity,transform] duration-200 ease-out"
            style={{
              height: `${Math.round(22 + heightRatio * 78)}%`,
              opacity: 0.48 + heightRatio * 0.48,
              transform: `translateY(${Math.round((1 - heightRatio) * 4)}px)`,
              background: `linear-gradient(180deg, color-mix(in srgb, ${statusTone} 92%, white), color-mix(in srgb, ${statusTone} 58%, transparent))`,
              boxShadow: `0 0 18px color-mix(in srgb, ${statusTone} 20%, transparent)`,
            }}
          />
        ))}
      </div>

      <div className="grid grid-cols-4 gap-2 text-center text-[11px] sm:text-xs">
        {[
          { label: '실행', value: summary.running },
          { label: '대기', value: summary.queued },
          { label: '결과', value: summary.recentResults },
          { label: '실패', value: summary.failed },
        ].map((item) => (
          <div key={item.label} className="rounded-sm border border-border/60 bg-background/35 px-2 py-1.5 backdrop-blur-sm">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{item.label}</div>
            <div className={cn('mt-1 font-semibold text-foreground', item.label === '실행' && item.value > 0 ? 'animate-pulse' : undefined)}>
              {item.value.toLocaleString('ko-KR')}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>{emphasis === 'queue' ? '큐 중심' : emphasis === 'results' ? '결과 중심' : '혼합'}</span>
        <span>{summary.lastUpdated ? formatDateTime(summary.lastUpdated) : '업데이트 없음'}</span>
      </div>
    </div>
  )
}

/** Render one widget body based on the widget type. */
export function WallpaperWidgetBody({ widget, mode, onOpenImage }: { widget: WallpaperWidgetInstance; mode: 'editor' | 'runtime'; onOpenImage?: (image: WallpaperWidgetPreviewImage) => void }) {
  if (widget.type === 'clock') {
    return <WallpaperClockBody widget={widget} />
  }

  if (widget.type === 'queue-status') {
    return <WallpaperQueueStatusBody widget={widget} />
  }

  if (widget.type === 'recent-results') {
    return <WallpaperRecentResultsBody widget={widget} mode={mode} onOpenImage={onOpenImage} />
  }

  if (widget.type === 'activity-pulse') {
    return <WallpaperActivityPulseBody widget={widget} />
  }

  if (widget.type === 'group-image-view') {
    return <WallpaperGroupImageViewBody widget={widget} mode={mode} onOpenImage={onOpenImage} />
  }

  if (widget.type === 'image-showcase') {
    return <WallpaperImageShowcaseBody widget={widget} mode={mode} onOpenImage={onOpenImage} />
  }

  if (widget.type === 'floating-collage') {
    return <WallpaperFloatingCollageBody widget={widget} mode={mode} onOpenImage={onOpenImage} />
  }

  return (
    <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-border/80 bg-surface-low px-3 text-center text-sm text-muted-foreground">
      {widget.settings.text}
    </div>
  )
}
