import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { getImageListMediaKind, getImageListPreviewUrl } from '@/features/images/components/image-list/image-list-utils'
import { buildPreviewImageRecord } from '@/features/images/components/inline-media-preview'
import { parseMetadataValue } from '@/features/module-graph/module-graph-shared'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import {
  buildWallpaperImageTransitionTransform,
  resolveWallpaperImageTransitionFrame,
} from './wallpaper-image-transition-utils'
import type {
  WallpaperAnimationEasing,
  WallpaperImageHoverMotion,
  WallpaperImageTransitionSpeed,
  WallpaperImageTransitionStyle,
} from './wallpaper-types'
import {
  getWallpaperAnimationEasingCss,
  getWallpaperImageTransitionDurationMs,
  resolveWallpaperHoverMotionMetrics,
} from './wallpaper-widget-utils'

export interface WallpaperWidgetPreviewImage {
  image: ImageRecord
  alt: string
  previewOpenScalePercent?: number
  previewOpenDurationMs?: number
  previewOpenEasing?: WallpaperAnimationEasing
  previewCloseScalePercent?: number
  previewCloseDurationMs?: number
  previewCloseEasing?: WallpaperAnimationEasing
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
  transitionDurationMs?: number
  transitionEasing?: WallpaperAnimationEasing
  hoverMotion?: WallpaperImageHoverMotion
  hoverEasing?: WallpaperAnimationEasing
  previewOpenScalePercent?: number
  previewOpenDurationMs?: number
  previewOpenEasing?: WallpaperAnimationEasing
  previewCloseScalePercent?: number
  previewCloseDurationMs?: number
  previewCloseEasing?: WallpaperAnimationEasing
}

/** Build one preview record from artifact metadata for wallpaper image widgets. */
export function getWallpaperArtifactPreviewImage(src: string, alt: string, metadata?: string | null) {
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

function getWallpaperPreviewImageKey(previewImage: WallpaperWidgetPreviewImage) {
  return previewImage.image.thumbnail_url
    ?? previewImage.image.image_url
    ?? `${previewImage.alt}:${previewImage.image.mime_type ?? 'unknown'}`
}

/** Combine one existing transform string with one extra transform without dropping either side. */
function combineWallpaperTransforms(baseTransform: CSSProperties['transform'], extraTransform: string) {
  const resolvedBase = typeof baseTransform === 'string' ? baseTransform.trim() : ''
  return resolvedBase ? `${resolvedBase} ${extraTransform}` : extraTransform
}

function preloadWallpaperPreviewImage(previewImage: WallpaperWidgetPreviewImage) {
  const previewUrl = getImageListPreviewUrl(previewImage.image)
  if (!previewUrl) {
    return Promise.resolve()
  }

  const mediaKind = getImageListMediaKind(previewImage.image)
  if (mediaKind === 'video') {
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    const preloader = new window.Image()
    let finished = false

    const finish = () => {
      if (finished) {
        return
      }
      finished = true
      preloader.onload = null
      preloader.onerror = null
      resolve()
    }

    const finishAfterDecode = () => {
      if (typeof preloader.decode === 'function') {
        void preloader.decode()
          .catch(() => undefined)
          .finally(() => {
            finish()
          })
        return
      }

      finish()
    }

    preloader.onload = finishAfterDecode
    preloader.onerror = finish
    preloader.src = previewUrl

    if (preloader.complete) {
      finishAfterDecode()
    }
  })
}

function getWallpaperTransitionStateStyle(transitionStyle: WallpaperImageTransitionStyle, layer: 'current' | 'previous', isTransitionActive: boolean): CSSProperties {
  const frame = resolveWallpaperImageTransitionFrame(transitionStyle, layer, isTransitionActive ? 1 : 0)

  return {
    opacity: frame.opacity,
    transform: buildWallpaperImageTransitionTransform(frame),
    filter: `blur(${frame.blur}px)`,
    backfaceVisibility: 'hidden',
    transformStyle: 'preserve-3d',
  }
}

/** Render one optionally clickable wallpaper image surface. */
export function WallpaperPreviewImageSurface({ image, alt, className, imageClassName, style, imageStyle, children, onOpenImage, transitionStyle = 'none', transitionSpeed = 'normal', transitionDurationMs: explicitTransitionDurationMs, transitionEasing = 'easeOutCubic', hoverMotion = 1, hoverEasing = 'easeOutCubic', previewOpenScalePercent, previewOpenDurationMs, previewOpenEasing, previewCloseScalePercent, previewCloseDurationMs, previewCloseEasing }: WallpaperPreviewImageSurfaceProps) {
  const [currentImage, setCurrentImage] = useState<WallpaperWidgetPreviewImage>({ image, alt })
  const [previousImage, setPreviousImage] = useState<WallpaperWidgetPreviewImage | null>(null)
  const [isTransitionActive, setIsTransitionActive] = useState(true)
  const [isHovered, setIsHovered] = useState(false)
  const currentImageRef = useRef<WallpaperWidgetPreviewImage>({ image, alt })
  const transitionTimeoutRef = useRef<number | null>(null)
  const transitionFrameRef = useRef<number | null>(null)
  const transitionPaintFrameRef = useRef<number | null>(null)
  const transitionRequestRef = useRef(0)
  const transitionDurationMs = getWallpaperImageTransitionDurationMs(transitionSpeed, explicitTransitionDurationMs)
  const transitionTimingFunction = useMemo(() => getWallpaperAnimationEasingCss(transitionEasing), [transitionEasing])
  const hoverTimingFunction = useMemo(() => getWallpaperAnimationEasingCss(hoverEasing), [hoverEasing])
  const hoverMetrics = useMemo(() => resolveWallpaperHoverMotionMetrics(hoverMotion), [hoverMotion])

  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current !== null) {
        window.clearTimeout(transitionTimeoutRef.current)
      }
      if (transitionFrameRef.current !== null) {
        window.cancelAnimationFrame(transitionFrameRef.current)
      }
      if (transitionPaintFrameRef.current !== null) {
        window.cancelAnimationFrame(transitionPaintFrameRef.current)
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
    if (transitionFrameRef.current !== null) {
      window.cancelAnimationFrame(transitionFrameRef.current)
      transitionFrameRef.current = null
    }
    if (transitionPaintFrameRef.current !== null) {
      window.cancelAnimationFrame(transitionPaintFrameRef.current)
      transitionPaintFrameRef.current = null
    }

    const requestId = transitionRequestRef.current + 1
    transitionRequestRef.current = requestId
    let cancelled = false

    const commitTransition = () => {
      if (cancelled || transitionRequestRef.current !== requestId) {
        return
      }

      currentImageRef.current = nextImage

      flushSync(() => {
        setCurrentImage(nextImage)

        if (transitionStyle === 'none') {
          setPreviousImage(null)
          setIsTransitionActive(true)
          return
        }

        setPreviousImage(activeImage)
        setIsTransitionActive(false)
      })

      if (transitionStyle === 'none') {
        return
      }

      transitionFrameRef.current = window.requestAnimationFrame(() => {
        transitionFrameRef.current = null
        transitionPaintFrameRef.current = window.requestAnimationFrame(() => {
          transitionPaintFrameRef.current = null
          if (cancelled || transitionRequestRef.current !== requestId) {
            return
          }
          flushSync(() => {
            setIsTransitionActive(true)
          })
        })
      })
      transitionTimeoutRef.current = window.setTimeout(() => {
        if (cancelled || transitionRequestRef.current !== requestId) {
          return
        }
        flushSync(() => {
          setPreviousImage(null)
          setIsTransitionActive(true)
        })
        transitionTimeoutRef.current = null
      }, transitionDurationMs)
    }

    void preloadWallpaperPreviewImage(nextImage).then(() => {
      commitTransition()
    })

    return () => {
      cancelled = true
    }
  }, [alt, image, transitionDurationMs, transitionStyle])

  const baseSurfaceZIndex = typeof style?.zIndex === 'number'
    ? style.zIndex
    : typeof style?.zIndex === 'string'
      ? Number(style.zIndex)
      : null
  const raisedSurfaceZIndex = Number.isFinite(baseSurfaceZIndex) ? Number(baseSurfaceZIndex) + 1000 : 1000
  const imageLayerStyle = {
    transitionProperty: 'opacity, transform, filter',
    transitionDuration: `${transitionDurationMs}ms`,
    transitionTimingFunction,
    ...imageStyle,
  }
  const imageLayerWrapperStyle = onOpenImage
    ? {
        transform: isHovered ? `scale(${hoverMetrics.imageScale})` : 'scale(1)',
        transitionProperty: 'transform',
        transitionDuration: '220ms',
        transitionTimingFunction: hoverTimingFunction,
      }
    : undefined
  const surfaceStyle = {
    ...style,
    ...(onOpenImage
      ? {
          transform: isHovered
            ? combineWallpaperTransforms(style?.transform, `scale(${hoverMetrics.surfaceScale})`)
            : style?.transform,
          boxShadow: isHovered ? hoverMetrics.surfaceShadow : style?.boxShadow,
          transitionTimingFunction: isHovered ? hoverTimingFunction : style?.transitionTimingFunction,
        }
      : null),
    zIndex: isHovered ? raisedSurfaceZIndex : style?.zIndex,
  }

  const imageLayers = (
    <div className="absolute inset-0 will-change-transform" style={imageLayerWrapperStyle}>
      {previousImage ? (
        <ImagePreviewMedia
          key={`previous:${getWallpaperPreviewImageKey(previousImage)}`}
          image={previousImage.image}
          alt={previousImage.alt}
          className={cn(
            'absolute inset-0 h-full w-full will-change-transform',
            imageClassName,
          )}
          style={{
            ...imageLayerStyle,
            ...getWallpaperTransitionStateStyle(transitionStyle, 'previous', isTransitionActive),
          }}
          loading="eager"
          draggable={false}
        />
      ) : null}
      <ImagePreviewMedia
        key={`current:${getWallpaperPreviewImageKey(currentImage)}`}
        image={currentImage.image}
        alt={currentImage.alt}
        className={cn(
          'absolute inset-0 h-full w-full will-change-transform',
          imageClassName,
        )}
        style={{
          ...imageLayerStyle,
          ...getWallpaperTransitionStateStyle(transitionStyle, 'current', isTransitionActive),
        }}
        loading="eager"
        draggable={false}
      />
    </div>
  )

  if (!onOpenImage) {
    return (
      <div
        className={cn(className, 'relative isolate')}
        style={surfaceStyle}
        onPointerEnter={() => {
          setIsHovered(true)
        }}
        onPointerLeave={() => {
          setIsHovered(false)
        }}
      >
        {imageLayers}
        {children}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={cn(className, 'relative isolate block w-full cursor-zoom-in transform-gpu transition-[transform,box-shadow] duration-200 ease-out')}
      style={surfaceStyle}
      onClick={(event) => {
        event.stopPropagation()
        onOpenImage({
          image: currentImage.image,
          alt: currentImage.alt,
          previewOpenScalePercent,
          previewOpenDurationMs,
          previewOpenEasing,
          previewCloseScalePercent,
          previewCloseDurationMs,
          previewCloseEasing,
        })
      }}
      onPointerEnter={() => {
        setIsHovered(true)
      }}
      onPointerLeave={() => {
        setIsHovered(false)
      }}
    >
      {imageLayers}
      {children}
    </button>
  )
}
