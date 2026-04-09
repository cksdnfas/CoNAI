import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getGraphWorkflowBrowseContent, getGroupPreviewImages } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import type {
  WallpaperCanvasPreset,
  WallpaperLayoutPreset,
  WallpaperWidgetInstance,
} from './wallpaper-types'

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

/** Render one live clock string for the wallpaper clock widget. */
function useWallpaperClockText() {
  const [currentTime, setCurrentTime] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  return currentTime
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

/** Resolve one image preview url from a generic ImageRecord. */
function getWallpaperImageUrl(image: ImageRecord | null | undefined) {
  return image?.thumbnail_url || image?.image_url || null
}

/** Render the live clock body without forcing timers on every widget. */
function WallpaperClockBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'clock' }> }) {
  const currentTime = useWallpaperClockText()
  const timeFormat = widget.settings.timeFormat
  const showSeconds = widget.settings.showSeconds

  return (
    <div className="flex h-full flex-col justify-center">
      <div className="text-3xl font-semibold tracking-[-0.06em] text-foreground sm:text-4xl">
        {currentTime.toLocaleTimeString('ko-KR', {
          hour: '2-digit',
          minute: '2-digit',
          second: showSeconds ? '2-digit' : undefined,
          hour12: timeFormat === '12h',
        })}
      </div>
      <div className="text-xs text-muted-foreground sm:text-sm">{currentTime.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}</div>
    </div>
  )
}

/** Render one queue status widget using existing graph browse-content APIs. */
function WallpaperQueueStatusBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'queue-status' }> }) {
  const refreshInterval = Math.max(2, widget.settings.refreshIntervalSec) * 1000

  const queueQuery = useQuery({
    queryKey: ['wallpaper-widget', 'queue-status', refreshInterval],
    queryFn: () => getGraphWorkflowBrowseContent(),
    staleTime: Math.max(1_000, refreshInterval - 1_000),
    refetchInterval: refreshInterval,
  })

  const queueSummary = useMemo(() => {
    const executions = queueQuery.data?.executions ?? []
    return {
      queued: executions.filter((item) => item.status === 'queued').length,
      running: executions.filter((item) => item.status === 'running').length,
      failed: executions.filter((item) => item.status === 'failed').length,
      workflows: queueQuery.data?.scope.workflow_count ?? 0,
    }
  }, [queueQuery.data])

  if (queueQuery.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Queue loading…</div>
  }

  if (queueQuery.isError) {
    return <div className="flex h-full items-center justify-center text-center text-sm text-destructive">큐 상태를 불러오지 못했어.</div>
  }

  return (
    <div className="grid h-full grid-cols-2 gap-2 text-center text-xs sm:text-sm">
      {[
        ['Queued', queueSummary.queued],
        ['Running', queueSummary.running],
        ['Failed', queueSummary.failed],
        ['Workflows', queueSummary.workflows],
      ].map(([label, value]) => (
        <div key={String(label)} className="rounded-sm border border-border/70 bg-surface-low px-2 py-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{Number(value).toLocaleString('ko-KR')}</div>
        </div>
      ))}
    </div>
  )
}

/** Render one group-backed preview grid using the existing groups preview API. */
function WallpaperGroupImageViewBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'group-image-view' }> }) {
  const groupId = widget.settings.groupId
  const includeChildren = widget.settings.includeChildren
  const visibleCount = Math.max(1, Math.min(9, widget.settings.visibleCount))

  const previewQuery = useQuery({
    queryKey: ['wallpaper-widget', 'group-image-view', groupId, includeChildren, visibleCount],
    queryFn: () => getGroupPreviewImages(groupId as number, { includeChildren, count: visibleCount }),
    enabled: groupId !== null,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  if (groupId === null) {
    return <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-border/80 bg-surface-low px-3 text-center text-sm text-muted-foreground">Select a group in the inspector.</div>
  }

  if (previewQuery.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Group preview loading…</div>
  }

  if (previewQuery.isError) {
    return <div className="flex h-full items-center justify-center text-center text-sm text-destructive">그룹 미리보기를 불러오지 못했어.</div>
  }

  const images = previewQuery.data ?? []
  const columnCount = visibleCount >= 6 ? 3 : visibleCount >= 4 ? 2 : 1

  return (
    <div className="grid h-full gap-2" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>
      {images.length === 0 ? (
        <div className="col-span-full flex h-full items-center justify-center rounded-sm border border-dashed border-border/80 bg-surface-low px-3 text-center text-sm text-muted-foreground">
          This group has no preview images yet.
        </div>
      ) : null}
      {images.map((image) => {
        const imageUrl = getWallpaperImageUrl(image)
        return (
          <div key={String(image.composite_hash ?? image.id)} className="overflow-hidden rounded-sm border border-border/70 bg-surface-low">
            {imageUrl ? <img src={imageUrl} alt="Group preview" className="h-full w-full object-cover" loading="lazy" /> : <div className="flex h-full min-h-16 items-center justify-center text-xs text-muted-foreground">No image</div>}
          </div>
        )
      })}
    </div>
  )
}

/** Render one showcase-style single image preview from a chosen group. */
function WallpaperImageShowcaseBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'image-showcase' }> }) {
  const groupId = widget.settings.groupId
  const includeChildren = widget.settings.includeChildren

  const previewQuery = useQuery({
    queryKey: ['wallpaper-widget', 'image-showcase', groupId, includeChildren],
    queryFn: async () => {
      const images = await getGroupPreviewImages(groupId as number, { includeChildren, count: 1 })
      return images[0] ?? null
    },
    enabled: groupId !== null,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  if (groupId === null) {
    return (
      <div className="flex h-full items-end rounded-sm border border-border/70 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--secondary)_24%,transparent),transparent_55%),linear-gradient(180deg,transparent,color-mix(in_srgb,var(--primary)_10%,transparent)),var(--surface-low)] p-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-secondary">Featured</div>
          <div className="text-sm font-medium text-foreground">Choose a group to drive this showcase.</div>
        </div>
      </div>
    )
  }

  if (previewQuery.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Showcase loading…</div>
  }

  const imageUrl = getWallpaperImageUrl(previewQuery.data)
  if (!imageUrl) {
    return <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-border/80 bg-surface-low px-3 text-center text-sm text-muted-foreground">No showcase image available.</div>
  }

  return <img src={imageUrl} alt="Showcase" className={cn('h-full w-full rounded-sm', widget.settings.fitMode === 'contain' ? 'object-contain' : 'object-cover')} loading="lazy" />
}

/** Render one widget body based on the widget type. */
function WallpaperWidgetBody({ widget }: { widget: WallpaperWidgetInstance }) {
  if (widget.type === 'clock') {
    return <WallpaperClockBody widget={widget} />
  }

  if (widget.type === 'queue-status') {
    return <WallpaperQueueStatusBody widget={widget} />
  }

  if (widget.type === 'group-image-view') {
    return <WallpaperGroupImageViewBody widget={widget} />
  }

  if (widget.type === 'image-showcase') {
    return <WallpaperImageShowcaseBody widget={widget} />
  }

  return (
    <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-border/80 bg-surface-low px-3 text-center text-sm text-muted-foreground">
      {widget.settings.text}
    </div>
  )
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
        disabled={mode !== 'editor'}
        onClick={() => onSelectWidget?.(widget.id)}
        onPointerDown={onStartMove}
        className={cn(
          'flex h-full w-full flex-col overflow-hidden rounded-sm border text-left transition-all duration-200',
          showBackground ? 'bg-surface-container/88 backdrop-blur-sm' : 'bg-transparent',
          mode === 'editor'
            ? widget.locked
              ? 'cursor-default'
              : 'cursor-grab active:cursor-grabbing hover:border-secondary/70'
            : 'cursor-default pointer-events-none',
          isSelected ? 'border-secondary shadow-[0_0_0_1px_color-mix(in_srgb,var(--secondary)_22%,transparent)]' : 'border-border/70',
        )}
        style={{ opacity }}
      >
        {showTitle ? (
          <div className="border-b border-border/60 px-3 py-2 text-[11px] font-semibold tracking-[0.18em] text-secondary uppercase">{title}</div>
        ) : null}
        <div className="min-h-0 flex-1 p-3">
          <WallpaperWidgetBody widget={widget} />
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
  const canvasRef = useRef<HTMLDivElement | null>(null)

  const visibleWidgets = useMemo(
    () => layoutPreset.widgets.filter((widget) => !widget.hidden).sort((left, right) => left.zIndex - right.zIndex),
    [layoutPreset.widgets],
  )

  useEffect(() => {
    if (!interaction || mode !== 'editor' || !onUpdateWidgetFrame) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== interaction.pointerId || !canvasRef.current) {
        return
      }

      const { deltaColumns, deltaRows } = getWallpaperGridDelta(interaction, event, canvasRef.current, canvasPreset)

      if (interaction.kind === 'move') {
        onUpdateWidgetFrame(interaction.widgetId, {
          x: interaction.originWidget.x + deltaColumns,
          y: interaction.originWidget.y + deltaRows,
        })
        return
      }

      onUpdateWidgetFrame(interaction.widgetId, {
        w: interaction.originWidget.w + deltaColumns,
        h: interaction.originWidget.h + deltaRows,
      })
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== interaction.pointerId) {
        return
      }
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

  return (
    <div className="rounded-sm border border-border bg-surface-low p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{canvasPreset.name}</span>
        <span>{canvasPreset.aspectRatioLabel} · {canvasPreset.gridColumns}×{canvasPreset.gridRows} grid</span>
      </div>
      <div
        ref={canvasRef}
        className="relative mx-auto w-full overflow-hidden rounded-sm border border-border/80 bg-background"
        style={{ aspectRatio: `${canvasPreset.width} / ${canvasPreset.height}` }}
      >
        <div
          className="absolute inset-0 grid"
          style={{
            gridTemplateColumns: `repeat(${canvasPreset.gridColumns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${canvasPreset.gridRows}, minmax(0, 1fr))`,
            backgroundImage: 'linear-gradient(to right, color-mix(in srgb, var(--border) 68%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--border) 68%, transparent) 1px, transparent 1px)',
            backgroundSize: `${100 / canvasPreset.gridColumns}% ${100 / canvasPreset.gridRows}%`,
          }}
        >
          {visibleWidgets.length === 0 ? (
            <div className="col-span-full row-span-full flex items-center justify-center text-center text-sm text-muted-foreground">
              Add a widget from the library to start building the wallpaper layout.
            </div>
          ) : null}
          {visibleWidgets.map((widget) => (
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
    </div>
  )
}
