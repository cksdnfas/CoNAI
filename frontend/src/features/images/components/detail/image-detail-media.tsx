import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent as ReactSyntheticEvent } from 'react'
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
  type ImageDetailRenderMode,
} from './image-detail-utils'
import { EnhancedVideoPlayer } from './enhanced-video-player'
import { ImageDetailMediaFrame } from './image-detail-media-frame'
import { ImageDetailMediaToolbar } from './image-detail-media-toolbar'
import { createPixelPreviewWorkerTask } from './image-detail-pixel-preview-worker-client'
import {
  getPixelPreviewProfile,
} from './image-detail-pixel-preview-utils'
import { ROTATION_STEP, ZOOM_STEP, useImageDetailMediaGestures } from './use-image-detail-media-gestures'
import { useImageDetailMediaPreferences, useImageDetailRenderModePreference } from './use-image-detail-media-preferences'

interface ImageDetailMediaProps {
  image: ImageRecord
  renderUrl: string | null
  className?: string
  onPrimaryLoad?: () => void
}

/** Render the main detail media using the correct element for image, GIF, or video files. */
export function ImageDetailMedia({ image, renderUrl, className, onPrimaryLoad }: ImageDetailMediaProps) {
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const { preferredRenderMode, updatePreferredRenderMode } = useImageDetailRenderModePreference()
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
    updatePreferredRenderMode(nextMode)
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
  const [hasRenderError, setHasRenderError] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    setHasRenderError(false)
  }, [renderUrl])

  const {
    isControlsCollapsed,
    isPixelPreviewEnabled,
    isPixelPreviewPanelOpen,
    isWheelZoomEnabled,
    pixelPreviewMode,
    pixelPreviewSettings,
    setIsPixelPreviewPanelOpen,
    setPixelPreviewModeAndPersist,
    toggleControlsCollapsed,
    togglePixelPreviewEnabled,
    toggleWheelZoomEnabled,
    updatePixelPreviewSettings,
  } = useImageDetailMediaPreferences()
  const {
    canZoomIn,
    canZoomOut,
    finishPointerInteraction,
    fittedMediaSize,
    handleDoubleClick,
    handlePointerDown,
    handlePointerMove,
    isDefaultView,
    isGestureActive,
    isPannable,
    mediaFitFrameStyle,
    offset,
    recordNaturalMediaSize,
    resetView,
    rotateBy,
    rotation,
    scale,
    transformSummary,
    viewportRef,
    zoomBy,
  } = useImageDetailMediaGestures({ isWheelZoomEnabled, renderUrl })
  const [isPixelPreviewReady, setIsPixelPreviewReady] = useState(false)
  const pixelPreviewProfile = useMemo(() => getPixelPreviewProfile(pixelPreviewMode, pixelPreviewSettings), [pixelPreviewMode, pixelPreviewSettings])
  const activePixelPreviewSettings = pixelPreviewProfile ?? pixelPreviewSettings
  const shouldRenderPixelPreview = canUsePixelPreview && pixelPreviewProfile !== null

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

  const handlePrimaryImageLoad = useCallback((event: ReactSyntheticEvent<HTMLImageElement>) => {
    recordNaturalMediaSize(event.currentTarget)
    onPrimaryLoad?.()
  }, [onPrimaryLoad, recordNaturalMediaSize])

  if (hasRenderError) {
    return <ImageDetailMediaFallback image={image} />
  }

  return (
    <div className="relative isolate flex h-full w-full items-center justify-center overflow-hidden">
      <ImageDetailMediaToolbar
        canToggleRenderMode={canToggleRenderMode}
        canUsePixelPreview={canUsePixelPreview}
        canZoomIn={canZoomIn}
        canZoomOut={canZoomOut}
        isControlsCollapsed={isControlsCollapsed}
        isDefaultView={isDefaultView}
        isPixelPreviewEnabled={isPixelPreviewEnabled}
        isPixelPreviewPanelOpen={isPixelPreviewPanelOpen}
        isWheelZoomEnabled={isWheelZoomEnabled}
        activePixelPreviewSettings={activePixelPreviewSettings}
        pixelPreviewMode={pixelPreviewMode}
        renderMode={renderMode}
        transformSummary={transformSummary}
        onResetView={resetView}
        onRotateLeft={() => rotateBy(-ROTATION_STEP)}
        onRotateRight={() => rotateBy(ROTATION_STEP)}
        onSetPixelPreviewMode={setPixelPreviewModeAndPersist}
        onToggleControlsCollapsed={toggleControlsCollapsed}
        onTogglePixelPreviewEnabled={togglePixelPreviewEnabled}
        onToggleRenderMode={onToggleRenderMode}
        onTogglePixelPreviewPanel={() => setIsPixelPreviewPanelOpen((current) => !current)}
        onToggleWheelZoomEnabled={toggleWheelZoomEnabled}
        onUpdatePixelPreviewSettings={updatePixelPreviewSettings}
        onZoomIn={() => zoomBy(ZOOM_STEP)}
        onZoomOut={() => zoomBy(-ZOOM_STEP)}
      />

      <div
        ref={viewportRef}
        className={cn(
          'relative z-0 flex h-full w-full items-center justify-center overflow-hidden select-none',
          isPannable ? 'cursor-grab active:cursor-grabbing' : isWheelZoomEnabled ? 'cursor-zoom-in' : 'cursor-default',
        )}
        style={{ touchAction: isWheelZoomEnabled ? 'none' : 'pan-y', overscrollBehavior: isWheelZoomEnabled ? 'contain' : 'auto' }}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerInteraction}
        onPointerCancel={finishPointerInteraction}
      >
        <div
          className={cn('inline-flex will-change-transform', !fittedMediaSize && 'max-h-full max-w-full', !isGestureActive && 'transition-transform duration-150 ease-out')}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
            transformOrigin: 'center center',
          }}
        >
          <ImageDetailMediaFrame
            altText={altText}
            canvasRef={canvasRef}
            className={className}
            fittedMediaSize={fittedMediaSize}
            mediaFitFrameStyle={mediaFitFrameStyle}
            renderUrl={renderUrl}
            shouldRenderPixelPreview={shouldRenderPixelPreview}
            isPixelPreviewReady={isPixelPreviewReady}
            applyingLabel={t({ ko: '적용 중', en: 'Applying' })}
            onPrimaryImageLoad={handlePrimaryImageLoad}
            onRenderError={() => setHasRenderError(true)}
          />
        </div>
      </div>
    </div>
  )
}
