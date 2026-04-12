import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { buildPreviewImageRecord } from '@/features/images/components/inline-media-preview'
import { parseMetadataValue } from '@/features/module-graph/module-graph-shared'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
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

  if (transitionStyle === 'zoom') {
    if (layer === 'current') {
      return isTransitionActive ? 'opacity-100 scale-100 translate-y-0 blur-0' : 'opacity-0 scale-[1.14] translate-y-0 blur-[2px]'
    }
    return isTransitionActive ? 'opacity-0 scale-[0.86] translate-y-0 blur-[3px]' : 'opacity-100 scale-100 translate-y-0 blur-0'
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

/** Render one optionally clickable wallpaper image surface. */
export function WallpaperPreviewImageSurface({ image, alt, className, imageClassName, style, imageStyle, children, onOpenImage, transitionStyle = 'none', transitionSpeed = 'normal', transitionDurationMs: explicitTransitionDurationMs, transitionEasing = 'easeOutCubic', hoverMotion = 1, hoverEasing = 'easeOutCubic', previewOpenScalePercent, previewOpenDurationMs, previewOpenEasing, previewCloseScalePercent, previewCloseDurationMs, previewCloseEasing }: WallpaperPreviewImageSurfaceProps) {
  const [currentImage, setCurrentImage] = useState<WallpaperWidgetPreviewImage>({ image, alt })
  const [previousImage, setPreviousImage] = useState<WallpaperWidgetPreviewImage | null>(null)
  const [isTransitionActive, setIsTransitionActive] = useState(true)
  const [isHovered, setIsHovered] = useState(false)
  const currentImageRef = useRef<WallpaperWidgetPreviewImage>({ image, alt })
  const transitionTimeoutRef = useRef<number | null>(null)
  const transitionDurationMs = getWallpaperImageTransitionDurationMs(transitionSpeed, explicitTransitionDurationMs)
  const transitionTimingFunction = useMemo(() => getWallpaperAnimationEasingCss(transitionEasing), [transitionEasing])
  const hoverTimingFunction = useMemo(() => getWallpaperAnimationEasingCss(hoverEasing), [hoverEasing])
  const hoverMetrics = useMemo(() => resolveWallpaperHoverMotionMetrics(hoverMotion), [hoverMotion])

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

  const baseSurfaceZIndex = typeof style?.zIndex === 'number'
    ? style.zIndex
    : typeof style?.zIndex === 'string'
      ? Number(style.zIndex)
      : null
  const raisedSurfaceZIndex = Number.isFinite(baseSurfaceZIndex) ? Number(baseSurfaceZIndex) + 1000 : 1000
  const imageLayerStyle = {
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
          transform: isHovered ? `scale(${hoverMetrics.surfaceScale})` : 'scale(1)',
          boxShadow: isHovered ? hoverMetrics.surfaceShadow : 'none',
          transitionTimingFunction: hoverTimingFunction,
        }
      : null),
    zIndex: isHovered ? raisedSurfaceZIndex : style?.zIndex,
  }

  const imageLayers = (
    <div className="absolute inset-0 will-change-transform" style={imageLayerWrapperStyle}>
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
          getWallpaperTransitionStateClassName(transitionStyle, 'current', isTransitionActive),
        )}
        style={imageLayerStyle}
        loading="lazy"
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
