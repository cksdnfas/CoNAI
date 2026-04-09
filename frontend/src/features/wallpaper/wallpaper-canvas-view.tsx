import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@/lib/utils'
import type {
  WallpaperCanvasPreset,
  WallpaperLayoutPreset,
  WallpaperWidgetInstance,
} from './wallpaper-types'
import { WallpaperWidgetBody } from './wallpaper-widget-bodies'

interface WallpaperCanvasViewProps {
  canvasPreset: WallpaperCanvasPreset
  layoutPreset: WallpaperLayoutPreset
  mode: 'editor' | 'runtime'
  selectedWidgetId?: string | null
  onSelectWidget?: (widgetId: string) => void
  onUpdateWidgetFrame?: (widgetId: string, patch: Partial<WallpaperWidgetInstance>) => void
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
function buildWallpaperInteractionPreview(interaction: WallpaperInteractionState, deltaColumns: number, deltaRows: number): WallpaperInteractionPreview {
  if (interaction.kind === 'move') {
    return {
      x: interaction.originWidget.x + deltaColumns,
      y: interaction.originWidget.y + deltaRows,
      w: interaction.originWidget.w,
      h: interaction.originWidget.h,
    }
  }

  return {
    x: interaction.originWidget.x,
    y: interaction.originWidget.y,
    w: interaction.originWidget.w + deltaColumns,
    h: interaction.originWidget.h + deltaRows,
  }
}

interface WallpaperWidgetCardProps {
  widget: WallpaperWidgetInstance
  isSelected: boolean
  mode: 'editor' | 'runtime'
  onSelectWidget?: (widgetId: string) => void
  onStartMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onStartResize?: (event: ReactPointerEvent<HTMLButtonElement>) => void
}

/** Render one widget card inside the wallpaper canvas grid. */
function WallpaperWidgetCard({ widget, isSelected, mode, onSelectWidget, onStartMove, onStartResize }: WallpaperWidgetCardProps) {
  const title = String(widget.settings.title ?? widget.type)
  const showTitle = widget.settings.showTitle !== false
  const showBackground = widget.settings.showBackground !== false
  const opacity = typeof widget.settings.opacity === 'number' ? widget.settings.opacity : 1

  return (
    <div className="relative h-full w-full group">
      <button
        type="button"
        onClick={() => onSelectWidget?.(widget.id)}
        onPointerDown={onStartMove}
        className={cn(
          'flex h-full w-full flex-col overflow-hidden rounded-sm border text-left transition-all duration-200',
          showBackground ? 'bg-surface-container/88 backdrop-blur-sm' : 'bg-transparent',
          mode === 'editor'
            ? widget.locked
              ? 'cursor-default'
              : 'cursor-grab active:cursor-grabbing hover:border-secondary/70'
            : 'cursor-default',
          isSelected ? 'border-secondary shadow-[0_0_0_1px_color-mix(in_srgb,var(--secondary)_22%,transparent)]' : 'border-border/70',
        )}
        style={{ opacity }}
      >
        {showTitle ? (
          <div className="border-b border-border/60 px-3 py-2 text-[11px] font-semibold tracking-[0.18em] text-secondary uppercase">{title}</div>
        ) : null}
        <div className="min-h-0 flex-1 p-3">
          <WallpaperWidgetBody widget={widget} mode={mode} />
        </div>
      </button>

      {mode === 'editor' && !widget.locked ? (
        <button
          type="button"
          aria-label="Resize widget"
          onPointerDown={onStartResize}
          className={cn(
            'absolute bottom-2 right-2 flex h-4 w-4 items-center justify-center rounded-[3px] border border-border/80 bg-background/92 text-muted-foreground shadow-sm transition',
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <span className="pointer-events-none block h-2 w-2 border-b border-r border-current" />
        </button>
      ) : null}
    </div>
  )
}

/** Render the shared wallpaper canvas in editor or runtime mode. */
export function WallpaperCanvasView({ canvasPreset, layoutPreset, mode, selectedWidgetId, onSelectWidget, onUpdateWidgetFrame }: WallpaperCanvasViewProps) {
  const [interaction, setInteraction] = useState<WallpaperInteractionState | null>(null)
  const [interactionPreview, setInteractionPreview] = useState<WallpaperInteractionPreview | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const interactionPreviewRef = useRef<WallpaperInteractionPreview | null>(null)
  const isRuntimeMode = mode === 'runtime'

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

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== interaction.pointerId || !canvasRef.current) {
        return
      }

      const { deltaColumns, deltaRows } = getWallpaperGridDelta(interaction, event, canvasRef.current, canvasPreset)
      const nextPreview = buildWallpaperInteractionPreview(interaction, deltaColumns, deltaRows)
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
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [canvasPreset, interaction, mode, onUpdateWidgetFrame])

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
            Add a widget from the library to start building the wallpaper layout.
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
              isSelected={selectedWidgetId === widget.id}
              onSelectWidget={onSelectWidget}
              onStartMove={(event) => {
                if (mode !== 'editor' || widget.locked) {
                  return
                }
                event.preventDefault()
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
    </div>
  )

  if (isRuntimeMode) {
    return canvasElement
  }

  return (
    <div className="rounded-sm border border-border bg-surface-low p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{canvasPreset.name}</span>
        <span>{canvasPreset.aspectRatioLabel} · {canvasPreset.gridColumns}×{canvasPreset.gridRows} grid</span>
      </div>
      {canvasElement}
    </div>
  )
}
