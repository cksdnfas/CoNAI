import type { CSSProperties } from 'react'
import {
  buildWallpaperImageTransitionTransform,
  resolveWallpaperImageTransitionFrame,
} from './wallpaper-image-transition-utils'
import type { WallpaperImageTransitionStyle } from './wallpaper-types'
import { getWallpaperImageTransitionDurationMs } from './wallpaper-widget-utils'

const WALLPAPER_FLOATING_COLLAGE_SLOT_ASPECTS = [0.78, 1.08, 0.86, 1.18, 0.92, 1.28]
export interface WallpaperFloatingCollageSeed {
  widthPercent: number
  rotationBase: number
  depth: number
  aspectRatio: number
  velocityAngle: number
  speedRatio: number
  wobblePhase: number
}

export interface WallpaperFloatingCollageCardGeometry {
  width: number
  height: number
}

export interface WallpaperFloatingCollageBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface WallpaperFloatingCollageCardState {
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

export function getWallpaperFloatingCollageImageKey(image: { composite_hash?: string | null; id?: number | string | null; original_file_path?: string | null; image_url?: string | null; thumbnail_url?: string | null } | null | undefined) {
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

export function decrementWallpaperFloatingCollageImageUsage(usageByKey: Map<string, number>, imageKey: string) {
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

export function incrementWallpaperFloatingCollageImageUsage(usageByKey: Map<string, number>, imageKey: string) {
  if (!imageKey) {
    return
  }

  usageByKey.set(imageKey, (usageByKey.get(imageKey) ?? 0) + 1)
}

export function resolveNextWallpaperFloatingCollageImageIndex(
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
export function clampWallpaperMetric(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/** Normalize the collage motion speed from settings. */
export function clampWallpaperFloatingCollageSpeed(value: number | undefined) {
  return clampWallpaperMetric(typeof value === 'number' && Number.isFinite(value) ? value : 1, 0.2, 20)
}

/** Normalize the collage time-based swap interval. */
export function clampWallpaperFloatingCollageSwapIntervalSec(value: number | undefined) {
  return Math.round(clampWallpaperMetric(typeof value === 'number' && Number.isFinite(value) ? value : 12, 2, 60))
}

/** Normalize the collage bounce-based swap threshold. */
export function clampWallpaperFloatingCollageSwapBounceCount(value: number | undefined) {
  return Math.round(clampWallpaperMetric(typeof value === 'number' && Number.isFinite(value) ? value : 3, 1, 12))
}

/** Resolve the effective image scale for collage cards. */
export function clampWallpaperFloatingCollageScalePercent(value: number | undefined) {
  return clampWallpaperMetric(typeof value === 'number' && Number.isFinite(value) ? value : 100, 50, 200)
}

export function clampWallpaperFloatingCollageTransitionDurationMs(value: number | undefined) {
  return getWallpaperImageTransitionDurationMs(undefined, value)
}

export function resolveWallpaperFloatingCollageTransitionLayerStyle(
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
export function resolveWallpaperFloatingCollageAspectRatio(
  image: { width?: number | null; height?: number | null } | null | undefined,
  fallback: number,
) {
  return typeof image?.width === 'number' && image.width > 0 && typeof image?.height === 'number' && image.height > 0
    ? clampWallpaperMetric(image.width / image.height, 0.58, 1.9)
    : fallback
}

/** Preload one image URL so the first visible collage frame can appear in one batch. */
export function preloadWallpaperFloatingCollageImage(url: string) {
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
export function buildWallpaperFloatingCollageSeeds(visibleCount: number) {
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
export function resolveWallpaperFloatingCollageCardGeometry(
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
export function resolveWallpaperFloatingCollageVisualMotion(card: Pick<WallpaperFloatingCollageCardState, 'x' | 'y' | 'width' | 'height' | 'rotationBase' | 'depth' | 'wobblePhase'>, motionStrength: number) {
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
export function resolveWallpaperFloatingCollageVisualMargins(width: number, height: number, rotateDeg: number, scale: number) {
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
export function resolveWallpaperFloatingCollageBounds(
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
export function resolveWallpaperFloatingCollageVisualBounds(
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
export function resolveWallpaperFloatingCollageSpawnProgress(
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
export function clampWallpaperFloatingCollagePosition(x: number, y: number, bounds: WallpaperFloatingCollageBounds) {
  return {
    x: clampWallpaperMetric(x, bounds.minX, bounds.maxX),
    y: clampWallpaperMetric(y, bounds.minY, bounds.maxY),
  }
}

/** Derive one stable motion speed from the measured widget size and widget settings. */
export function resolveWallpaperFloatingCollageVelocity(seed: WallpaperFloatingCollageSeed, motionStrength: number, motionSpeed: number, containerWidth: number, containerHeight: number) {
  const baseSpeed = clampWallpaperMetric(Math.min(containerWidth, containerHeight) * 0.2, 38, 180)
  const speed = baseSpeed * motionStrength * clampWallpaperFloatingCollageSpeed(motionSpeed) * seed.speedRatio

  return {
    vx: Math.cos(seed.velocityAngle) * speed,
    vy: Math.sin(seed.velocityAngle) * speed,
  }
}

/** Resize one existing card around its visual center while keeping it inside bounds. */
export function resizeWallpaperFloatingCollageCard(
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
export function buildWallpaperFloatingCollageCardState(
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
export function buildWallpaperFloatingCollageCardStates(
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
