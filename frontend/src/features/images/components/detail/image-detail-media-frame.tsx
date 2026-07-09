import { LoaderCircle } from 'lucide-react'
import type { CSSProperties, RefObject, SyntheticEvent as ReactSyntheticEvent } from 'react'
import { cn } from '@/lib/utils'

interface MediaSize {
  width: number
  height: number
}

interface ImageDetailMediaFrameProps {
  altText: string
  canvasRef: RefObject<HTMLCanvasElement | null>
  className: string
  fittedMediaSize: MediaSize | null
  mediaFitFrameStyle?: CSSProperties
  renderUrl: string
  shouldRenderPixelPreview: boolean
  isPixelPreviewReady: boolean
  applyingLabel: string
  onPrimaryImageLoad: (event: ReactSyntheticEvent<HTMLImageElement>) => void
  onRenderError: () => void
}

export function ImageDetailMediaFrame({
  altText,
  canvasRef,
  className,
  fittedMediaSize,
  mediaFitFrameStyle,
  renderUrl,
  shouldRenderPixelPreview,
  isPixelPreviewReady,
  applyingLabel,
  onPrimaryImageLoad,
  onRenderError,
}: ImageDetailMediaFrameProps) {
  return (
    <div className={cn('relative grid place-items-center', !fittedMediaSize && 'max-h-full max-w-full')} style={mediaFitFrameStyle}>
      <img
        src={renderUrl}
        alt={altText}
        className={cn(
          'col-start-1 row-start-1 block pointer-events-none select-none transition-opacity duration-150',
          fittedMediaSize ? 'h-full w-full object-contain' : cn('h-auto w-auto', className),
          shouldRenderPixelPreview && isPixelPreviewReady && 'opacity-0',
        )}
        draggable={false}
        onLoad={onPrimaryImageLoad}
        onError={onRenderError}
      />

      {shouldRenderPixelPreview ? (
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={altText}
          className={cn('absolute inset-0 h-full w-full pointer-events-none select-none object-contain transition-opacity duration-150', isPixelPreviewReady ? 'opacity-100' : 'opacity-0')}
          style={{ imageRendering: 'pixelated' }}
        />
      ) : null}
      {shouldRenderPixelPreview && !isPixelPreviewReady ? (
        <div className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-black/45 px-2 py-1 text-[11px] font-medium text-white/82 shadow-sm backdrop-blur-sm">
          <LoaderCircle className="h-3 w-3 animate-spin" />
          {applyingLabel}
        </div>
      ) : null}
    </div>
  )
}
