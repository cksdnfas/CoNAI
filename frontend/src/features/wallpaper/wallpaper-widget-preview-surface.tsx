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
  getWallpaperHoverMotionAmount,
} from './wallpaper-widget-utils'

const WALLPAPER_IMAGE_TRANSITION_DURATIONS: Record<WallpaperImageTransitionSpeed, number> = {
  fast: 220,
  normal: 340,
  slow: 520,
}

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
  transitionEasing?: WallpaperAnimationEasing
  hoverMotion?: WallpaperImageHoverMotion
  hoverEasing?: WallpaperAnimationEasing
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

function resolveWallpaperHoverMotionMetrics(hoverMotion: WallpaperImageHoverMotion) {
  const intensity = getWallpaperHoverMotionAmount(hoverMotion)

  return {
    intensity,
    surfaceScale: 1 + (intensity * 0.018),
    imageScale: 1 + (intensity * 0.03),
    surfaceShadow: intensity <= 0
      ? 'none'
      : `0 ${Math.round(10 + intensity * 7)}px ${Math.round(26 + intensity * 18)}px rgba(0,0,0,${(0.14 + intensity * 0.07).toFixed(3)})`,
  }
}

/** Render one optionally clickable wallpaper image surface. */
export function WallpaperPreviewImageSurface({ image, alt, className, imageClassName, style, imageStyle, children, onOpenImage, transitionStyle = 'none', transitionSpeed = 'normal', transitionEasing = 'easeOutCubic', hoverMotion = 1, hoverEasing = 'easeOutCubic' }: WallpaperPreviewImageSurfaceProps) {
  const [currentImage, setCurrentImage] = useState<WallpaperWidgetPreviewImage>({ image, alt })
  const [previousImage, setPreviousImage] = useState<WallpaperWidgetPreviewImage | null>(null)
  const [isTransitionActive, setIsTransitionActive] = useState(true)
  const [isHovered, setIsHovered] = useState(false)
  const currentImageRef = useRef<WallpaperWidgetPreviewImage>({ image, alt })
  const transitionTimeoutRef = useRef<number | null>(null)
  const transitionDurationMs = WALLPAPER_IMAGE_TRANSITION_DURATIONS[transitionSpeed]
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
  const surfaceStyle = onOpenImage
    ? {
        ...style,
        transform: isHovered ? `scale(${hoverMetrics.surfaceScale})` : 'scale(1)',
        boxShadow: isHovered ? hoverMetrics.surfaceShadow : 'none',
        transitionTimingFunction: hoverTimingFunction,
      }
    : style

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
      <div className={cn(className, 'relative isolate')} style={style}>
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
        onOpenImage({ image: currentImage.image, alt: currentImage.alt })
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
