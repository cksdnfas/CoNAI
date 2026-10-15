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
import { renderPixelPreviewSample } from './image-detail-pixel-preview'
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
  isRefreshing?: boolean
}

/** Render the main detail media using the correct element for image, GIF, or video files. */
export function ImageDetailMedia({ image, renderUrl, className, onPrimaryLoad, isRefreshing = false }: ImageDetailMediaProps) {
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
    return <StableDetailVideo key={image.composite_hash || String(image.id)} renderUrl={effectiveRenderUrl} className={mediaClassName} isRefreshing={isRefreshing} />
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

/** A metadata refresh may offer an optimized copy; keep this viewing session on its original source. */
function StableDetailVideo({ renderUrl, className, isRefreshing }: { renderUrl: string; className: string; isRefreshing: boolean }) {
  const { t } = useI18n()
  // Resolve the latest copy once when opening, then keep every range request on that copy.
  const [sessionUrl, setSessionUrl] = useState<string | null>(() => isRefreshing ? null : renderUrl)
  useEffect(() => {
    if (!sessionUrl && !isRefreshing) setSessionUrl(renderUrl)
  }, [isRefreshing, renderUrl, sessionUrl])
  if (!sessionUrl) return <ImagePreviewPlaceholder label={t({ ko: '영상 불러오는 중', en: 'Loading video' })} className={className} />
  return <EnhancedVideoPlayer renderUrl={sessionUrl} className={className} loop autoPlay />
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
    setIsPixelPreviewReady(false)
    if (!shouldRenderPixelPreview || !pixelPreviewProfile) return

    const controller = new AbortController()
    renderPixelPreviewSample(renderUrl, pixelPreviewProfile, controller.signal)
      .then((sample) => {
        try {
          if (controller.signal.aborted) return
          const canvas = canvasRef.current
          const context = canvas?.getContext('2d')
          if (!canvas || !context) {
            setHasRenderError(true)
            return
          }
          // CSS scales the bounded bitmap to the original image's fitted frame.
          canvas.width = sample.canvas.width
          canvas.height = sample.canvas.height
          context.drawImage(sample.canvas, 0, 0)
          setIsPixelPreviewReady(true)
          onPrimaryLoad?.()
        } finally {
          sample.canvas.width = sample.canvas.height = 0
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setHasRenderError(true)
      })
    return () => controller.abort()
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
