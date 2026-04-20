import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { getImageListPreviewUrl } from '@/features/images/components/image-list/image-list-utils'
import { cn } from '@/lib/utils'
import {
  buildWallpaperImageTransitionTransform,
  resolveWallpaperImageTransitionFrame,
} from './wallpaper-image-transition-utils'
import type { WallpaperImageTransitionStyle, WallpaperWidgetInstance } from './wallpaper-types'
import { useWallpaperGroupPreviewImagesQuery } from './wallpaper-widget-data'
import { type WallpaperWidgetPreviewImage } from './wallpaper-widget-preview-surface'
import {
  evaluateWallpaperAnimationEasingAtTime,
  getWallpaperAnimationEasingCss,
  getWallpaperImageTransitionDurationMs,
  getWallpaperMotionStrengthMultiplier,
} from './wallpaper-widget-utils'

const WALLPAPER_FLOATING_COLLAGE_SLOT_ASPECTS = [0.78, 1.08, 0.86, 1.18, 0.92, 1.28]
const WALLPAPER_FLOATING_COLLAGE_SPAWN_HOLD_MS = 900
const WALLPAPER_FLOATING_COLLAGE_SPAWN_BLEND_MS = 1100

interface WallpaperFloatingCollageSeed {
  widthPercent: number
  rotationBase: number
  depth: number
  aspectRatio: number
  velocityAngle: number
  speedRatio: number
  wobblePhase: number
}

interface WallpaperFloatingCollageCardGeometry {
  width: number
  height: number
}

interface WallpaperFloatingCollageBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface WallpaperFloatingCollageCardState {
  key: string
  slotWidthPercent: number
  x: number
  y: number
  width: number
  height: number
  vx: number
  vy: number
  rotationBase: number
  depth: number
  aspectRatio: number
  wobblePhase: number
  imageIndex: number
  previousImageIndex: number | null
  transitionElapsedMs: number
  bounceCount: number
  elapsedSinceSwapMs: number
}

function getWallpaperFloatingCollageImageKey(image: { composite_hash?: string | null; id?: number | string | null; original_file_path?: string | null; image_url?: string | null; thumbnail_url?: string | null } | null | undefined) {
  if (!image) {
    return ''
  }

  return String(
    image.composite_hash
      ?? image.id
      ?? image.original_file_path
      ?? image.image_url
      ?? image.thumbnail_url
      ?? '',
  )
}

function decrementWallpaperFloatingCollageImageUsage(usageByKey: Map<string, number>, imageKey: string) {
  if (!imageKey) {
    return
  }

  const nextCount = (usageByKey.get(imageKey) ?? 0) - 1
  if (nextCount > 0) {
    usageByKey.set(imageKey, nextCount)
    return
  }

  usageByKey.delete(imageKey)
}

function incrementWallpaperFloatingCollageImageUsage(usageByKey: Map<string, number>, imageKey: string) {
  if (!imageKey) {
    return
  }

  usageByKey.set(imageKey, (usageByKey.get(imageKey) ?? 0) + 1)
}

function resolveNextWallpaperFloatingCollageImageIndex(
  currentIndex: number,
  images: Array<{ composite_hash?: string | null; id?: number | string | null; original_file_path?: string | null; image_url?: string | null; thumbnail_url?: string | null }>,
  usedImageKeys: Map<string, number>,
) {
  if (images.length <= 1) {
    return currentIndex
  }

  const currentKey = getWallpaperFloatingCollageImageKey(images[currentIndex] ?? null)
  let fallbackIndex = currentIndex

  for (let offset = 1; offset <= images.length; offset += 1) {
    const candidateIndex = (currentIndex + offset) % images.length
    const candidateKey = getWallpaperFloatingCollageImageKey(images[candidateIndex] ?? null)

    if (!candidateKey || candidateKey === currentKey) {
      continue
    }

    if (fallbackIndex === currentIndex) {
      fallbackIndex = candidateIndex
    }

    if (!usedImageKeys.has(candidateKey)) {
      return candidateIndex
    }
  }

  return fallbackIndex
}

/** Clamp one numeric value into an inclusive range. */
function clampWallpaperMetric(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/** Normalize the collage motion speed from settings. */
function clampWallpaperFloatingCollageSpeed(value: number | undefined) {
  return clampWallpaperMetric(typeof value === 'number' && Number.isFinite(value) ? value : 1, 0.2, 20)
}

/** Normalize the collage time-based swap interval. */
function clampWallpaperFloatingCollageSwapIntervalSec(value: number | undefined) {
  return Math.round(clampWallpaperMetric(typeof value === 'number' && Number.isFinite(value) ? value : 12, 2, 60))
}

/** Normalize the collage bounce-based swap threshold. */
function clampWallpaperFloatingCollageSwapBounceCount(value: number | undefined) {
  return Math.round(clampWallpaperMetric(typeof value === 'number' && Number.isFinite(value) ? value : 3, 1, 12))
}

/** Resolve the effective image scale for collage cards. */
function clampWallpaperFloatingCollageScalePercent(value: number | undefined) {
  return clampWallpaperMetric(typeof value === 'number' && Number.isFinite(value) ? value : 100, 50, 200)
}

function clampWallpaperFloatingCollageTransitionDurationMs(value: number | undefined) {
  return getWallpaperImageTransitionDurationMs(undefined, value)
}

function resolveWallpaperFloatingCollageTransitionLayerStyle(
  transitionStyle: WallpaperImageTransitionStyle,
  layer: 'current' | 'previous',
  progress: number,
): CSSProperties {
  const frame = resolveWallpaperImageTransitionFrame(transitionStyle, layer, clampWallpaperMetric(progress, 0, 1))

  return {
    position: 'absolute',
    inset: 0,
    opacity: frame.opacity,
    transform: buildWallpaperImageTransitionTransform(frame),
    filter: `blur(${frame.blur}px)`,
    backfaceVisibility: 'hidden',
    transformStyle: 'preserve-3d',
    willChange: 'transform, opacity, filter',
    pointerEvents: 'none',
  }
}

/** Prefer the real image aspect ratio when the widget is configured to use it. */
function resolveWallpaperFloatingCollageAspectRatio(
  image: { width?: number | null; height?: number | null } | null | undefined,
  fallback: number,
) {
  return typeof image?.width === 'number' && image.width > 0 && typeof image?.height === 'number' && image.height > 0
    ? clampWallpaperMetric(image.width / image.height, 0.58, 1.9)
    : fallback
}

/** Preload one image URL so the first visible collage frame can appear in one batch. */
function preloadWallpaperFloatingCollageImage(url: string) {
  return new Promise<void>((resolve) => {
    const image = new window.Image()
    const finish = () => {
      image.onload = null
      image.onerror = null
      resolve()
    }

    image.onload = finish
    image.onerror = finish
    image.src = url

    if (image.complete) {
      finish()
    }
  })
}

/** Build one small deterministic seed set for the initial collage placement. */
function buildWallpaperFloatingCollageSeeds(visibleCount: number) {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))

  return Array.from({ length: visibleCount }, (_, index) => {
    const angle = (-Math.PI / 2) + (index * goldenAngle)
    const wobbleOffset = index % 2 === 0 ? -0.16 : 0.16
    const seededAngle = angle + wobbleOffset
    const velocityJitter = (index % 3 === 0 ? 0.28 : index % 3 === 1 ? -0.34 : 0.18)
    const widthPercent = clampWallpaperMetric(24 - ((index % 3) * 1.9), 20, 26)

    return {
      widthPercent,
      rotationBase: (Math.sin(seededAngle * 1.4) * 7) + ((index % 2 === 0 ? -1 : 1) * 2.2),
      depth: (index % 3) + 1,
      aspectRatio: WALLPAPER_FLOATING_COLLAGE_SLOT_ASPECTS[index % WALLPAPER_FLOATING_COLLAGE_SLOT_ASPECTS.length],
      velocityAngle: seededAngle + velocityJitter,
      speedRatio: 0.9 + ((index % 4) * 0.12),
      wobblePhase: index * 0.85,
    } satisfies WallpaperFloatingCollageSeed
  })
}

/** Build one real card size from the container, aspect ratio, and width percentage. */
function resolveWallpaperFloatingCollageCardGeometry(
  widthPercent: number,
  aspectRatio: number,
  containerWidth: number,
  containerHeight: number,
  imageScalePercent: number,
): WallpaperFloatingCollageCardGeometry {
  const safeAspectRatio = clampWallpaperMetric(aspectRatio, 0.58, 1.9)
  const targetWidth = (containerWidth * widthPercent * imageScalePercent) / 10_000
  const maxWidthByHeight = containerHeight * safeAspectRatio * 0.72
  const maxWidthByContainer = containerWidth * 0.52
  const width = clampWallpaperMetric(Math.min(targetWidth, maxWidthByHeight, maxWidthByContainer), 44, maxWidthByContainer)
  const height = width / safeAspectRatio

  return {
    width,
    height,
  }
}

/** Resolve the animated collage transform from the current card position. */
function resolveWallpaperFloatingCollageVisualMotion(card: Pick<WallpaperFloatingCollageCardState, 'x' | 'y' | 'width' | 'height' | 'rotationBase' | 'depth' | 'wobblePhase'>, motionStrength: number) {
  const wobblePhase = ((card.x + (card.width / 2)) * 0.018) + ((card.y + (card.height / 2)) * 0.014) + card.wobblePhase
  const scale = 1.01 + ((Math.sin(wobblePhase) + 1) * 0.012 * motionStrength)
  const rotate = card.rotationBase + (Math.sin(wobblePhase * 0.9) * (2.6 + card.depth) * motionStrength)

  return {
    wobblePhase,
    scale,
    rotate,
  }
}

/** Approximate the visible rotated/scaled card box so collision uses what the user actually sees. */
function resolveWallpaperFloatingCollageVisualMargins(width: number, height: number, rotateDeg: number, scale: number) {
  const radians = Math.abs(rotateDeg) * (Math.PI / 180)
  const scaledWidth = width * scale
  const scaledHeight = height * scale
  const visualWidth = (Math.abs(Math.cos(radians)) * scaledWidth) + (Math.abs(Math.sin(radians)) * scaledHeight)
  const visualHeight = (Math.abs(Math.sin(radians)) * scaledWidth) + (Math.abs(Math.cos(radians)) * scaledHeight)

  return {
    marginX: Math.max(0, (visualWidth - width) / 2),
    marginY: Math.max(0, (visualHeight - height) / 2),
  }
}

/** Build the legal top-left bounds for one card inside the measured widget area. */
function resolveWallpaperFloatingCollageBounds(
  containerWidth: number,
  containerHeight: number,
  cardWidth: number,
  cardHeight: number,
  visualMarginX = 0,
  visualMarginY = 0,
): WallpaperFloatingCollageBounds {
  const padding = clampWallpaperMetric(Math.round(Math.min(containerWidth, containerHeight) * 0.03), 8, 18)
  const minX = padding + visualMarginX
  const minY = padding + visualMarginY
  const maxX = Math.max(minX, containerWidth - cardWidth - padding - visualMarginX)
  const maxY = Math.max(minY, containerHeight - cardHeight - padding - visualMarginY)

  return {
    minX,
    minY,
    maxX,
    maxY,
  }
}

/** Resolve one card bounds using the same visual-motion envelope as runtime rendering. */
function resolveWallpaperFloatingCollageVisualBounds(
  card: Pick<WallpaperFloatingCollageCardState, 'x' | 'y' | 'width' | 'height' | 'rotationBase' | 'depth' | 'wobblePhase'>,
  containerWidth: number,
  containerHeight: number,
  motionStrength: number,
) {
  const motion = resolveWallpaperFloatingCollageVisualMotion(card, motionStrength)
  const visualMargins = resolveWallpaperFloatingCollageVisualMargins(card.width, card.height, motion.rotate, motion.scale)

  return resolveWallpaperFloatingCollageBounds(
    containerWidth,
    containerHeight,
    card.width,
    card.height,
    visualMargins.marginX,
    visualMargins.marginY,
  )
}

/** Resolve one spawn interpolation progress value from the current anchor state. */
function resolveWallpaperFloatingCollageSpawnProgress(
  spawnAnchor: { holdUntil: number; blendUntil: number; active: boolean },
  now: number,
) {
  if (!spawnAnchor.active) {
    return 1
  }

  if (now <= spawnAnchor.holdUntil) {
    return 0
  }

  return Math.min(1, Math.max(0, (now - spawnAnchor.holdUntil) / Math.max(1, spawnAnchor.blendUntil - spawnAnchor.holdUntil)))
}

/** Clamp one top-left card position so the entire card stays inside the widget area. */
function clampWallpaperFloatingCollagePosition(x: number, y: number, bounds: WallpaperFloatingCollageBounds) {
  return {
    x: clampWallpaperMetric(x, bounds.minX, bounds.maxX),
    y: clampWallpaperMetric(y, bounds.minY, bounds.maxY),
  }
}

/** Derive one stable motion speed from the measured widget size and widget settings. */
function resolveWallpaperFloatingCollageVelocity(seed: WallpaperFloatingCollageSeed, motionStrength: number, motionSpeed: number, containerWidth: number, containerHeight: number) {
  const baseSpeed = clampWallpaperMetric(Math.min(containerWidth, containerHeight) * 0.2, 38, 180)
  const speed = baseSpeed * motionStrength * clampWallpaperFloatingCollageSpeed(motionSpeed) * seed.speedRatio

  return {
    vx: Math.cos(seed.velocityAngle) * speed,
    vy: Math.sin(seed.velocityAngle) * speed,
  }
}

/** Resize one existing card around its visual center while keeping it inside bounds. */
function resizeWallpaperFloatingCollageCard(
  card: WallpaperFloatingCollageCardState,
  geometry: WallpaperFloatingCollageCardGeometry,
  containerWidth: number,
  containerHeight: number,
  motionStrength: number,
) {
  const centerX = card.x + (card.width / 2)
  const centerY = card.y + (card.height / 2)
  const bounds = resolveWallpaperFloatingCollageVisualBounds({
    x: centerX - (geometry.width / 2),
    y: centerY - (geometry.height / 2),
    width: geometry.width,
    height: geometry.height,
    rotationBase: card.rotationBase,
    depth: card.depth,
    wobblePhase: card.wobblePhase,
  }, containerWidth, containerHeight, motionStrength)
  const nextPosition = clampWallpaperFloatingCollagePosition(
    centerX - (geometry.width / 2),
    centerY - (geometry.height / 2),
    bounds,
  )

  return {
    x: nextPosition.x,
    y: nextPosition.y,
    width: geometry.width,
    height: geometry.height,
  }
}

/** Convert one seed into one live bounded collage card. */
function buildWallpaperFloatingCollageCardState(
  seed: WallpaperFloatingCollageSeed,
  index: number,
  images: Array<{ width?: number | null; height?: number | null }>,
  motionStrength: number,
  motionSpeed: number,
  containerWidth: number,
  containerHeight: number,
  aspectMode: 'slot' | 'image',
  imageScalePercent: number,
): WallpaperFloatingCollageCardState {
  const imageIndex = index % images.length
  const aspectRatio = aspectMode === 'image'
    ? resolveWallpaperFloatingCollageAspectRatio(images[imageIndex], seed.aspectRatio)
    : seed.aspectRatio
  const geometry = resolveWallpaperFloatingCollageCardGeometry(seed.widthPercent, aspectRatio, containerWidth, containerHeight, imageScalePercent)
  const centeredX = containerWidth / 2
  const centeredY = containerHeight / 2
  const initialMotion = resolveWallpaperFloatingCollageVisualMotion({
    x: centeredX - (geometry.width / 2),
    y: centeredY - (geometry.height / 2),
    width: geometry.width,
    height: geometry.height,
    rotationBase: seed.rotationBase,
    depth: seed.depth,
    wobblePhase: seed.wobblePhase,
  }, motionStrength)
  const visualMargins = resolveWallpaperFloatingCollageVisualMargins(geometry.width, geometry.height, initialMotion.rotate, initialMotion.scale)
  const bounds = resolveWallpaperFloatingCollageBounds(containerWidth, containerHeight, geometry.width, geometry.height, visualMargins.marginX, visualMargins.marginY)
  const position = clampWallpaperFloatingCollagePosition(
    centeredX - (geometry.width / 2),
    centeredY - (geometry.height / 2),
    bounds,
  )
  const velocity = resolveWallpaperFloatingCollageVelocity(seed, motionStrength, motionSpeed, containerWidth, containerHeight)

  return {
    key: `floating-collage-card-${index}`,
    slotWidthPercent: seed.widthPercent,
    x: position.x,
    y: position.y,
    width: geometry.width,
    height: geometry.height,
    vx: position.x <= bounds.minX + 1 ? Math.abs(velocity.vx) : position.x >= bounds.maxX - 1 ? -Math.abs(velocity.vx) : velocity.vx,
    vy: position.y <= bounds.minY + 1 ? Math.abs(velocity.vy) : position.y >= bounds.maxY - 1 ? -Math.abs(velocity.vy) : velocity.vy,
    rotationBase: seed.rotationBase,
    depth: seed.depth,
    aspectRatio,
    wobblePhase: seed.wobblePhase,
    imageIndex,
    previousImageIndex: null,
    transitionElapsedMs: 0,
    bounceCount: 0,
    elapsedSinceSwapMs: 0,
  }
}

/** Build the full bounded collage card set from the current widget inputs. */
function buildWallpaperFloatingCollageCardStates(
  seeds: WallpaperFloatingCollageSeed[],
  images: Array<{ width?: number | null; height?: number | null }>,
  motionStrength: number,
  motionSpeed: number,
  containerWidth: number,
  containerHeight: number,
  aspectMode: 'slot' | 'image',
  imageScalePercent: number,
) {
  if (images.length === 0 || containerWidth <= 0 || containerHeight <= 0) {
    return [] as WallpaperFloatingCollageCardState[]
  }

  const initialCards = seeds.map((seed, index) => (
    buildWallpaperFloatingCollageCardState(
      seed,
      index,
      images,
      motionStrength,
      motionSpeed,
      containerWidth,
      containerHeight,
      aspectMode,
      imageScalePercent,
    )
  ))

  const perCardBounds = initialCards.map((card) => (
    resolveWallpaperFloatingCollageVisualBounds(card, containerWidth, containerHeight, motionStrength)
  ))

  const sharedMinX = Math.max(...perCardBounds.map((bounds) => bounds.minX))
  const sharedMinY = Math.max(...perCardBounds.map((bounds) => bounds.minY))
  const sharedMaxX = Math.max(sharedMinX, Math.min(...perCardBounds.map((bounds) => bounds.maxX)))
  const sharedMaxY = Math.max(sharedMinY, Math.min(...perCardBounds.map((bounds) => bounds.maxY)))
  const largestWidth = Math.max(...initialCards.map((card) => card.width))
  const largestHeight = Math.max(...initialCards.map((card) => card.height))
  const sharedStartX = clampWallpaperMetric((containerWidth - largestWidth) / 2, sharedMinX, sharedMaxX)
  const sharedStartY = clampWallpaperMetric((containerHeight - largestHeight) / 2, sharedMinY, sharedMaxY)

  return initialCards.map((card, index) => {
    const bounds = perCardBounds[index]

    return {
      ...card,
      x: sharedStartX,
      y: sharedStartY,
      vx: sharedStartX <= bounds.minX + 1 ? Math.abs(card.vx) : sharedStartX >= bounds.maxX - 1 ? -Math.abs(card.vx) : card.vx,
      vy: sharedStartY <= bounds.minY + 1 ? Math.abs(card.vy) : sharedStartY >= bounds.maxY - 1 ? -Math.abs(card.vy) : card.vy,
    }
  })
}

/** Render one layered floating collage that always stays inside the widget area. */
export function WallpaperFloatingCollageBody({ widget, mode, onOpenImage }: { widget: Extract<WallpaperWidgetInstance, { type: 'floating-collage' }>; mode: 'editor' | 'runtime'; onOpenImage?: (image: WallpaperWidgetPreviewImage) => void }) {
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
  }, [aspectMode, cardStates.length, containerSize.height, containerSize.width, imageScalePercent, imageSwapMode, images, swapBounceCount, swapIntervalSec, transitionDurationMs])

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
      {images.length === 0 ? (
        <div className="flex h-full items-center justify-center px-3 text-center text-sm text-muted-foreground">표시할 콜라주 이미지가 없어.</div>
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
                  alt="플로팅 콜라주"
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
                  alt="플로팅 콜라주"
                  loading="eager"
                  draggable={false}
                  className={mediaClassName}
                />
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">이미지 없음</div>
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
                  alt: '플로팅 콜라주',
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
