import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { WallpaperAnimationEasing, WallpaperImageHoverMotion, WallpaperImageTransitionStyle } from './wallpaper-types'
import {
  evaluateWallpaperAnimationEasingAtTime,
  getWallpaperAnimationEasingCss,
  getWallpaperHoverMotionAmount,
  getWallpaperImageTransitionDurationMs,
  getWallpaperMotionStrengthMultiplier,
  normalizeWallpaperEasingStopPoints,
  resolveWallpaperHoverMotionMetrics,
  type WallpaperEasingStopPoint,
} from './wallpaper-widget-utils'

export type WallpaperEasingPreviewKind = 'transition' | 'hover' | 'motion'

export interface WallpaperEasingPreviewConfig {
  transitionDurationMs?: number
  transitionStyle?: WallpaperImageTransitionStyle
  hoverMotion?: WallpaperImageHoverMotion
  motionStrength?: number
  motionSpeed?: number
}

const GRAPH_SIZE = 304
const GRAPH_PADDING = 24
const GRAPH_VIEWBOX_SIZE = GRAPH_SIZE + (GRAPH_PADDING * 2)
export const WALLPAPER_EASING_GRAPH_RANGE_MIN_Y = -3
export const WALLPAPER_EASING_GRAPH_RANGE_MAX_Y = 3
const WALLPAPER_EASING_PREVIEW_GRAPH_WIDTH = 112
const WALLPAPER_EASING_PREVIEW_GRAPH_HEIGHT = 56
const WALLPAPER_EASING_PREVIEW_GRAPH_PADDING_X = 8
const WALLPAPER_EASING_PREVIEW_GRAPH_PADDING_Y = 6
const WALLPAPER_EASING_PREVIEW_GRAPH_SAMPLES = 28

// Clamp graph input values to the editable easing range.
function clampWallpaperEasingGraphValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

// Format graph point values for stable input and label rendering.
export function formatWallpaperEasingGraphPointValue(value: number) {
  return Number(value.toFixed(3))
}

// Clamp one editable easing point value based on its axis range.
export function clampWallpaperEasingStopPointValue(axis: 'x' | 'y', value: number) {
  return axis === 'x'
    ? clampWallpaperEasingGraphValue(value, 0, 1)
    : clampWallpaperEasingGraphValue(value, WALLPAPER_EASING_GRAPH_RANGE_MIN_Y, WALLPAPER_EASING_GRAPH_RANGE_MAX_Y)
}

// Map an easing X value into the graph viewport.
function mapWallpaperEasingGraphX(value: number) {
  return GRAPH_PADDING + (clampWallpaperEasingGraphValue(value, 0, 1) * GRAPH_SIZE)
}

// Map an easing Y value into the graph viewport.
function mapWallpaperEasingGraphY(value: number) {
  const normalized = (clampWallpaperEasingGraphValue(value, WALLPAPER_EASING_GRAPH_RANGE_MIN_Y, WALLPAPER_EASING_GRAPH_RANGE_MAX_Y) - WALLPAPER_EASING_GRAPH_RANGE_MIN_Y)
    / (WALLPAPER_EASING_GRAPH_RANGE_MAX_Y - WALLPAPER_EASING_GRAPH_RANGE_MIN_Y)
  return GRAPH_PADDING + ((1 - normalized) * GRAPH_SIZE)
}

// Convert pointer X coordinates back into easing graph space.
function unmapWallpaperEasingGraphX(value: number) {
  return clampWallpaperEasingGraphValue((value - GRAPH_PADDING) / GRAPH_SIZE, 0, 1)
}

// Convert pointer Y coordinates back into easing graph space.
function unmapWallpaperEasingGraphY(value: number) {
  const normalized = 1 - ((value - GRAPH_PADDING) / GRAPH_SIZE)
  return clampWallpaperEasingGraphValue(
    WALLPAPER_EASING_GRAPH_RANGE_MIN_Y + (normalized * (WALLPAPER_EASING_GRAPH_RANGE_MAX_Y - WALLPAPER_EASING_GRAPH_RANGE_MIN_Y)),
    WALLPAPER_EASING_GRAPH_RANGE_MIN_Y,
    WALLPAPER_EASING_GRAPH_RANGE_MAX_Y,
  )
}

// Convert one browser pointer event into SVG graph coordinates.
function getWallpaperEasingGraphPointerPosition(event: { clientX: number, clientY: number }, svgElement: SVGSVGElement) {
  const rect = svgElement.getBoundingClientRect()
  const scaleX = GRAPH_VIEWBOX_SIZE / Math.max(rect.width, 1)
  const scaleY = GRAPH_VIEWBOX_SIZE / Math.max(rect.height, 1)

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  }
}

// Describe the currently selected preview mode.
function getWallpaperEasingPreviewMeta(kind: WallpaperEasingPreviewKind) {
  switch (kind) {
    case 'hover':
      return {
        title: '호버 미리보기',
      }
    case 'motion':
      return {
        title: '모션 미리보기',
      }
    case 'transition':
    default:
      return {
        title: '전환 미리보기',
      }
  }
}

// Build preview keyframes per transition style so the modal matches runtime behavior more closely.
function getWallpaperTransitionPreviewKeyframes(
  transitionStyle: WallpaperImageTransitionStyle,
  layer: 'current' | 'previous',
): Array<Record<string, string | number>> {
  if (transitionStyle === 'none') {
    return layer === 'current'
      ? [
          { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
          { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
        ]
      : [
          { opacity: 0, transform: 'scale(1)', filter: 'blur(0px)' },
          { opacity: 0, transform: 'scale(1)', filter: 'blur(0px)' },
        ]
  }

  if (transitionStyle === 'fade') {
    return layer === 'current'
      ? [
          { opacity: 0, transform: 'scale(1.02)', filter: 'blur(3px)' },
          { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
        ]
      : [
          { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
          { opacity: 0, transform: 'scale(0.98)', filter: 'blur(4px)' },
        ]
  }

  if (transitionStyle === 'zoom') {
    return layer === 'current'
      ? [
          { opacity: 0, transform: 'scale(1.14)', filter: 'blur(2px)' },
          { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
        ]
      : [
          { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
          { opacity: 0, transform: 'scale(0.86)', filter: 'blur(3px)' },
        ]
  }

  if (transitionStyle === 'slide') {
    return layer === 'current'
      ? [
          { opacity: 0, transform: 'translateY(12px) scale(0.985)', filter: 'blur(2px)' },
          { opacity: 1, transform: 'translateY(0px) scale(1)', filter: 'blur(0px)' },
        ]
      : [
          { opacity: 1, transform: 'translateY(0px) scale(1)', filter: 'blur(0px)' },
          { opacity: 0, transform: 'translateY(-12px) scale(1.015)', filter: 'blur(4px)' },
        ]
  }

  if (transitionStyle === 'blur') {
    return layer === 'current'
      ? [
          { opacity: 0, transform: 'scale(1.035)', filter: 'blur(14px)' },
          { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
        ]
      : [
          { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
          { opacity: 0, transform: 'scale(0.97)', filter: 'blur(18px)' },
        ]
  }

  if (transitionStyle === 'flip') {
    return layer === 'current'
      ? [
          { opacity: 0, transform: 'perspective(1200px) rotateX(-84deg) scale(0.96)', filter: 'blur(2px)' },
          { opacity: 1, transform: 'perspective(1200px) rotateX(0deg) scale(1)', filter: 'blur(0px)' },
        ]
      : [
          { opacity: 1, transform: 'perspective(1200px) rotateX(0deg) scale(1)', filter: 'blur(0px)' },
          { opacity: 0, transform: 'perspective(1200px) rotateX(84deg) scale(1.03)', filter: 'blur(4px)' },
        ]
  }

  if (transitionStyle === 'shuffle') {
    return layer === 'current'
      ? [
          { opacity: 0, transform: 'translate(-12px, 8px) rotate(-3deg) scale(0.92)', filter: 'blur(4px)' },
          { opacity: 1, transform: 'translate(0px, 0px) rotate(0deg) scale(1)', filter: 'blur(0px)' },
        ]
      : [
          { opacity: 1, transform: 'translate(0px, 0px) rotate(0deg) scale(1)', filter: 'blur(0px)' },
          { opacity: 0, transform: 'translate(12px, -8px) rotate(3deg) scale(1.05)', filter: 'blur(5px)' },
        ]
  }

  return layer === 'current'
    ? [
        { opacity: 0, transform: 'translateY(2%) scale(0.9)', filter: 'blur(4px)' },
        { opacity: 1, transform: 'translateY(0px) scale(1)', filter: 'blur(0px)' },
      ]
    : [
        { opacity: 1, transform: 'translateY(0px) scale(1)', filter: 'blur(0px)' },
        { opacity: 0, transform: 'translateY(-2%) scale(1.08)', filter: 'blur(6px)' },
      ]
}

// Build sampled graph points for one easing preview thumbnail.
function sampleWallpaperEasingPreviewPoints(easing: WallpaperAnimationEasing | undefined) {
  return Array.from({ length: WALLPAPER_EASING_PREVIEW_GRAPH_SAMPLES }, (_, index) => {
    const time = index / (WALLPAPER_EASING_PREVIEW_GRAPH_SAMPLES - 1)
    return {
      x: time,
      y: evaluateWallpaperAnimationEasingAtTime(easing, time),
    }
  })
}

// Build the graph path and viewport range for one compact easing preview.
function buildWallpaperEasingPreviewGraph(points: Array<{ x: number, y: number }>) {
  const minSampleY = Math.min(0, ...points.map((point) => point.y))
  const maxSampleY = Math.max(1, ...points.map((point) => point.y))
  const verticalPadding = Math.max((maxSampleY - minSampleY) * 0.14, 0.08)
  const minY = minSampleY - verticalPadding
  const maxY = maxSampleY + verticalPadding
  const rangeY = Math.max(maxY - minY, 0.001)
  const width = WALLPAPER_EASING_PREVIEW_GRAPH_WIDTH
  const height = WALLPAPER_EASING_PREVIEW_GRAPH_HEIGHT

  const mapX = (value: number) => WALLPAPER_EASING_PREVIEW_GRAPH_PADDING_X + (value * (width - (WALLPAPER_EASING_PREVIEW_GRAPH_PADDING_X * 2)))
  const mapY = (value: number) => {
    const normalized = (value - minY) / rangeY
    return height - WALLPAPER_EASING_PREVIEW_GRAPH_PADDING_Y - (normalized * (height - (WALLPAPER_EASING_PREVIEW_GRAPH_PADDING_Y * 2)))
  }

  return {
    width,
    height,
    baselinePath: `M ${mapX(0)} ${mapY(0)} L ${mapX(1)} ${mapY(1)}`,
    pathData: points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${mapX(point.x)} ${mapY(point.y)}`).join(' '),
    horizontalGuideY: mapY(1),
  }
}

// Render a compact graph preview for one easing value.
export function WallpaperEasingGraphPreview({ easing, className }: { easing: WallpaperAnimationEasing | undefined, className?: string }) {
  const graph = useMemo(
    () => buildWallpaperEasingPreviewGraph(sampleWallpaperEasingPreviewPoints(easing)),
    [easing],
  )

  return (
    <svg
      viewBox={`0 0 ${graph.width} ${graph.height}`}
      aria-hidden="true"
      className={cn('block h-12 w-full', className)}
    >
      <line
        x1={WALLPAPER_EASING_PREVIEW_GRAPH_PADDING_X}
        y1={graph.horizontalGuideY}
        x2={graph.width - WALLPAPER_EASING_PREVIEW_GRAPH_PADDING_X}
        y2={graph.horizontalGuideY}
        stroke="color-mix(in srgb, var(--border) 72%, transparent)"
        strokeWidth="1"
      />
      <path
        d={graph.baselinePath}
        stroke="color-mix(in srgb, var(--muted-foreground) 46%, transparent)"
        strokeWidth="1.5"
        strokeDasharray="4 4"
        fill="none"
      />
      <path
        d={graph.pathData}
        stroke="var(--primary)"
        strokeWidth="2.75"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

// Render the editable multi-point easing graph with draggable stop points.
export function WallpaperEasingGraph({
  value,
  onChange,
  selectedIndex = null,
  onSelectIndex,
}: {
  value: WallpaperEasingStopPoint[]
  onChange: (value: WallpaperEasingStopPoint[]) => void
  selectedIndex?: number | null
  onSelectIndex?: (index: number | null) => void
}) {
  const graphRef = useRef<SVGSVGElement | null>(null)
  const [dragState, setDragState] = useState<{
    index: number
    pointerId: number
    offsetX: number
    offsetY: number
  } | null>(null)

  useEffect(() => {
    if (!dragState) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return
      }

      const svgElement = graphRef.current
      if (!svgElement) {
        return
      }

      const pointerPosition = getWallpaperEasingGraphPointerPosition(event, svgElement)
      const previousPoint = value[dragState.index - 1]
      const nextPoint = value[dragState.index + 1]
      const nextX = clampWallpaperEasingGraphValue(
        unmapWallpaperEasingGraphX(pointerPosition.x - dragState.offsetX),
        (previousPoint?.x ?? 0) + 0.02,
        (nextPoint?.x ?? 1) - 0.02,
      )
      const nextY = unmapWallpaperEasingGraphY(pointerPosition.y - dragState.offsetY)

      onChange(value.map((point, index) => (
        index === dragState.index
          ? { x: nextX, y: nextY }
          : point
      )))
    }

    const stopDragging = (event: PointerEvent) => {
      if (event.pointerId === dragState.pointerId) {
        setDragState(null)
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopDragging)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopDragging)
    }
  }, [dragState, onChange, value])

  const normalizedPoints = normalizeWallpaperEasingStopPoints(value)
  const path = normalizedPoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${mapWallpaperEasingGraphX(point.x)} ${mapWallpaperEasingGraphY(point.y)}`)
    .join(' ')

  const handleAdjustSelectedPoint = (axis: 'x' | 'y', direction: -1 | 1, accelerated = false) => {
    if (selectedIndex === null || selectedIndex <= 0 || selectedIndex >= normalizedPoints.length - 1) {
      return
    }

    const step = axis === 'x'
      ? accelerated ? 0.05 : 0.01
      : accelerated ? 0.1 : 0.01
    const currentPoint = normalizedPoints[selectedIndex]
    const previousPoint = normalizedPoints[selectedIndex - 1]
    const nextPoint = normalizedPoints[selectedIndex + 1]
    const nextValue = currentPoint[axis] + (direction * step)

    onChange(normalizedPoints.map((point, index) => {
      if (index !== selectedIndex) {
        return point
      }

      if (axis === 'x') {
        return {
          ...point,
          x: clampWallpaperEasingGraphValue(nextValue, previousPoint.x + 0.02, nextPoint.x - 0.02),
        }
      }

      return {
        ...point,
        y: clampWallpaperEasingStopPointValue('y', nextValue),
      }
    }))
  }

  const handleAddPoint = () => {
    let widestSegmentIndex = 0
    let widestSegmentWidth = 0

    for (let index = 1; index < normalizedPoints.length; index += 1) {
      const previous = normalizedPoints[index - 1]
      const current = normalizedPoints[index]
      const width = current.x - previous.x
      if (width > widestSegmentWidth) {
        widestSegmentWidth = width
        widestSegmentIndex = index
      }
    }

    const previous = normalizedPoints[widestSegmentIndex - 1] ?? normalizedPoints[0]
    const current = normalizedPoints[widestSegmentIndex] ?? normalizedPoints[normalizedPoints.length - 1]
    const insertedPoint = {
      x: (previous.x + current.x) / 2,
      y: (previous.y + current.y) / 2,
    }

    onChange([
      ...normalizedPoints.slice(0, widestSegmentIndex),
      insertedPoint,
      ...normalizedPoints.slice(widestSegmentIndex),
    ])
    onSelectIndex?.(widestSegmentIndex)
  }

  const handleGraphDoubleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    const svgElement = graphRef.current
    if (!svgElement) {
      return
    }

    const pointerPosition = getWallpaperEasingGraphPointerPosition(event, svgElement)
    const insertedPoint = {
      x: unmapWallpaperEasingGraphX(pointerPosition.x),
      y: unmapWallpaperEasingGraphY(pointerPosition.y),
    }

    const nextPoints = normalizeWallpaperEasingStopPoints([...normalizedPoints, insertedPoint])
    const insertedIndex = nextPoints.findIndex(
      (point, index) => index > 0 && index < nextPoints.length - 1 && point.x >= insertedPoint.x,
    )

    onChange(nextPoints)
    onSelectIndex?.(insertedIndex >= 0 ? insertedIndex : Math.max(1, nextPoints.length - 2))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>그래프 편집</span>
        <div className="flex items-center gap-2">
          <span>빈 곳 더블클릭 추가, 점 더블클릭/우클릭 삭제</span>
          <Button type="button" size="xs" variant="ghost" onClick={handleAddPoint}>점 추가</Button>
        </div>
      </div>
      <svg
        ref={graphRef}
        viewBox={`0 0 ${GRAPH_VIEWBOX_SIZE} ${GRAPH_VIEWBOX_SIZE}`}
        className="h-[352px] w-full rounded-sm border border-border bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--primary)_10%,transparent),transparent_45%),var(--surface-low)]"
        tabIndex={0}
        onDoubleClick={handleGraphDoubleClick}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            handleAdjustSelectedPoint('x', -1, event.shiftKey)
          }
          else if (event.key === 'ArrowRight') {
            event.preventDefault()
            handleAdjustSelectedPoint('x', 1, event.shiftKey)
          }
          else if (event.key === 'ArrowUp') {
            event.preventDefault()
            handleAdjustSelectedPoint('y', 1, event.shiftKey)
          }
          else if (event.key === 'ArrowDown') {
            event.preventDefault()
            handleAdjustSelectedPoint('y', -1, event.shiftKey)
          }
          else if ((event.key === 'Backspace' || event.key === 'Delete') && selectedIndex !== null && selectedIndex > 0 && selectedIndex < normalizedPoints.length - 1) {
            event.preventDefault()
            const nextPoints = normalizedPoints.filter((_, pointIndex) => pointIndex !== selectedIndex)
            onChange(nextPoints)
            onSelectIndex?.(nextPoints.length > 2 ? Math.min(selectedIndex, nextPoints.length - 2) : null)
          }
        }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((line) => {
          const x = mapWallpaperEasingGraphX(line)
          const y = GRAPH_PADDING + (line * GRAPH_SIZE)
          return (
            <g key={line}>
              <line x1={x} y1={GRAPH_PADDING} x2={x} y2={GRAPH_PADDING + GRAPH_SIZE} stroke="color-mix(in srgb, var(--border) 72%, transparent)" strokeWidth="1" />
              <line x1={GRAPH_PADDING} y1={y} x2={GRAPH_PADDING + GRAPH_SIZE} y2={y} stroke="color-mix(in srgb, var(--border) 72%, transparent)" strokeWidth="1" />
            </g>
          )
        })}

        <text x={GRAPH_PADDING} y={18} className="fill-muted-foreground text-[11px]">빠름</text>
        <text x={GRAPH_PADDING} y={GRAPH_SIZE + (GRAPH_PADDING * 2) - 8} className="fill-muted-foreground text-[11px]">눌림</text>
        <text x={GRAPH_SIZE + GRAPH_PADDING - 14} y={GRAPH_SIZE + (GRAPH_PADDING * 2) - 8} className="fill-muted-foreground text-[11px]">시간</text>

        <path d={`M ${mapWallpaperEasingGraphX(0)} ${mapWallpaperEasingGraphY(0)} L ${mapWallpaperEasingGraphX(1)} ${mapWallpaperEasingGraphY(1)}`} stroke="color-mix(in srgb, var(--muted-foreground) 48%, transparent)" strokeDasharray="5 6" strokeWidth="1.5" fill="none" />
        <path d={path} stroke="var(--primary)" strokeWidth="4" fill="none" />

        {normalizedPoints.map((point, index) => {
          const pointX = mapWallpaperEasingGraphX(point.x)
          const pointY = mapWallpaperEasingGraphY(point.y)
          const isEndpoint = index === 0 || index === normalizedPoints.length - 1
          const isSelected = selectedIndex === index
          const label = index === 0 ? '시작' : index === normalizedPoints.length - 1 ? '끝' : `P${index}`
          const valueText = `${formatWallpaperEasingGraphPointValue(point.x)}, ${formatWallpaperEasingGraphPointValue(point.y)}`

          return (
            <g key={`${index}-${point.x}-${point.y}`}>
              <circle cx={pointX} cy={pointY} r={isEndpoint ? 8 : isSelected ? 22 : 18} fill={isEndpoint ? 'color-mix(in srgb, var(--muted-foreground) 22%, transparent)' : isSelected ? 'color-mix(in srgb, var(--primary) 20%, transparent)' : 'color-mix(in srgb, var(--primary) 12%, transparent)'} />
              <circle cx={pointX} cy={pointY} r={isEndpoint ? 6 : 12} fill={isEndpoint ? 'var(--muted-foreground)' : 'color-mix(in srgb, var(--primary) 22%, var(--background))'} stroke={isEndpoint ? 'transparent' : 'var(--primary)'} strokeWidth={isEndpoint ? 0 : isSelected ? 3.5 : 2.5} opacity={isEndpoint ? 0.72 : 1} />
              {!isEndpoint ? (
                <circle
                  cx={pointX}
                  cy={pointY}
                  r="18"
                  fill="transparent"
                  className="cursor-grab touch-none active:cursor-grabbing"
                  onDoubleClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    const nextPoints = normalizedPoints.filter((_, pointIndex) => pointIndex !== index)
                    onChange(nextPoints)
                    onSelectIndex?.(nextPoints.length > 2 ? Math.min(index, nextPoints.length - 2) : null)
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    const nextPoints = normalizedPoints.filter((_, pointIndex) => pointIndex !== index)
                    onChange(nextPoints)
                    onSelectIndex?.(nextPoints.length > 2 ? Math.min(index, nextPoints.length - 2) : null)
                  }}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    const svgElement = graphRef.current
                    if (!svgElement) {
                      return
                    }

                    const pointerPosition = getWallpaperEasingGraphPointerPosition(event, svgElement)
                    onSelectIndex?.(index)
                    graphRef.current?.focus()
                    event.currentTarget.setPointerCapture?.(event.pointerId)
                    setDragState({
                      index,
                      pointerId: event.pointerId,
                      offsetX: pointerPosition.x - pointX,
                      offsetY: pointerPosition.y - pointY,
                    })
                  }}
                />
              ) : null}
              <text x={pointX} y={pointY - 24} textAnchor="middle" className={isSelected ? 'fill-primary text-[11px] font-semibold' : 'fill-foreground text-[11px] font-semibold'}>
                {label}
              </text>
              <text x={pointX} y={pointY + 31} textAnchor="middle" className={isSelected ? 'fill-primary text-[10px] font-medium' : 'fill-muted-foreground text-[10px] font-medium'}>
                {valueText}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// Render one animated preview surface for the current easing value.
function WallpaperEasingPreview({ easing, kind, config }: { easing: WallpaperAnimationEasing, kind: WallpaperEasingPreviewKind, config?: WallpaperEasingPreviewConfig }) {
  const [replayCount, setReplayCount] = useState(0)
  const easingCss = useMemo(() => getWallpaperAnimationEasingCss(easing), [easing])
  const motionTrackRef = useRef<HTMLDivElement | null>(null)
  const motionDotRef = useRef<HTMLDivElement | null>(null)
  const hoverCardRef = useRef<HTMLDivElement | null>(null)
  const transitionIncomingRef = useRef<HTMLDivElement | null>(null)
  const transitionOutgoingRef = useRef<HTMLDivElement | null>(null)
  const meta = getWallpaperEasingPreviewMeta(kind)
  const transitionStyle = config?.transitionStyle ?? 'fade'
  const transitionDurationMs = config?.transitionDurationMs ?? getWallpaperImageTransitionDurationMs('normal')
  const hoverMetrics = useMemo(() => resolveWallpaperHoverMotionMetrics(config?.hoverMotion), [config?.hoverMotion])
  const motionStrength = getWallpaperMotionStrengthMultiplier(config?.motionStrength ?? 1)
  const motionSpeed = Math.min(20, Math.max(0.2, config?.motionSpeed ?? 1))
  const motionDurationMs = Math.round(Math.min(2200, Math.max(320, 1100 / motionSpeed)))
  const motionScale = 1 + (Math.min(motionStrength, 2.5) * 0.035)
  const showCombinedMotionPreview = kind !== 'motion'
  const primaryDurationMs = kind === 'transition' ? transitionDurationMs : kind === 'hover' ? 220 : motionDurationMs

  useEffect(() => {
    const trackWidth = Math.max((motionTrackRef.current?.clientWidth ?? 0) - 24, 0)
    const dotElement = motionDotRef.current
    if (dotElement) {
      dotElement.getAnimations().forEach((animation) => animation.cancel())
      dotElement.animate(
        [
          { transform: 'translate(0px, -50%) scale(1)' },
          { transform: `translate(${trackWidth}px, -50%) scale(${motionScale})` },
        ],
        {
          duration: primaryDurationMs,
          fill: 'forwards',
          easing: easingCss,
        },
      )
    }

    if (kind === 'motion') {
      return
    }

    if (kind === 'hover') {
      const hoverCard = hoverCardRef.current
      if (!hoverCard) {
        return
      }

      hoverCard.getAnimations().forEach((animation) => animation.cancel())
      hoverCard.animate(
        [
          { transform: 'scale(1)', boxShadow: '0 10px 24px rgba(0,0,0,0.18)' },
          { transform: `scale(${hoverMetrics.surfaceScale})`, boxShadow: hoverMetrics.surfaceShadow },
        ],
        {
          duration: 220,
          direction: 'alternate',
          fill: 'forwards',
          easing: easingCss,
        },
      )
      return
    }

    const incoming = transitionIncomingRef.current
    const outgoing = transitionOutgoingRef.current
    if (!incoming || !outgoing) {
      return
    }

    incoming.getAnimations().forEach((animation) => animation.cancel())
    outgoing.getAnimations().forEach((animation) => animation.cancel())

    outgoing.animate(
      getWallpaperTransitionPreviewKeyframes(transitionStyle, 'previous'),
      {
        duration: transitionDurationMs,
        fill: 'forwards',
        easing: easingCss,
      },
    )

    incoming.animate(
      getWallpaperTransitionPreviewKeyframes(transitionStyle, 'current'),
      {
        duration: transitionDurationMs,
        fill: 'forwards',
        easing: easingCss,
      },
    )
  }, [easingCss, hoverMetrics.surfaceScale, hoverMetrics.surfaceShadow, kind, motionDurationMs, motionScale, primaryDurationMs, replayCount, transitionDurationMs, transitionStyle])

  return (
    <div className="theme-settings-panel rounded-sm bg-surface-container p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-foreground">{meta.title}</div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
            {kind === 'transition' ? <span className="rounded-sm border border-border/70 bg-background/70 px-1.5 py-0.5">{transitionDurationMs}ms</span> : null}
            {kind === 'transition' && config?.transitionStyle ? <span className="rounded-sm border border-border/70 bg-background/70 px-1.5 py-0.5">{config.transitionStyle}</span> : null}
            {kind === 'hover' ? <span className="rounded-sm border border-border/70 bg-background/70 px-1.5 py-0.5">강도 {getWallpaperHoverMotionAmount(config?.hoverMotion ?? 1).toFixed(1)}</span> : null}
            <span className="rounded-sm border border-border/70 bg-background/70 px-1.5 py-0.5">모션 강도 {motionStrength.toFixed(1)}</span>
            <span className="rounded-sm border border-border/70 bg-background/70 px-1.5 py-0.5">모션 속도 {motionSpeed.toFixed(1)}</span>
          </div>
        </div>
        <Button type="button" size="xs" variant="ghost" onClick={() => setReplayCount((current) => current + 1)}>
          다시 재생
        </Button>
      </div>

      <div className={cn(
        'relative overflow-hidden rounded-sm border border-border/70 bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--secondary)_12%,transparent),transparent_45%),var(--background)]',
        showCombinedMotionPreview ? 'h-44' : 'h-28',
      )}>
        {kind === 'hover' ? (
          <div className="absolute inset-x-0 top-0 flex h-[64%] items-center justify-center">
            <div className="relative h-16 w-24">
              <div
                ref={hoverCardRef}
                className="absolute inset-0 rounded-xl border border-white/15 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--primary)_20%,transparent),color-mix(in_srgb,var(--secondary)_18%,transparent)),var(--surface-high)] shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
              />
            </div>
          </div>
        ) : null}

        {kind === 'transition' ? (
          <div className="absolute inset-x-0 top-0 flex h-[64%] items-center justify-center">
            <div className="relative h-16 w-24">
              <div
                ref={transitionOutgoingRef}
                className="absolute inset-0 rounded-xl border border-white/12 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--muted)_18%,transparent),transparent),var(--surface-low)] shadow-[0_12px_28px_rgba(0,0,0,0.16)]"
              />
              <div
                ref={transitionIncomingRef}
                className="absolute inset-0 rounded-xl border border-white/15 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--primary)_22%,transparent),color-mix(in_srgb,var(--secondary)_16%,transparent)),var(--surface-high)] shadow-[0_12px_34px_rgba(0,0,0,0.22)]"
                style={{ opacity: 0 }}
              />
            </div>
          </div>
        ) : null}

        <div className={cn('absolute inset-x-0', showCombinedMotionPreview ? 'bottom-2 h-[36%]' : 'inset-y-0')}>
          <div ref={motionTrackRef} className="absolute inset-x-4 top-1/2 h-10 -translate-y-1/2">
            <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-border/70" />
            <div
              ref={motionDotRef}
              className="absolute left-0 top-1/2 h-6 w-6 rounded-full border border-primary/60 bg-primary shadow-[0_0_22px_color-mix(in_srgb,var(--primary)_32%,transparent)]"
              style={{ transform: 'translate(0px, -50%)' }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// Render the shared preview area and its mode switcher.
export function WallpaperEasingPreviewPanel({
  previewKind,
  easing,
  config,
  editorContent,
  extraContent,
}: {
  previewKind: WallpaperEasingPreviewKind
  easing: WallpaperAnimationEasing
  config?: WallpaperEasingPreviewConfig
  editorContent?: ReactNode
  extraContent?: ReactNode
}) {
  return (
    <div className="space-y-4">
      {editorContent}
      <WallpaperEasingPreview easing={easing} kind={previewKind} config={config} />
      {extraContent}
    </div>
  )
}
