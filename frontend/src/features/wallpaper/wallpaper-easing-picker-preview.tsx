import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { WallpaperAnimationEasing } from './wallpaper-types'
import { getWallpaperAnimationEasingCss, type WallpaperBezierControlPoints } from './wallpaper-widget-utils'

export type WallpaperEasingPreviewKind = 'transition' | 'hover' | 'motion'

const GRAPH_SIZE = 304
const GRAPH_PADDING = 24
export const WALLPAPER_EASING_GRAPH_RANGE_MIN_Y = -1
export const WALLPAPER_EASING_GRAPH_RANGE_MAX_Y = 2

// Clamp graph input values to the editable easing range.
function clampWallpaperEasingGraphValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

// Format graph point values for stable input and label rendering.
export function formatWallpaperEasingGraphPointValue(value: number) {
  return Number(value.toFixed(3))
}

// Clamp one bezier control point based on its axis range.
export function clampWallpaperBezierControlPointValue(key: keyof WallpaperBezierControlPoints, value: number) {
  return key === 'x1' || key === 'x2'
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

// Describe the currently selected preview mode.
function getWallpaperEasingPreviewMeta(kind: WallpaperEasingPreviewKind) {
  switch (kind) {
    case 'hover':
      return {
        title: '호버 미리보기',
        description: '살짝 닿았을 때 커지는 느낌과 반응 속도를 봐.',
      }
    case 'motion':
      return {
        title: '모션 미리보기',
        description: '계속 움직이는 요소가 얼마나 밀고 당기는지 확인해.',
      }
    case 'transition':
    default:
      return {
        title: '전환 미리보기',
        description: '이미지나 카드가 바뀔 때 들어오는 감각을 확인해.',
      }
  }
}

// Render the editable cubic-bezier graph with draggable control points.
export function WallpaperEasingGraph({
  value,
  onChange,
}: {
  value: WallpaperBezierControlPoints
  onChange: (value: WallpaperBezierControlPoints) => void
}) {
  const graphRef = useRef<SVGSVGElement | null>(null)
  const [dragHandle, setDragHandle] = useState<'p1' | 'p2' | null>(null)

  useEffect(() => {
    if (!dragHandle) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      const rect = graphRef.current?.getBoundingClientRect()
      if (!rect) {
        return
      }

      const nextX = unmapWallpaperEasingGraphX(event.clientX - rect.left)
      const nextY = unmapWallpaperEasingGraphY(event.clientY - rect.top)
      onChange({
        ...value,
        ...(dragHandle === 'p1' ? { x1: nextX, y1: nextY } : { x2: nextX, y2: nextY }),
      })
    }

    const stopDragging = () => {
      setDragHandle(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopDragging)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopDragging)
    }
  }, [dragHandle, onChange, value])

  const startPoint = { x: mapWallpaperEasingGraphX(0), y: mapWallpaperEasingGraphY(0) }
  const endPoint = { x: mapWallpaperEasingGraphX(1), y: mapWallpaperEasingGraphY(1) }
  const controlOne = { x: mapWallpaperEasingGraphX(value.x1), y: mapWallpaperEasingGraphY(value.y1) }
  const controlTwo = { x: mapWallpaperEasingGraphX(value.x2), y: mapWallpaperEasingGraphY(value.y2) }
  const path = `M ${startPoint.x} ${startPoint.y} C ${controlOne.x} ${controlOne.y}, ${controlTwo.x} ${controlTwo.y}, ${endPoint.x} ${endPoint.y}`

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>그래프 편집</span>
        <span>드래그로 곡선 조절</span>
      </div>
      <svg
        ref={graphRef}
        viewBox={`0 0 ${GRAPH_SIZE + (GRAPH_PADDING * 2)} ${GRAPH_SIZE + (GRAPH_PADDING * 2)}`}
        className="h-[352px] w-full rounded-sm border border-border bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--primary)_10%,transparent),transparent_45%),var(--surface-low)]"
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

        <path d={`M ${startPoint.x} ${startPoint.y} L ${endPoint.x} ${endPoint.y}`} stroke="color-mix(in srgb, var(--muted-foreground) 48%, transparent)" strokeDasharray="5 6" strokeWidth="1.5" fill="none" />
        <path d={path} stroke="var(--primary)" strokeWidth="4" fill="none" />
        <line x1={startPoint.x} y1={startPoint.y} x2={controlOne.x} y2={controlOne.y} stroke="color-mix(in srgb, var(--secondary) 62%, transparent)" strokeWidth="2" />
        <line x1={endPoint.x} y1={endPoint.y} x2={controlTwo.x} y2={controlTwo.y} stroke="color-mix(in srgb, var(--secondary) 62%, transparent)" strokeWidth="2" />

        <circle cx={startPoint.x} cy={startPoint.y} r="6" fill="var(--muted-foreground)" opacity="0.72" />
        <circle cx={endPoint.x} cy={endPoint.y} r="6" fill="var(--muted-foreground)" opacity="0.72" />

        {[
          { id: 'p1', point: controlOne, label: 'P1', valueText: `${formatWallpaperEasingGraphPointValue(value.x1)}, ${formatWallpaperEasingGraphPointValue(value.y1)}` },
          { id: 'p2', point: controlTwo, label: 'P2', valueText: `${formatWallpaperEasingGraphPointValue(value.x2)}, ${formatWallpaperEasingGraphPointValue(value.y2)}` },
        ].map((handle) => (
          <g key={handle.id}>
            <circle cx={handle.point.x} cy={handle.point.y} r="18" fill="color-mix(in srgb, var(--primary) 12%, transparent)" />
            <circle cx={handle.point.x} cy={handle.point.y} r="12" fill="color-mix(in srgb, var(--primary) 22%, var(--background))" stroke="var(--primary)" strokeWidth="2.5" />
            <circle
              cx={handle.point.x}
              cy={handle.point.y}
              r="18"
              fill="transparent"
              className="cursor-grab active:cursor-grabbing"
              onPointerDown={(event) => {
                event.preventDefault()
                setDragHandle(handle.id as 'p1' | 'p2')
              }}
            />
            <text x={handle.point.x} y={handle.point.y - 24} textAnchor="middle" className="fill-foreground text-[11px] font-semibold">
              {handle.label}
            </text>
            <text x={handle.point.x} y={handle.point.y + 31} textAnchor="middle" className="fill-muted-foreground text-[10px] font-medium">
              {handle.valueText}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

// Render one animated preview surface for the current easing value.
function WallpaperEasingPreview({ easing, kind }: { easing: WallpaperAnimationEasing, kind: WallpaperEasingPreviewKind }) {
  const [replayCount, setReplayCount] = useState(0)
  const easingCss = useMemo(() => getWallpaperAnimationEasingCss(easing), [easing])
  const motionTrackRef = useRef<HTMLDivElement | null>(null)
  const motionDotRef = useRef<HTMLDivElement | null>(null)
  const hoverCardRef = useRef<HTMLDivElement | null>(null)
  const transitionIncomingRef = useRef<HTMLDivElement | null>(null)
  const transitionOutgoingRef = useRef<HTMLDivElement | null>(null)
  const meta = getWallpaperEasingPreviewMeta(kind)

  useEffect(() => {
    if (kind === 'motion') {
      const trackWidth = Math.max((motionTrackRef.current?.clientWidth ?? 0) - 24, 0)
      const dotElement = motionDotRef.current
      if (!dotElement) {
        return
      }

      dotElement.getAnimations().forEach((animation) => animation.cancel())
      dotElement.animate(
        [
          { transform: 'translate(0px, -50%) scale(1)' },
          { transform: `translate(${trackWidth}px, -50%) scale(1.04)` },
        ],
        {
          duration: 950,
          fill: 'forwards',
          easing: easingCss,
        },
      )
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
          { transform: 'translate(-50%, -50%) scale(1)', boxShadow: '0 10px 24px rgba(0,0,0,0.18)' },
          { transform: 'translate(-50%, -50%) scale(1.1)', boxShadow: '0 22px 52px rgba(0,0,0,0.3)' },
        ],
        {
          duration: 780,
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
      [
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', filter: 'blur(0px)' },
        { opacity: 0, transform: 'translate(-50%, -50%) scale(0.94)', filter: 'blur(10px)' },
      ],
      {
        duration: 820,
        fill: 'forwards',
        easing: easingCss,
      },
    )

    incoming.animate(
      [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1.06)', filter: 'blur(8px)' },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', filter: 'blur(0px)' },
      ],
      {
        duration: 820,
        fill: 'forwards',
        easing: easingCss,
      },
    )
  }, [easingCss, kind, replayCount])

  return (
    <div className="rounded-sm border border-border bg-surface-low p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-foreground">{meta.title}</div>
          <div className="text-[11px] text-muted-foreground">{meta.description}</div>
        </div>
        <button type="button" className="text-xs text-secondary hover:text-foreground" onClick={() => setReplayCount((current) => current + 1)}>
          다시 재생
        </button>
      </div>

      <div className="relative h-28 overflow-hidden rounded-sm border border-border/70 bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--secondary)_12%,transparent),transparent_45%),var(--background)]">
        {kind === 'motion' ? (
          <div ref={motionTrackRef} className="absolute inset-y-0 left-4 right-4">
            <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-border/70" />
            <div
              ref={motionDotRef}
              className="absolute left-0 top-1/2 h-6 w-6 rounded-full border border-primary/60 bg-primary shadow-[0_0_22px_color-mix(in_srgb,var(--primary)_32%,transparent)]"
              style={{ transform: 'translate(0px, -50%)' }}
            />
          </div>
        ) : null}

        {kind === 'hover' ? (
          <div
            ref={hoverCardRef}
            className="absolute left-1/2 top-1/2 flex h-16 w-24 -translate-x-1/2 -translate-y-1/2 items-end rounded-xl border border-white/15 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--primary)_20%,transparent),color-mix(in_srgb,var(--secondary)_18%,transparent)),var(--surface-high)] p-3 text-xs font-medium text-foreground shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
          >
            Hover
          </div>
        ) : null}

        {kind === 'transition' ? (
          <>
            <div
              ref={transitionOutgoingRef}
              className="absolute left-1/2 top-1/2 flex h-16 w-24 -translate-x-1/2 -translate-y-1/2 items-end rounded-xl border border-white/12 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--muted)_18%,transparent),transparent),var(--surface-low)] p-3 text-xs font-medium text-muted-foreground shadow-[0_12px_28px_rgba(0,0,0,0.16)]"
            >
              이전
            </div>
            <div
              ref={transitionIncomingRef}
              className="absolute left-1/2 top-1/2 flex h-16 w-24 -translate-x-1/2 -translate-y-1/2 items-end rounded-xl border border-white/15 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--primary)_22%,transparent),color-mix(in_srgb,var(--secondary)_16%,transparent)),var(--surface-high)] p-3 text-xs font-medium text-foreground shadow-[0_12px_34px_rgba(0,0,0,0.22)]"
              style={{ opacity: 0 }}
            >
              현재
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

// Render the shared preview area and its mode switcher.
export function WallpaperEasingPreviewPanel({
  activePreviewKind,
  easing,
  onChangePreviewKind,
  extraContent,
}: {
  activePreviewKind: WallpaperEasingPreviewKind
  easing: WallpaperAnimationEasing
  onChangePreviewKind: (kind: WallpaperEasingPreviewKind) => void
  extraContent?: ReactNode
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {([
          ['transition', '전환'],
          ['hover', '호버'],
          ['motion', '모션'],
        ] as const).map(([kind, label]) => (
          <Button
            key={kind}
            type="button"
            size="xs"
            variant={activePreviewKind === kind ? 'default' : 'ghost'}
            onClick={() => onChangePreviewKind(kind)}
          >
            {label}
          </Button>
        ))}
      </div>

      <WallpaperEasingPreview easing={easing} kind={activePreviewKind} />
      {extraContent}
    </div>
  )
}
