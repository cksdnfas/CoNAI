import { useEffect, useMemo, useRef, useState } from 'react'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { getImageListPreviewUrl } from '@/features/images/components/image-list/image-list-utils'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import {
  buildWallpaperFloatingCollageCardStates,
  buildWallpaperFloatingCollageSeeds,
  clampWallpaperFloatingCollageScalePercent,
  clampWallpaperFloatingCollageSpeed,
  clampWallpaperFloatingCollageSwapBounceCount,
  clampWallpaperFloatingCollageSwapIntervalSec,
  clampWallpaperFloatingCollageTransitionDurationMs,
  clampWallpaperMetric,
  decrementWallpaperFloatingCollageImageUsage,
  getWallpaperFloatingCollageImageKey,
  incrementWallpaperFloatingCollageImageUsage,
  preloadWallpaperFloatingCollageImage,
  resolveNextWallpaperFloatingCollageImageIndex,
  resolveWallpaperFloatingCollageAspectRatio,
  resolveWallpaperFloatingCollageCardGeometry,
  resolveWallpaperFloatingCollageSpawnProgress,
  resolveWallpaperFloatingCollageTransitionLayerStyle,
  resolveWallpaperFloatingCollageVisualBounds,
  resolveWallpaperFloatingCollageVisualMotion,
  resizeWallpaperFloatingCollageCard,
  type WallpaperFloatingCollageCardState,
} from './wallpaper-floating-collage-utils'
import type { WallpaperWidgetInstance } from './wallpaper-types'
import { useWallpaperGroupPreviewImagesQuery } from './wallpaper-widget-data'
import { type WallpaperWidgetPreviewImage } from './wallpaper-widget-preview-surface'
import {
  evaluateWallpaperAnimationEasingAtTime,
  getWallpaperAnimationEasingCss,
  getWallpaperMotionStrengthMultiplier,
} from './wallpaper-widget-utils'

const WALLPAPER_FLOATING_COLLAGE_SPAWN_HOLD_MS = 900
const WALLPAPER_FLOATING_COLLAGE_SPAWN_BLEND_MS = 1100

/** Render one layered floating collage that always stays inside the widget area. */
export function WallpaperFloatingCollageBody({ widget, mode, onOpenImage }: { widget: Extract<WallpaperWidgetInstance, { type: 'floating-collage' }>; mode: 'editor' | 'runtime'; onOpenImage?: (image: WallpaperWidgetPreviewImage) => void }) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const spawnHoldUntilRef = useRef(0)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [cardStates, setCardStates] = useState<WallpaperFloatingCollageCardState[]>([])
  const [spawnAnchor, setSpawnAnchor] = useState<{ x: number; y: number; holdUntil: number; blendUntil: number; active: boolean }>({ x: 0, y: 0, holdUntil: 0, blendUntil: 0, active: false })
  const groupId = widget.settings.groupId
  const includeChildren = widget.settings.includeChildren
  const visibleCount = Math.max(2, Math.min(6, widget.settings.visibleCount))
  const motionStrength = getWallpaperMotionStrengthMultiplier(widget.settings.motionStrength ?? 1)
  const motionEasing = widget.settings.motionEasing ?? 'linear'
  const motionSpeed = clampWallpaperFloatingCollageSpeed(widget.settings.motionSpeed ?? 1)
  const imageScalePercent = clampWallpaperFloatingCollageScalePercent(widget.settings.imageScalePercent ?? 100)
  const aspectMode = widget.settings.aspectMode ?? 'image'
  const fitMode = widget.settings.fitMode ?? 'cover'
  const imageSwapMode = widget.settings.imageSwapMode ?? 'bounce'
  const transitionStyle = widget.settings.imageTransitionStyle ?? 'fade'
  const transitionDurationMs = clampWallpaperFloatingCollageTransitionDurationMs(widget.settings.imageTransitionDurationMs)
  const swapTransitionEasing = widget.settings.imageTransitionEasing ?? 'easeOutCubic'
  const swapIntervalSec = clampWallpaperFloatingCollageSwapIntervalSec(widget.settings.swapIntervalSec)
  const swapBounceCount = clampWallpaperFloatingCollageSwapBounceCount(widget.settings.swapBounceCount)
  const previewPoolCount = Math.max(visibleCount * 4, 16)

  const previewQuery = useWallpaperGroupPreviewImagesQuery('floating-collage', groupId, includeChildren, previewPoolCount)
  const images = useMemo(() => previewQuery.data ?? [], [previewQuery.data])
  const seeds = useMemo(() => buildWallpaperFloatingCollageSeeds(visibleCount), [visibleCount])
  const initialCardStates = useMemo(
    () => buildWallpaperFloatingCollageCardStates(
      seeds,
      images,
      motionStrength,
      motionSpeed,
      containerSize.width,
      containerSize.height,
      aspectMode,
      imageScalePercent,
    ),
    [aspectMode, containerSize.height, containerSize.width, imageScalePercent, images, motionSpeed, motionStrength, seeds],
  )
  const initialVisibleImageUrls = useMemo(
    () => Array.from(new Set(initialCardStates.map((card, index) => {
      const image = images[card.imageIndex % images.length] ?? images[index % images.length]
      return image ? getImageListPreviewUrl(image) : null
    }).filter((value): value is string => typeof value === 'string' && value.length > 0))),
    [images, initialCardStates],
  )

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    const updateSize = () => {
      const nextWidth = Math.max(0, element.clientWidth)
      const nextHeight = Math.max(0, element.clientHeight)
      setContainerSize((current) => (
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight }
      ))
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
    let cancelled = false
    let holdTimeoutId: number | null = null
    let frameId: number | null = null

    if (initialCardStates.length === 0) {
      setCardStates([])
      setSpawnAnchor({ x: 0, y: 0, holdUntil: 0, blendUntil: 0, active: false })
      return () => {
        if (holdTimeoutId !== null) {
          window.clearTimeout(holdTimeoutId)
        }
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId)
        }
      }
    }

    setCardStates([])
    setSpawnAnchor({ x: 0, y: 0, holdUntil: 0, blendUntil: 0, active: false })

    void Promise.all(initialVisibleImageUrls.map((url) => preloadWallpaperFloatingCollageImage(url))).then(() => {
      if (cancelled) {
        return
      }

      frameId = window.requestAnimationFrame(() => {
        if (cancelled) {
          return
        }

        const firstCard = initialCardStates[0]
        const startedAt = performance.now()
        const holdUntil = startedAt + WALLPAPER_FLOATING_COLLAGE_SPAWN_HOLD_MS
        const blendUntil = holdUntil + WALLPAPER_FLOATING_COLLAGE_SPAWN_BLEND_MS
        spawnHoldUntilRef.current = holdUntil
        setCardStates(initialCardStates)
        setSpawnAnchor(firstCard ? { x: firstCard.x, y: firstCard.y, holdUntil, blendUntil, active: true } : { x: 0, y: 0, holdUntil: 0, blendUntil: 0, active: false })

        if (firstCard) {
          holdTimeoutId = window.setTimeout(() => {
            setSpawnAnchor((current) => (current.active ? { ...current, active: false } : current))
          }, WALLPAPER_FLOATING_COLLAGE_SPAWN_HOLD_MS + WALLPAPER_FLOATING_COLLAGE_SPAWN_BLEND_MS)
        }
      })
    })

    return () => {
      cancelled = true
      if (holdTimeoutId !== null) {
        window.clearTimeout(holdTimeoutId)
      }
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [initialCardStates, initialVisibleImageUrls])

  useEffect(() => {
    if (images.length === 0 || cardStates.length === 0 || containerSize.width <= 0 || containerSize.height <= 0) {
      return
    }

    let frameId = 0
    let lastFrameTime = performance.now()
    const swapIntervalMs = swapIntervalSec * 1000

    const step = (now: number) => {
      const deltaMs = Math.min(48, now - lastFrameTime)
      lastFrameTime = now

      if (now < spawnHoldUntilRef.current) {
        frameId = window.requestAnimationFrame(step)
        return
      }

      setCardStates((currentCards) => {
        const usedImageKeys = new Map<string, number>()
        currentCards.forEach((card, index) => {
          const image = images[card.imageIndex % images.length] ?? images[index % images.length]
          incrementWallpaperFloatingCollageImageUsage(usedImageKeys, getWallpaperFloatingCollageImageKey(image))
        })

        return currentCards.map((card, index) => {
          const currentImage = images[card.imageIndex % images.length] ?? images[index % images.length]
          const currentImageKey = getWallpaperFloatingCollageImageKey(currentImage)
          decrementWallpaperFloatingCollageImageUsage(usedImageKeys, currentImageKey)
          const currentAspectRatio = aspectMode === 'image'
            ? resolveWallpaperFloatingCollageAspectRatio(currentImage, card.aspectRatio)
            : card.aspectRatio
          const currentGeometry = resolveWallpaperFloatingCollageCardGeometry(
            card.slotWidthPercent,
            currentAspectRatio,
            containerSize.width,
            containerSize.height,
            imageScalePercent,
          )
          const resizedCard = resizeWallpaperFloatingCollageCard(card, currentGeometry, containerSize.width, containerSize.height, motionStrength)

          let nextX = resizedCard.x + ((card.vx * deltaMs) / 1000)
          let nextY = resizedCard.y + ((card.vy * deltaMs) / 1000)
          let nextVx = card.vx
          let nextVy = card.vy
          let bounceEvents = 0

          const bounds = resolveWallpaperFloatingCollageVisualBounds({
            x: nextX,
            y: nextY,
            width: resizedCard.width,
            height: resizedCard.height,
            rotationBase: card.rotationBase,
            depth: card.depth,
            wobblePhase: card.wobblePhase,
          }, containerSize.width, containerSize.height, motionStrength)

          if (nextX < bounds.minX) {
            nextX = bounds.minX + (bounds.minX - nextX)
            nextVx = Math.abs(nextVx)
            bounceEvents += 1
          } else if (nextX > bounds.maxX) {
            nextX = bounds.maxX - (nextX - bounds.maxX)
            nextVx = -Math.abs(nextVx)
            bounceEvents += 1
          }

          if (nextY < bounds.minY) {
            nextY = bounds.minY + (bounds.minY - nextY)
            nextVy = Math.abs(nextVy)
            bounceEvents += 1
          } else if (nextY > bounds.maxY) {
            nextY = bounds.maxY - (nextY - bounds.maxY)
            nextVy = -Math.abs(nextVy)
            bounceEvents += 1
          }

          const nextBounceCount = bounceEvents > 0 ? card.bounceCount + 1 : card.bounceCount
          const nextElapsedSinceSwapMs = imageSwapMode === 'time' ? card.elapsedSinceSwapMs + deltaMs : 0
          const nextTransitionElapsedMs = card.previousImageIndex === null
            ? card.transitionElapsedMs
            : Math.min(transitionDurationMs, card.transitionElapsedMs + deltaMs)
          const resolvedPreviousImageIndex = card.previousImageIndex !== null && nextTransitionElapsedMs < transitionDurationMs
            ? card.previousImageIndex
            : null
          const shouldSwapImage = images.length > 1 && (
            imageSwapMode === 'time'
              ? nextElapsedSinceSwapMs >= swapIntervalMs
              : bounceEvents > 0 && nextBounceCount >= swapBounceCount
          )

          if (!shouldSwapImage) {
            incrementWallpaperFloatingCollageImageUsage(usedImageKeys, currentImageKey)
            return {
              ...card,
              x: nextX,
              y: nextY,
              width: resizedCard.width,
              height: resizedCard.height,
              aspectRatio: currentAspectRatio,
              vx: nextVx,
              vy: nextVy,
              previousImageIndex: resolvedPreviousImageIndex,
              transitionElapsedMs: resolvedPreviousImageIndex === null ? transitionDurationMs : nextTransitionElapsedMs,
              bounceCount: nextBounceCount,
              elapsedSinceSwapMs: nextElapsedSinceSwapMs,
            }
          }

          const nextImageIndex = resolveNextWallpaperFloatingCollageImageIndex(card.imageIndex, images, usedImageKeys)
          const nextImage = images[nextImageIndex] ?? currentImage
          const nextImageKey = getWallpaperFloatingCollageImageKey(nextImage)
          const nextAspectRatio = aspectMode === 'image'
            ? resolveWallpaperFloatingCollageAspectRatio(nextImage, currentAspectRatio)
            : currentAspectRatio
          const nextGeometry = resolveWallpaperFloatingCollageCardGeometry(
            card.slotWidthPercent,
            nextAspectRatio,
            containerSize.width,
            containerSize.height,
            imageScalePercent,
          )
          const nextSizedCard = resizeWallpaperFloatingCollageCard(
            {
              ...card,
              x: nextX,
              y: nextY,
              width: resizedCard.width,
              height: resizedCard.height,
            },
            nextGeometry,
            containerSize.width,
            containerSize.height,
            motionStrength,
          )

          incrementWallpaperFloatingCollageImageUsage(usedImageKeys, nextImageKey)

          return {
            ...card,
            x: nextSizedCard.x,
            y: nextSizedCard.y,
            width: nextSizedCard.width,
            height: nextSizedCard.height,
            aspectRatio: nextAspectRatio,
            vx: nextVx,
            vy: nextVy,
            imageIndex: nextImageIndex,
            previousImageIndex: card.imageIndex,
            transitionElapsedMs: 0,
            bounceCount: 0,
            elapsedSinceSwapMs: 0,
          }
        })
      })

      frameId = window.requestAnimationFrame(step)
    }

    frameId = window.requestAnimationFrame(step)
    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [aspectMode, cardStates.length, containerSize.height, containerSize.width, imageScalePercent, imageSwapMode, images, motionStrength, swapBounceCount, swapIntervalSec, transitionDurationMs])

  if (groupId === null) {
    return <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-border/80 bg-surface-low px-3 text-center text-sm text-muted-foreground">{t({ ko: '설정에서 그룹을 선택해.', en: 'Select a group in settings.' })}</div>
  }

  if (previewQuery.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t({ ko: '콜라주 불러오는 중…', en: 'Loading collage…' })}</div>
  }

  if (previewQuery.isError) {
    return <div className="flex h-full items-center justify-center text-center text-sm text-destructive">{t({ ko: '콜라주 이미지를 불러오지 못했어.', en: 'Failed to load collage images.' })}</div>
  }

  return (
    <div ref={containerRef} className="relative h-full overflow-hidden rounded-sm border border-border/70 bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--secondary)_14%,transparent),transparent_42%),var(--surface-low)]">
      {images.length === 0 ? (
        <div className="flex h-full items-center justify-center px-3 text-center text-sm text-muted-foreground">{t({ ko: '표시할 콜라주 이미지가 없어.', en: 'There are no collage images to display.' })}</div>
      ) : null}

      {cardStates.map((card, index) => {
        const image = images[card.imageIndex % images.length] ?? images[index % images.length]
        const previousImage = card.previousImageIndex !== null
          ? (images[card.previousImageIndex % images.length] ?? null)
          : null
        const previewUrl = image ? getImageListPreviewUrl(image) : null
        const previousPreviewUrl = previousImage ? getImageListPreviewUrl(previousImage) : null
        const { scale, rotate } = resolveWallpaperFloatingCollageVisualMotion(card, motionStrength)
        const zIndex = 20 + (card.depth * 100) + index
        const spawnNow = spawnAnchor.active ? performance.now() : 0
        const spawnProgress = resolveWallpaperFloatingCollageSpawnProgress(spawnAnchor, spawnNow)
        const renderX = spawnAnchor.active ? spawnAnchor.x + ((card.x - spawnAnchor.x) * spawnProgress) : card.x
        const renderY = spawnAnchor.active ? spawnAnchor.y + ((card.y - spawnAnchor.y) * spawnProgress) : card.y
        const cardStyle = {
          left: `${renderX}px`,
          top: `${renderY}px`,
          width: `${card.width}px`,
          height: `${card.height}px`,
          zIndex,
          transform: `translate3d(0, 0, 0) rotate(${rotate}deg) scale(${scale})`,
          transformOrigin: 'center center',
          backfaceVisibility: 'hidden' as const,
          transformStyle: 'preserve-3d' as const,
          transitionTimingFunction: getWallpaperAnimationEasingCss(motionEasing),
        }
        const mediaClassName = cn('h-full w-full select-none pointer-events-none', fitMode === 'contain' ? 'object-contain' : 'object-cover')
        const easedTransitionProgress = previousImage
          ? evaluateWallpaperAnimationEasingAtTime(swapTransitionEasing, clampWallpaperMetric(card.transitionElapsedMs / Math.max(transitionDurationMs, 1), 0, 1))
          : 1
        const currentLayerStyle = resolveWallpaperFloatingCollageTransitionLayerStyle(transitionStyle, 'current', easedTransitionProgress)
        const previousLayerStyle = previousImage
          ? resolveWallpaperFloatingCollageTransitionLayerStyle(transitionStyle, 'previous', easedTransitionProgress)
          : null
        const cardLayers = (
          <>
            {previousImage && previousPreviewUrl ? (
              <div style={previousLayerStyle ?? undefined}>
                <ImagePreviewMedia
                  image={previousImage}
                  alt={t({ ko: '플로팅 콜라주', en: 'Floating collage' })}
                  loading="eager"
                  draggable={false}
                  className={mediaClassName}
                />
              </div>
            ) : null}

            {previewUrl ? (
              <div style={currentLayerStyle}>
                <ImagePreviewMedia
                  image={image}
                  alt={t({ ko: '플로팅 콜라주', en: 'Floating collage' })}
                  loading="eager"
                  draggable={false}
                  className={mediaClassName}
                />
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">{t({ ko: '이미지 없음', en: 'No image' })}</div>
            )}
          </>
        )

        if (mode === 'runtime' && onOpenImage && image) {
          return (
            <button
              key={card.key}
              type="button"
              className="absolute overflow-hidden rounded-2xl border border-white/15 bg-surface-high shadow-[0_18px_48px_rgba(0,0,0,0.30)] will-change-transform cursor-zoom-in"
              style={cardStyle}
              onClick={(event) => {
                event.stopPropagation()
                onOpenImage({
                  image,
                  alt: t({ ko: '플로팅 콜라주', en: 'Floating collage' }),
                  previewOpenScalePercent: widget.settings.imagePreviewOpenScalePercent,
                  previewOpenDurationMs: widget.settings.imagePreviewOpenDurationMs,
                  previewOpenEasing: widget.settings.imagePreviewOpenEasing,
                  previewCloseScalePercent: widget.settings.imagePreviewCloseScalePercent,
                  previewCloseDurationMs: widget.settings.imagePreviewCloseDurationMs,
                  previewCloseEasing: widget.settings.imagePreviewCloseEasing,
                })
              }}
            >
              {cardLayers}
            </button>
          )
        }

        return (
          <div
            key={card.key}
            className="absolute overflow-hidden rounded-2xl border border-white/15 bg-surface-high shadow-[0_18px_48px_rgba(0,0,0,0.30)] will-change-transform"
            style={cardStyle}
          >
            {cardLayers}
          </div>
        )
      })}

      {images.length > 0 ? <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,color-mix(in_srgb,var(--background)_22%,transparent))]" /> : null}
    </div>
  )
}
