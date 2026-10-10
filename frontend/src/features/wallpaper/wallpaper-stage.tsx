import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { getWallpaperLayoutCanvas } from './wallpaper-canvas-presets'
import { WALLPAPER_BACKGROUND_KEYFRAMES, WallpaperBackgroundLayer } from './wallpaper-background-layer'
import type { WallpaperLayoutPreset, WallpaperWidgetFrame as Frame, WallpaperWidgetInstance } from './wallpaper-types'
import { WALLPAPER_ENTRANCE_KEYFRAMES, WallpaperWidgetFrame } from './wallpaper-widget-frame'
import type { WallpaperWidgetPreviewImage } from './wallpaper-widget-bodies'
import { getWallpaperCanvasScale, getWallpaperWidgetMinSize } from './wallpaper-widget-registry'
import { getWallpaperAnimationEasingCss } from './wallpaper-widget-utils'

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const HANDLE_CURSOR: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' }
/** Screen px within which an edge or center snaps. */
const SNAP_SCREEN_PX = 6
/** Screen px a press must travel before it becomes a drag (a plain click only selects). */
const DRAG_START_PX = 3

type Drag =
  | { kind: 'move'; pointerId: number; startX: number; startY: number; ids: string[]; origin: Map<string, Frame>; active: boolean }
  | { kind: 'resize'; pointerId: number; startX: number; startY: number; id: string; handle: Handle; origin: Frame }
  | { kind: 'marquee'; pointerId: number; startX: number; startY: number; additive: boolean; base: string[] }

interface Guides { x: number[]; y: number[] }

export type WallpaperStageZoom = number | 'fit'

interface WallpaperStageProps {
  layout: WallpaperLayoutPreset
  mode: 'editor' | 'runtime'
  /** Canvas px → screen px (0.5 = 50%), or fit the container. */
  zoom?: WallpaperStageZoom
  onZoomPercentChange?: (percent: number) => void
  selectedIds?: string[]
  onSelectionChange?: (ids: string[]) => void
  onCommitFrames?: (frames: Map<string, Frame>) => void
  snap?: boolean
  themeClassName?: string
  themeStyle?: CSSProperties
  /** Actions shown over the selection (editor). */
  selectionToolbar?: ReactNode
  emptyHint?: ReactNode
  /** A library entry dropped on the canvas (MIME `dropType`), at canvas px. */
  dropType?: string
  onDropWidget?: (value: string, point: { x: number; y: number }) => void
  className?: string
}

function frameOf(widget: Frame): Frame {
  return { x: widget.x, y: widget.y, w: widget.w, h: widget.h }
}

function boundsOf(frames: Frame[]) {
  const left = Math.min(...frames.map((frame) => frame.x))
  const top = Math.min(...frames.map((frame) => frame.y))
  const right = Math.max(...frames.map((frame) => frame.x + frame.w))
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.h))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/** Closest snap of any `moving` coordinate to any `targets` coordinate within `threshold`. */
function nearestSnap(moving: number[], targets: number[], threshold: number) {
  let best: { delta: number; at: number } | null = null
  for (const value of moving) {
    for (const target of targets) {
      const delta = target - value
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, at: target }
      }
    }
  }
  return best
}

/** Keep touch scrolling from fighting a drag; returns the undo. */
function lockBodyTouch() {
  const { style } = document.body
  const previous = style.touchAction
  style.touchAction = 'none'
  return () => { style.touchAction = previous }
}

/** Runtime image preview: the clicked image grows over a dimmed wallpaper; click or Escape closes it. */
function WallpaperImagePreviewOverlay({ image, onClose }: { image: WallpaperWidgetPreviewImage; onClose: () => void }) {
  const { t } = useI18n()
  const [visible, setVisible] = useState(false)
  const closingRef = useRef(false)
  const openMs = Math.min(1200, Math.max(80, Math.round(image.previewOpenDurationMs ?? 260)))
  const closeMs = Math.min(1200, Math.max(80, Math.round(image.previewCloseDurationMs ?? 260)))
  const [phase, setPhase] = useState<'open' | 'close'>('open')
  const duration = phase === 'close' ? closeMs : openMs
  const easing = getWallpaperAnimationEasingCss(phase === 'close' ? (image.previewCloseEasing ?? 'easeInOutCubic') : (image.previewOpenEasing ?? 'easeOutCubic'))
  const hiddenScale = Math.min(1, Math.max(0.6, ((phase === 'close' ? image.previewCloseScalePercent : image.previewOpenScalePercent) ?? 88) / 100))

  const close = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setPhase('close')
    setVisible(false)
    window.setTimeout(onClose, closeMs)
  }, [closeMs, onClose])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true))
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKey)
    }
  }, [close])

  return (
    <div
      className={cn('absolute inset-0 z-[5000] flex items-center justify-center bg-[color-mix(in_srgb,var(--background)_68%,transparent)] p-6 backdrop-blur-md transition-opacity', visible ? 'opacity-100' : 'opacity-0')}
      style={{ transitionDuration: `${duration}ms`, transitionTimingFunction: easing }}
      onClick={close}
    >
      {/* eslint-disable-next-line no-restricted-syntax -- wallpaper runtime preview: framed image art */}
      <button
        type="button"
        aria-label={t({ ko: '이미지 미리보기 닫기', en: 'Close image preview' })}
        onClick={(event) => { event.stopPropagation(); close() }}
        // eslint-disable-next-line no-restricted-syntax -- glass frame of the wallpaper image preview (artwork styling, not a scrim)
        className={cn('max-h-full max-w-full overflow-hidden rounded-[24px] border border-white/14 bg-black/14 shadow-[0_16px_40px_rgba(0,0,0,0.18),0_36px_96px_rgba(0,0,0,0.42)] transition-[transform,opacity] will-change-transform', visible ? 'opacity-100' : 'opacity-0')}
        style={{
          transitionDuration: `${duration}ms`,
          transitionTimingFunction: easing,
          transform: visible ? 'none' : `translate3d(0, 20px, 0) scale(${hiddenScale})`,
        }}
      >
        <ImagePreviewMedia image={image.image} alt={image.alt} className="block max-h-[84vh] max-w-[90vw] object-contain" loading="eager" />
      </button>
    </div>
  )
}

const MemoWidgetFrame = memo(WallpaperWidgetFrame)

/**
 * The wallpaper canvas. Widgets live in canvas px and are drawn in 1080p layout units, then the whole stage is
 * scaled to fit, so the editor shows exactly what the live page shows.
 */
export function WallpaperStage({
  layout,
  mode,
  zoom = 'fit',
  onZoomPercentChange,
  selectedIds = [],
  onSelectionChange,
  onCommitFrames,
  snap = true,
  themeClassName,
  themeStyle,
  selectionToolbar,
  emptyHint,
  dropType,
  onDropWidget,
  className,
}: WallpaperStageProps) {
  const { t } = useI18n()
  const isEditor = mode === 'editor'
  const canvas = getWallpaperLayoutCanvas(layout)
  const unit = getWallpaperCanvasScale(canvas)
  const layoutWidth = canvas.width / unit
  const layoutHeight = canvas.height / unit

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [draftFrames, setDraftFrames] = useState<Map<string, Frame> | null>(null)
  const draftRef = useRef<Map<string, Frame> | null>(null)
  const [marquee, setMarquee] = useState<Frame | null>(null)
  const [guides, setGuides] = useState<Guides>({ x: [], y: [] })
  const [previewImage, setPreviewImage] = useState<WallpaperWidgetPreviewImage | null>(null)

  useLayoutEffect(() => {
    const element = viewportRef.current
    if (!element) return undefined
    const measure = () => setViewport({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fitScale = viewport.width > 0 && viewport.height > 0
    ? Math.min(viewport.width / layoutWidth, viewport.height / layoutHeight)
    : 0
  /** Layout px → screen px. */
  const scale = zoom === 'fit' ? fitScale : zoom * unit
  /** Canvas px → screen px. */
  const k = scale / unit
  const stageWidth = layoutWidth * scale
  const stageHeight = layoutHeight * scale

  useEffect(() => {
    if (k > 0) onZoomPercentChange?.(Math.round(k * 100))
  }, [k, onZoomPercentChange])

  const widgets = useMemo(
    () => [...layout.widgets].filter((widget) => isEditor || !widget.hidden).sort((left, right) => left.zIndex - right.zIndex),
    [isEditor, layout.widgets],
  )
  const widgetById = useMemo(() => new Map(layout.widgets.map((widget) => [widget.id, widget])), [layout.widgets])
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const frameFor = useCallback((widget: WallpaperWidgetInstance) => draftFrames?.get(widget.id) ?? frameOf(widget), [draftFrames])

  /** Pointer position in canvas px. */
  const toCanvas = useCallback((clientX: number, clientY: number) => {
    const rect = layerRef.current?.getBoundingClientRect()
    if (!rect || k <= 0) return { x: 0, y: 0 }
    return { x: (clientX - rect.left) / k, y: (clientY - rect.top) / k }
  }, [k])

  const snapTargets = useCallback((excluded: Set<string>) => {
    const xs = [0, canvas.width / 2, canvas.width]
    const ys = [0, canvas.height / 2, canvas.height]
    for (const widget of layout.widgets) {
      if (excluded.has(widget.id) || widget.hidden) continue
      xs.push(widget.x, widget.x + widget.w / 2, widget.x + widget.w)
      ys.push(widget.y, widget.y + widget.h / 2, widget.y + widget.h)
    }
    return { xs, ys }
  }, [canvas.height, canvas.width, layout.widgets])

  const beginDrag = (next: Drag, target: Element) => {
    dragRef.current = next
    setDrag(next)
    ;(target as HTMLElement).setPointerCapture?.(next.pointerId)
  }

  const handleWidgetPointerDown = (event: ReactPointerEvent<HTMLDivElement>, widget: WallpaperWidgetInstance) => {
    if (!isEditor || event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    let nextSelection = selectedIds
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      nextSelection = selectedSet.has(widget.id) ? selectedIds.filter((id) => id !== widget.id) : [...selectedIds, widget.id]
    } else if (!selectedSet.has(widget.id)) {
      nextSelection = [widget.id]
    }
    onSelectionChange?.(nextSelection)
    const movable = nextSelection.map((id) => widgetById.get(id)).filter((item): item is WallpaperWidgetInstance => Boolean(item && !item.locked))
    if (!nextSelection.includes(widget.id) || movable.length === 0) return
    beginDrag({
      kind: 'move',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      ids: movable.map((item) => item.id),
      origin: new Map(movable.map((item) => [item.id, frameOf(item)])),
      active: false,
    }, event.currentTarget)
  }

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLElement>, widget: WallpaperWidgetInstance, handle: Handle) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    beginDrag({ kind: 'resize', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, id: widget.id, handle, origin: frameOf(widget) }, event.currentTarget)
  }

  const handleBackgroundPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isEditor || event.button !== 0) return
    const additive = event.shiftKey || event.ctrlKey || event.metaKey
    if (!additive) onSelectionChange?.([])
    const point = toCanvas(event.clientX, event.clientY)
    beginDrag({ kind: 'marquee', pointerId: event.pointerId, startX: point.x, startY: point.y, additive, base: additive ? selectedIds : [] }, event.currentTarget)
  }

  useEffect(() => {
    if (!drag) return undefined
    const threshold = SNAP_SCREEN_PX / Math.max(k, 0.0001)

    const onMove = (event: PointerEvent) => {
      const current = dragRef.current
      if (!current || event.pointerId !== current.pointerId) return

      if (current.kind === 'marquee') {
        const point = toCanvas(event.clientX, event.clientY)
        const rect = {
          x: Math.min(point.x, current.startX),
          y: Math.min(point.y, current.startY),
          w: Math.abs(point.x - current.startX),
          h: Math.abs(point.y - current.startY),
        }
        setMarquee(rect)
        const hits = layout.widgets.filter((widget) => !widget.hidden && widget.x < rect.x + rect.w && widget.x + widget.w > rect.x && widget.y < rect.y + rect.h && widget.y + widget.h > rect.y).map((widget) => widget.id)
        onSelectionChange?.([...new Set([...current.base, ...hits])])
        return
      }

      const dxScreen = event.clientX - current.startX
      const dyScreen = event.clientY - current.startY
      let dx = dxScreen / k
      let dy = dyScreen / k
      const snapping = snap && !event.altKey

      if (current.kind === 'move') {
        if (!current.active) {
          if (Math.hypot(dxScreen, dyScreen) < DRAG_START_PX) return
          current.active = true
        }
        const originFrames = [...current.origin.values()]
        const box = boundsOf(originFrames)
        // Keep the whole selection on the canvas.
        dx = Math.min(canvas.width - (box.x + box.w), Math.max(-box.x, dx))
        dy = Math.min(canvas.height - (box.y + box.h), Math.max(-box.y, dy))
        const nextGuides: Guides = { x: [], y: [] }
        if (snapping) {
          const targets = snapTargets(new Set(current.ids))
          const moved = { x: box.x + dx, y: box.y + dy }
          const sx = nearestSnap([moved.x, moved.x + box.w / 2, moved.x + box.w], targets.xs, threshold)
          const sy = nearestSnap([moved.y, moved.y + box.h / 2, moved.y + box.h], targets.ys, threshold)
          if (sx) { dx += sx.delta; nextGuides.x.push(sx.at) }
          if (sy) { dy += sy.delta; nextGuides.y.push(sy.at) }
        }
        const next = new Map<string, Frame>()
        current.origin.forEach((frame, id) => next.set(id, { ...frame, x: Math.round(frame.x + dx), y: Math.round(frame.y + dy) }))
        draftRef.current = next
        setDraftFrames(next)
        setGuides(nextGuides)
        return
      }

      // Resize one widget from the dragged handle.
      const widget = widgetById.get(current.id)
      if (!widget) return
      const min = getWallpaperWidgetMinSize(widget.type, canvas)
      const { origin, handle } = current
      const movesLeft = handle.includes('w')
      const movesRight = handle.includes('e')
      const movesTop = handle.includes('n')
      const movesBottom = handle.includes('s')
      let left = origin.x + (movesLeft ? dx : 0)
      let right = origin.x + origin.w + (movesRight ? dx : 0)
      let top = origin.y + (movesTop ? dy : 0)
      let bottom = origin.y + origin.h + (movesBottom ? dy : 0)
      const nextGuides: Guides = { x: [], y: [] }
      if (snapping) {
        const targets = snapTargets(new Set([widget.id]))
        if (movesLeft || movesRight) {
          const edge = movesLeft ? left : right
          const hit = nearestSnap([edge], targets.xs, threshold)
          if (hit) { if (movesLeft) left += hit.delta; else right += hit.delta; nextGuides.x.push(hit.at) }
        }
        if (movesTop || movesBottom) {
          const edge = movesTop ? top : bottom
          const hit = nearestSnap([edge], targets.ys, threshold)
          if (hit) { if (movesTop) top += hit.delta; else bottom += hit.delta; nextGuides.y.push(hit.at) }
        }
      }
      left = Math.max(0, left)
      top = Math.max(0, top)
      right = Math.min(canvas.width, right)
      bottom = Math.min(canvas.height, bottom)
      let w = right - left
      let h = bottom - top
      // Shift on a corner keeps the proportions.
      if (event.shiftKey && handle.length === 2) {
        const ratio = origin.w / origin.h
        if (w / h > ratio) w = h * ratio
        else h = w / ratio
        if (movesLeft) left = right - w
        if (movesTop) top = bottom - h
      }
      if (w < min.w) { w = min.w; if (movesLeft) left = right - w }
      if (h < min.h) { h = min.h; if (movesTop) top = bottom - h }
      const next = new Map([[widget.id, { x: Math.round(left), y: Math.round(top), w: Math.round(w), h: Math.round(h) }]])
      draftRef.current = next
      setDraftFrames(next)
      setGuides(nextGuides)
    }

    const onUp = (event: PointerEvent) => {
      const current = dragRef.current
      if (!current || event.pointerId !== current.pointerId) return
      const frames = draftRef.current
      dragRef.current = null
      draftRef.current = null
      setDrag(null)
      setDraftFrames(null)
      setMarquee(null)
      setGuides({ x: [], y: [] })
      if (frames && frames.size > 0 && current.kind !== 'marquee') onCommitFrames?.(frames)
    }

    const releaseTouch = lockBodyTouch()
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      releaseTouch()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [canvas, drag, k, layout.widgets, onCommitFrames, onSelectionChange, snap, snapTargets, toCanvas, widgetById])

  const selectedWidgets = selectedIds.map((id) => widgetById.get(id)).filter((widget): widget is WallpaperWidgetInstance => Boolean(widget))
  const selectionBox = selectedWidgets.length > 0 ? boundsOf(selectedWidgets.map((widget) => frameFor(widget))) : null
  const single = selectedWidgets.length === 1 ? selectedWidgets[0] : null
  const isDragging = drag !== null && (drag.kind !== 'move' || drag.active)
  const isEmpty = layout.widgets.length === 0

  const stage = (
    <div
      className={cn('relative shrink-0', isEditor ? 'shadow-elevation-2' : null)}
      style={{ width: stageWidth, height: stageHeight }}
    >
      <style>{WALLPAPER_ENTRANCE_KEYFRAMES + WALLPAPER_BACKGROUND_KEYFRAMES + '.wp-hit:hover{box-shadow:inset 0 0 0 calc(1.5px * var(--wp-inv)) color-mix(in srgb, var(--primary) 55%, transparent)}'}</style>
      <div
        ref={layerRef}
        className={cn('absolute left-0 top-0 origin-top-left overflow-hidden bg-background text-foreground', themeClassName)}
        style={{
          ...themeStyle,
          width: layoutWidth,
          height: layoutHeight,
          transform: `scale(${scale})`,
          ['--wp-inv' as string]: scale > 0 ? 1 / scale : 1,
        }}
        onPointerDown={handleBackgroundPointerDown}
        onDragOver={(event) => {
          if (dropType && onDropWidget && event.dataTransfer.types.includes(dropType)) {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={(event) => {
          const value = dropType ? event.dataTransfer.getData(dropType) : ''
          if (!value || !onDropWidget) return
          event.preventDefault()
          onDropWidget(value, toCanvas(event.clientX, event.clientY))
        }}
      >
        <WallpaperBackgroundLayer background={layout.background} />
        {widgets.map((widget) => {
          const frame = frameFor(widget)
          return (
            <div
              key={widget.id}
              className="absolute"
              style={{
                left: frame.x / unit,
                top: frame.y / unit,
                width: frame.w / unit,
                height: frame.h / unit,
                transform: widget.rotation ? `rotate(${widget.rotation}deg)` : undefined,
                opacity: isEditor && widget.hidden ? 0.25 : undefined,
              }}
            >
              <MemoWidgetFrame widget={widget} mode={mode} onOpenImage={isEditor ? undefined : setPreviewImage} animateEntrance={!isEditor} />
              {isEditor ? (
                <div
                  className={cn('wp-hit absolute inset-0', widget.locked ? 'cursor-default' : 'cursor-move')}
                  onPointerDown={(event) => handleWidgetPointerDown(event, widget)}
                />
              ) : null}
            </div>
          )
        })}
        {isEditor && isEmpty && emptyHint ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-lg text-muted-foreground">{emptyHint}</div>
        ) : null}
      </div>

      {isEditor ? (
        <div className="pointer-events-none absolute inset-0">
          {guides.x.map((x) => <div key={`gx-${x}`} className="absolute top-0 bottom-0 w-px bg-primary" style={{ left: x * k }} />)}
          {guides.y.map((y) => <div key={`gy-${y}`} className="absolute left-0 right-0 h-px bg-primary" style={{ top: y * k }} />)}
          {marquee ? (
            <div className="absolute border border-primary bg-primary/10" style={{ left: marquee.x * k, top: marquee.y * k, width: marquee.w * k, height: marquee.h * k }} />
          ) : null}
          {selectedWidgets.map((widget) => {
            const frame = frameFor(widget)
            return (
              <div
                key={widget.id}
                className={cn('absolute outline outline-[1.5px]', widget.locked ? 'outline-muted-foreground' : 'outline-primary')}
                style={{ left: frame.x * k, top: frame.y * k, width: frame.w * k, height: frame.h * k }}
              />
            )
          })}
          {single && !single.locked ? HANDLES.map((handle) => {
            const frame = frameFor(single)
            const cx = frame.x * k + (handle.includes('w') ? 0 : handle.includes('e') ? frame.w * k : (frame.w * k) / 2)
            const cy = frame.y * k + (handle.includes('n') ? 0 : handle.includes('s') ? frame.h * k : (frame.h * k) / 2)
            return (
              <div
                key={handle}
                className="pointer-events-auto absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-primary bg-background"
                style={{ left: cx, top: cy, cursor: HANDLE_CURSOR[handle] }}
                onPointerDown={(event) => handleResizePointerDown(event, single, handle)}
              />
            )
          }) : null}
          {selectionBox ? (
            <>
              {isDragging ? null : selectionToolbar ? (
                <div
                  className="pointer-events-auto absolute flex -translate-x-1/2 items-center gap-0.5 rounded-md bg-surface-high p-0.5 shadow-elevation-2"
                  style={{
                    left: Math.min(stageWidth - 8, Math.max(8, (selectionBox.x + selectionBox.w / 2) * k)),
                    top: selectionBox.y * k > 44 ? selectionBox.y * k - 40 : (selectionBox.y + selectionBox.h) * k + 26,
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  {selectionToolbar}
                </div>
              ) : null}
              <div
                className="absolute -translate-x-1/2 rounded-sm bg-primary px-1.5 py-0.5 font-mono text-2xs text-primary-foreground tabular-nums"
                style={{ left: (selectionBox.x + selectionBox.w / 2) * k, top: (selectionBox.y + selectionBox.h) * k + 6 }}
              >
                {single && (drag?.kind === 'move' && drag.active)
                  ? `${frameFor(single).x}, ${frameFor(single).y}`
                  : `${Math.round(selectionBox.w)} × ${Math.round(selectionBox.h)}`}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )

  return (
    <div
      ref={viewportRef}
      className={cn(
        'relative h-full w-full',
        isEditor ? (zoom === 'fit' ? 'flex items-center justify-center overflow-hidden' : 'grid place-items-center overflow-auto') : 'flex items-center justify-center overflow-hidden bg-black',
        className,
      )}
      aria-label={isEditor ? t({ ko: '월페이퍼 캔버스', en: 'Wallpaper canvas' }) : undefined}
    >
      {scale > 0 ? stage : null}
      {previewImage ? <WallpaperImagePreviewOverlay image={previewImage} onClose={() => setPreviewImage(null)} /> : null}
    </div>
  )
}
