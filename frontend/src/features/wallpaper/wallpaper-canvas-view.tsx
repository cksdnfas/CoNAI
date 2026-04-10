import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { GripVertical } from 'lucide-react'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { useIsCoarsePointer } from '@/lib/use-is-coarse-pointer'
import { cn } from '@/lib/utils'
import type {
  WallpaperCanvasPreset,
  WallpaperLayoutPreset,
  WallpaperWidgetInstance,
} from './wallpaper-types'
import { WallpaperWidgetBody, type WallpaperWidgetPreviewImage } from './wallpaper-widget-bodies'
import { clampWallpaperWidgetInstance } from './wallpaper-layout-utils'

interface WallpaperCanvasViewProps {
  canvasPreset: WallpaperCanvasPreset
  layoutPreset: WallpaperLayoutPreset
  mode: 'editor' | 'runtime'
  selectedWidgetId?: string | null
  onSelectWidget?: (widgetId: string) => void
  onUpdateWidgetFrame?: (widgetId: string, patch: Partial<WallpaperWidgetInstance>) => void
  editorHeader?: ReactNode
}

interface WallpaperInteractionState {
  kind: 'move' | 'resize'
  widgetId: string
  pointerId: number
  originClientX: number
  originClientY: number
  originWidget: Pick<WallpaperWidgetInstance, 'x' | 'y' | 'w' | 'h'>
}

interface WallpaperInteractionPreview {
  x: number
  y: number
  w: number
  h: number
}

/** Convert pointer movement in pixels into grid-cell deltas. */
function getWallpaperGridDelta(interaction: WallpaperInteractionState, event: PointerEvent, canvasElement: HTMLDivElement, canvasPreset: WallpaperCanvasPreset) {
  const canvasRect = canvasElement.getBoundingClientRect()
  const columnWidth = canvasRect.width / canvasPreset.gridColumns
  const rowHeight = canvasRect.height / canvasPreset.gridRows

  return {
    deltaColumns: Math.round((event.clientX - interaction.originClientX) / columnWidth),
    deltaRows: Math.round((event.clientY - interaction.originClientY) / rowHeight),
  }
}

/** Build one temporary widget frame preview during drag or resize. */
function buildWallpaperInteractionPreview(
  interaction: WallpaperInteractionState,
  deltaColumns: number,
  deltaRows: number,
  widget: WallpaperWidgetInstance,
  canvasPreset: WallpaperCanvasPreset,
): WallpaperInteractionPreview {
  const previewWidget = interaction.kind === 'move'
    ? {
        ...widget,
        x: interaction.originWidget.x + deltaColumns,
        y: interaction.originWidget.y + deltaRows,
        w: interaction.originWidget.w,
        h: interaction.originWidget.h,
      }
    : {
        ...widget,
        x: interaction.originWidget.x,
        y: interaction.originWidget.y,
        w: interaction.originWidget.w + deltaColumns,
        h: interaction.originWidget.h + deltaRows,
      }

  const clampedPreview = clampWallpaperWidgetInstance(previewWidget, canvasPreset)
  return {
    x: clampedPreview.x,
    y: clampedPreview.y,
    w: clampedPreview.w,
    h: clampedPreview.h,
  }
}

interface WallpaperWidgetCardProps {
  widget: WallpaperWidgetInstance
  isSelected: boolean
  mode: 'editor' | 'runtime'
  useMoveHandle?: boolean
  onSelectWidget?: (widgetId: string) => void
  onStartMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onStartResize?: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onOpenImage?: (image: WallpaperWidgetPreviewImage) => void
}

/** Render one widget card inside the wallpaper canvas grid. */
function WallpaperWidgetCard({ widget, isSelected, mode, useMoveHandle = false, onSelectWidget, onStartMove, onStartResize, onOpenImage }: WallpaperWidgetCardProps) {
  const title = String(widget.settings.title ?? widget.type)
  const showTitle = widget.settings.showTitle === true
  const showBackground = widget.settings.showBackground === true
  const opacity = typeof widget.settings.opacity === 'number' ? widget.settings.opacity : 1

  const cardClassName = cn(
    'flex h-full w-full flex-col overflow-hidden rounded-sm border text-left transition-all duration-200 select-none',
    showBackground ? 'bg-surface-container/88 backdrop-blur-sm' : 'bg-transparent',
    mode === 'editor'
      ? widget.locked
        ? 'cursor-default'
        : 'cursor-grab active:cursor-grabbing hover:border-secondary/70'
      : 'cursor-default',
    isSelected ? 'border-secondary shadow-[0_0_0_1px_color-mix(in_srgb,var(--secondary)_22%,transparent)]' : 'border-border/70',
  )

  const cardContent = (
    <>
      {showTitle ? (
        <div className="border-b border-border/60 px-3 py-2 text-[11px] font-semibold tracking-[0.18em] text-secondary uppercase">{title}</div>
      ) : null}
      <div className="min-h-0 flex-1 p-3">
        <WallpaperWidgetBody widget={widget} mode={mode} onOpenImage={onOpenImage} />
      </div>
    </>
  )

  return (
    <div className="relative h-full w-full group">
      {mode === 'editor' ? (
        <button
          type="button"
          onClick={() => onSelectWidget?.(widget.id)}
          onPointerDown={useMoveHandle ? undefined : onStartMove}
          className={cardClassName}
          style={{ opacity }}
        >
          {cardContent}
        </button>
      ) : (
        <div className={cardClassName} style={{ opacity }}>
          {cardContent}
        </div>
      )}

      {mode === 'editor' && !widget.locked ? (
        <>
          <button
            type="button"
            aria-label="Move widget"
            onPointerDown={onStartMove}
            className={cn(
              'absolute left-2 top-2 flex touch-none items-center justify-center rounded-[5px] border border-border/80 bg-background/92 text-muted-foreground shadow-sm transition select-none',
              useMoveHandle ? 'h-7 min-w-7 px-1.5 opacity-100' : 'h-5 min-w-5 px-1 opacity-0 group-hover:opacity-100',
              isSelected ? 'opacity-100' : null,
            )}
          >
            <GripVertical className={useMoveHandle ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
          </button>
          <button
            type="button"
            aria-label="Resize widget"
            onPointerDown={onStartResize}
            className={cn(
              'absolute bottom-2 right-2 flex touch-none items-center justify-center rounded-[5px] border border-border/80 bg-background/92 text-muted-foreground shadow-sm transition select-none',
              useMoveHandle ? 'h-7 min-w-7 px-1.5 opacity-100' : 'h-4 w-4 opacity-0 group-hover:opacity-100',
              isSelected ? 'opacity-100' : null,
            )}
          >
            <span className={cn('pointer-events-none block border-b border-r border-current', useMoveHandle ? 'h-3 w-3' : 'h-2 w-2')} />
          </button>
        </>
      ) : null}
    </div>
  )
}

/** Render the shared wallpaper canvas in editor or runtime mode. */
export function WallpaperCanvasView({ canvasPreset, layoutPreset, mode, selectedWidgetId, onSelectWidget, onUpdateWidgetFrame, editorHeader }: WallpaperCanvasViewProps) {
  const [interaction, setInteraction] = useState<WallpaperInteractionState | null>(null)
  const [interactionPreview, setInteractionPreview] = useState<WallpaperInteractionPreview | null>(null)
  const [previewImage, setPreviewImage] = useState<WallpaperWidgetPreviewImage | null>(null)
  const [isPreviewVisible, setIsPreviewVisible] = useState(false)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const interactionPreviewRef = useRef<WallpaperInteractionPreview | null>(null)
  const previewCloseTimeoutRef = useRef<number | null>(null)
  const isRuntimeMode = mode === 'runtime'
  const isCoarsePointer = useIsCoarsePointer()

  const visibleWidgets = useMemo(
    () => layoutPreset.widgets.filter((widget) => !widget.hidden).sort((left, right) => left.zIndex - right.zIndex),
    [layoutPreset.widgets],
  )
  const renderedWidgets = useMemo(
    () => visibleWidgets.map((widget) => (
      interaction && interactionPreview && widget.id === interaction.widgetId
        ? { ...widget, ...interactionPreview }
        : widget
    )),
    [interaction, interactionPreview, visibleWidgets],
  )

  useEffect(() => {
    interactionPreviewRef.current = interactionPreview
  }, [interactionPreview])

  useEffect(() => {
    if (!interaction || mode !== 'editor' || !onUpdateWidgetFrame) {
      return
    }

    const previousBodyTouchAction = document.body.style.touchAction
    const previousBodyOverscrollBehavior = document.body.style.overscrollBehavior
    document.body.style.touchAction = 'none'
    document.body.style.overscrollBehavior = 'none'

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== interaction.pointerId || !canvasRef.current) {
        return
      }

      const activeWidget = layoutPreset.widgets.find((widget) => widget.id === interaction.widgetId)
      if (!activeWidget) {
        return
      }

      const { deltaColumns, deltaRows } = getWallpaperGridDelta(interaction, event, canvasRef.current, canvasPreset)
      const nextPreview = buildWallpaperInteractionPreview(interaction, deltaColumns, deltaRows, activeWidget, canvasPreset)
      interactionPreviewRef.current = nextPreview
      setInteractionPreview(nextPreview)
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== interaction.pointerId) {
        return
      }

      const nextPreview = interactionPreviewRef.current
      if (nextPreview) {
        onUpdateWidgetFrame(interaction.widgetId, nextPreview)
      }

      interactionPreviewRef.current = null
      setInteractionPreview(null)
      setInteraction(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      document.body.style.touchAction = previousBodyTouchAction
      document.body.style.overscrollBehavior = previousBodyOverscrollBehavior
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [canvasPreset, interaction, layoutPreset.widgets, mode, onUpdateWidgetFrame])

  useEffect(() => {
    return () => {
      if (previewCloseTimeoutRef.current !== null) {
        window.clearTimeout(previewCloseTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!previewImage) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsPreviewVisible(false)
        if (previewCloseTimeoutRef.current !== null) {
          window.clearTimeout(previewCloseTimeoutRef.current)
        }
        previewCloseTimeoutRef.current = window.setTimeout(() => {
          setPreviewImage(null)
          previewCloseTimeoutRef.current = null
        }, 240)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [previewImage])

  const handleOpenPreviewImage = (image: WallpaperWidgetPreviewImage) => {
    if (!isRuntimeMode) {
      return
    }

    if (previewCloseTimeoutRef.current !== null) {
      window.clearTimeout(previewCloseTimeoutRef.current)
      previewCloseTimeoutRef.current = null
    }

    setPreviewImage(image)
    window.requestAnimationFrame(() => {
      setIsPreviewVisible(true)
    })
  }

  const handleClosePreviewImage = () => {
    setIsPreviewVisible(false)
    if (previewCloseTimeoutRef.current !== null) {
      window.clearTimeout(previewCloseTimeoutRef.current)
    }
    previewCloseTimeoutRef.current = window.setTimeout(() => {
      setPreviewImage(null)
      previewCloseTimeoutRef.current = null
    }, 240)
  }

  const canvasElement = (
    <div
      ref={canvasRef}
      className={cn(
        'relative overflow-hidden bg-background',
        isRuntimeMode ? 'mx-auto' : 'mx-auto w-full rounded-sm border border-border/80',
      )}
      style={isRuntimeMode
        ? {
            aspectRatio: `${canvasPreset.width} / ${canvasPreset.height}`,
            width: `min(100vw, calc(100vh * ${canvasPreset.width} / ${canvasPreset.height}))`,
            maxWidth: '100vw',
            maxHeight: '100vh',
          }
        : { aspectRatio: `${canvasPreset.width} / ${canvasPreset.height}` }}
    >
      <div
        className="absolute inset-0 grid"
        style={{
          gridTemplateColumns: `repeat(${canvasPreset.gridColumns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${canvasPreset.gridRows}, minmax(0, 1fr))`,
          backgroundImage: isRuntimeMode
            ? 'none'
            : 'linear-gradient(to right, color-mix(in srgb, var(--border) 68%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--border) 68%, transparent) 1px, transparent 1px)',
          backgroundSize: `${100 / canvasPreset.gridColumns}% ${100 / canvasPreset.gridRows}%`,
        }}
      >
        {renderedWidgets.length === 0 ? (
          <div className="col-span-full row-span-full flex items-center justify-center text-center text-sm text-muted-foreground">
            왼쪽 라이브러리에서 위젯을 추가해서 시작해.
          </div>
        ) : null}
        {renderedWidgets.map((widget) => (
          <div
            key={widget.id}
            className="p-1.5"
            style={{
              gridColumn: `${widget.x + 1} / span ${widget.w}`,
              gridRow: `${widget.y + 1} / span ${widget.h}`,
            }}
          >
            <WallpaperWidgetCard
              widget={widget}
              mode={mode}
              useMoveHandle={isCoarsePointer}
              isSelected={selectedWidgetId === widget.id}
              onSelectWidget={onSelectWidget}
              onOpenImage={handleOpenPreviewImage}
              onStartMove={(event) => {
                if (mode !== 'editor' || widget.locked) {
                  return
                }
                event.preventDefault()
                event.stopPropagation()
                event.currentTarget.setPointerCapture?.(event.pointerId)
                onSelectWidget?.(widget.id)
                interactionPreviewRef.current = null
                setInteractionPreview(null)
                setInteraction({
                  kind: 'move',
                  widgetId: widget.id,
                  pointerId: event.pointerId,
                  originClientX: event.clientX,
                  originClientY: event.clientY,
                  originWidget: {
                    x: widget.x,
                    y: widget.y,
                    w: widget.w,
                    h: widget.h,
                  },
                })
              }}
              onStartResize={(event) => {
                if (mode !== 'editor' || widget.locked) {
                  return
                }
                event.preventDefault()
                event.stopPropagation()
                event.currentTarget.setPointerCapture?.(event.pointerId)
                onSelectWidget?.(widget.id)
                interactionPreviewRef.current = null
                setInteractionPreview(null)
                setInteraction({
                  kind: 'resize',
                  widgetId: widget.id,
                  pointerId: event.pointerId,
                  originClientX: event.clientX,
                  originClientY: event.clientY,
                  originWidget: {
                    x: widget.x,
                    y: widget.y,
                    w: widget.w,
                    h: widget.h,
                  },
                })
              }}
            />
          </div>
        ))}
      </div>

      {previewImage ? (
        <div
          className={cn(
            'absolute inset-0 z-[120] flex items-center justify-center bg-[color-mix(in_srgb,var(--background)_68%,transparent)] p-6 backdrop-blur-md transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
            isPreviewVisible ? 'opacity-100' : 'opacity-0',
          )}
          onClick={handleClosePreviewImage}
        >
          <button
            type="button"
            aria-label="이미지 미리보기 닫기"
            onClick={(event) => {
              event.stopPropagation()
              handleClosePreviewImage()
            }}
            className={cn(
              'max-h-full max-w-full overflow-hidden rounded-[24px] border border-white/14 bg-black/14 shadow-[0_16px_40px_rgba(0,0,0,0.18),0_36px_96px_rgba(0,0,0,0.42)] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
              isPreviewVisible ? 'translate-y-0 scale-100 opacity-100 rotate-0' : 'translate-y-5 scale-[0.88] opacity-0 -rotate-[1.4deg]',
            )}
          >
            <ImagePreviewMedia
              image={previewImage.image}
              alt={previewImage.alt}
              className="block max-h-[84vh] max-w-[90vw] object-contain"
              loading="eager"
            />
          </button>
        </div>
      ) : null}
    </div>
  )

  if (isRuntimeMode) {
    return canvasElement
  }

  return (
    <div className="rounded-sm border border-border bg-surface-low p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        {editorHeader ?? (
          <>
            <span>{canvasPreset.name}</span>
            <span>{canvasPreset.aspectRatioLabel} · {canvasPreset.gridColumns}×{canvasPreset.gridRows} 그리드</span>
          </>
        )}
      </div>
      {canvasElement}
    </div>
  )
}
