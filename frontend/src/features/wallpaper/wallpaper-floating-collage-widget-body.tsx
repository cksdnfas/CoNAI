import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { WallpaperWidgetInstance } from './wallpaper-types'
import { useWallpaperGroupPreviewImagesQuery } from './wallpaper-widget-data'
import {
  WallpaperPreviewImageSurface,
  type WallpaperWidgetPreviewImage,
} from './wallpaper-widget-preview-surface'
import {
  getWallpaperAnimationEasingCss,
  getWallpaperHoverMotionAmount,
  getWallpaperImageUrl,
  getWallpaperMotionStrengthMultiplier,
} from './wallpaper-widget-utils'

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

function clampWallpaperMetric(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
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

/** Render one layered floating collage from one chosen image group. */
export function WallpaperFloatingCollageBody({ widget, mode, onOpenImage }: { widget: Extract<WallpaperWidgetInstance, { type: 'floating-collage' }>; mode: 'editor' | 'runtime'; onOpenImage?: (image: WallpaperWidgetPreviewImage) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [cardStates, setCardStates] = useState<WallpaperFloatingCollageCardState[]>([])
  const groupId = widget.settings.groupId
  const includeChildren = widget.settings.includeChildren
  const visibleCount = Math.max(2, Math.min(6, widget.settings.visibleCount))
  const motionStrength = getWallpaperMotionStrengthMultiplier(widget.settings.motionStrength ?? 1)
  const motionEasing = widget.settings.motionEasing ?? 'linear'
  const motionSpeed = clampWallpaperFloatingCollageSpeed(widget.settings.motionSpeed ?? 1)
  const imageScalePercent = clampWallpaperMetric(widget.settings.imageScalePercent ?? 100, 50, 200)
  const layoutSpread = widget.settings.layoutSpread ?? 'compact'
  const aspectMode = widget.settings.aspectMode ?? 'image'
  const fitMode = widget.settings.fitMode ?? 'cover'
  const imageHoverMotion = getWallpaperHoverMotionAmount(widget.settings.imageHoverMotion ?? 1)
  const imageTransitionEasing = widget.settings.imageTransitionEasing ?? 'easeOutCubic'
  const hoverEasing = widget.settings.hoverEasing ?? 'easeOutCubic'
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
            transitionEasing={imageTransitionEasing}
            hoverMotion={imageHoverMotion}
            hoverEasing={hoverEasing}
            previewOpenScalePercent={widget.settings.imagePreviewOpenScalePercent}
            previewOpenDurationMs={widget.settings.imagePreviewOpenDurationMs}
            previewOpenEasing={widget.settings.imagePreviewOpenEasing}
            previewCloseScalePercent={widget.settings.imagePreviewCloseScalePercent}
            previewCloseDurationMs={widget.settings.imagePreviewCloseDurationMs}
            previewCloseEasing={widget.settings.imagePreviewCloseEasing}
            className="absolute overflow-hidden rounded-2xl border border-white/15 bg-surface-high shadow-[0_18px_48px_rgba(0,0,0,0.30)] transition-transform duration-75 will-change-transform"
            imageClassName={cn('h-full w-full', fitMode === 'contain' ? 'object-contain' : 'object-cover')}
            style={{
              left: `${card.x}px`,
              top: `${card.y}px`,
              width: `${card.width}px`,
              aspectRatio: resolvedAspectRatio,
              zIndex,
              transform: `translate3d(-50%, -50%, 0) rotate(${rotate}deg) scale(${scale})`,
              transitionTimingFunction: getWallpaperAnimationEasingCss(motionEasing),
            }}
          />
        ) : (
          <div
            key={card.key}
            className="absolute flex items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-surface-high text-xs text-muted-foreground shadow-[0_18px_48px_rgba(0,0,0,0.30)] transition-transform duration-75 will-change-transform"
            style={{
              left: `${card.x}px`,
              top: `${card.y}px`,
              width: `${card.width}px`,
              aspectRatio: resolvedAspectRatio,
              zIndex,
              transform: `translate3d(-50%, -50%, 0) rotate(${rotate}deg) scale(${scale})`,
              transitionTimingFunction: getWallpaperAnimationEasingCss(motionEasing),
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
