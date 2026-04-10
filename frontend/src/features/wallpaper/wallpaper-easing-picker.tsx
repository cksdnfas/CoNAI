import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { cn } from '@/lib/utils'
import type { WallpaperAnimationEasing, WallpaperAnimationEasingPreset } from './wallpaper-types'
import {
  WALLPAPER_ANIMATION_EASING_OPTIONS,
  buildWallpaperCubicBezierEasing,
  getWallpaperAnimationEasingCss,
  getWallpaperAnimationEasingLabel,
  getWallpaperEditableBezierControlPoints,
  normalizeWallpaperAnimationEasing,
  type WallpaperBezierControlPoints,
} from './wallpaper-widget-utils'

interface WallpaperEasingPickerProps {
  value: WallpaperAnimationEasing | undefined
  fallbackPreset?: WallpaperAnimationEasingPreset
  onChange: (value: WallpaperAnimationEasing) => void
}

const GRAPH_SIZE = 240
const GRAPH_PADDING = 18
const GRAPH_RANGE_MIN_Y = -1
const GRAPH_RANGE_MAX_Y = 2

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function formatPointValue(value: number) {
  return Number(value.toFixed(3))
}

function mapGraphX(value: number) {
  return GRAPH_PADDING + (clamp(value, 0, 1) * GRAPH_SIZE)
}

function mapGraphY(value: number) {
  const normalized = (clamp(value, GRAPH_RANGE_MIN_Y, GRAPH_RANGE_MAX_Y) - GRAPH_RANGE_MIN_Y) / (GRAPH_RANGE_MAX_Y - GRAPH_RANGE_MIN_Y)
  return GRAPH_PADDING + ((1 - normalized) * GRAPH_SIZE)
}

function unmapGraphX(value: number) {
  return clamp((value - GRAPH_PADDING) / GRAPH_SIZE, 0, 1)
}

function unmapGraphY(value: number) {
  const normalized = 1 - ((value - GRAPH_PADDING) / GRAPH_SIZE)
  return clamp(GRAPH_RANGE_MIN_Y + (normalized * (GRAPH_RANGE_MAX_Y - GRAPH_RANGE_MIN_Y)), GRAPH_RANGE_MIN_Y, GRAPH_RANGE_MAX_Y)
}

function EasingGraph({ value, onChange }: { value: WallpaperBezierControlPoints; onChange: (value: WallpaperBezierControlPoints) => void }) {
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

      const nextX = unmapGraphX(event.clientX - rect.left)
      const nextY = unmapGraphY(event.clientY - rect.top)
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

  const startPoint = { x: mapGraphX(0), y: mapGraphY(0) }
  const endPoint = { x: mapGraphX(1), y: mapGraphY(1) }
  const controlOne = { x: mapGraphX(value.x1), y: mapGraphY(value.y1) }
  const controlTwo = { x: mapGraphX(value.x2), y: mapGraphY(value.y2) }
  const path = `M ${startPoint.x} ${startPoint.y} C ${controlOne.x} ${controlOne.y}, ${controlTwo.x} ${controlTwo.y}, ${endPoint.x} ${endPoint.y}`

  return (
    <svg
      ref={graphRef}
      viewBox={`0 0 ${GRAPH_SIZE + (GRAPH_PADDING * 2)} ${GRAPH_SIZE + (GRAPH_PADDING * 2)}`}
      className="h-[276px] w-full rounded-sm border border-border bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--primary)_8%,transparent),transparent_45%),var(--surface-low)]"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((line) => {
        const x = mapGraphX(line)
        const y = GRAPH_PADDING + (line * GRAPH_SIZE)
        return (
          <g key={line}>
            <line x1={x} y1={GRAPH_PADDING} x2={x} y2={GRAPH_PADDING + GRAPH_SIZE} stroke="color-mix(in srgb, var(--border) 72%, transparent)" strokeWidth="1" />
            <line x1={GRAPH_PADDING} y1={y} x2={GRAPH_PADDING + GRAPH_SIZE} y2={y} stroke="color-mix(in srgb, var(--border) 72%, transparent)" strokeWidth="1" />
          </g>
        )
      })}

      <path d={`M ${startPoint.x} ${startPoint.y} L ${endPoint.x} ${endPoint.y}`} stroke="color-mix(in srgb, var(--muted-foreground) 48%, transparent)" strokeDasharray="5 6" strokeWidth="1.5" fill="none" />
      <path d={path} stroke="var(--primary)" strokeWidth="3" fill="none" />
      <line x1={startPoint.x} y1={startPoint.y} x2={controlOne.x} y2={controlOne.y} stroke="color-mix(in srgb, var(--secondary) 60%, transparent)" strokeWidth="1.5" />
      <line x1={endPoint.x} y1={endPoint.y} x2={controlTwo.x} y2={controlTwo.y} stroke="color-mix(in srgb, var(--secondary) 60%, transparent)" strokeWidth="1.5" />

      <circle cx={startPoint.x} cy={startPoint.y} r="5" fill="var(--muted-foreground)" opacity="0.7" />
      <circle cx={endPoint.x} cy={endPoint.y} r="5" fill="var(--muted-foreground)" opacity="0.7" />

      {[
        { id: 'p1', point: controlOne, label: 'P1' },
        { id: 'p2', point: controlTwo, label: 'P2' },
      ].map((handle) => (
        <g key={handle.id}>
          <circle
            cx={handle.point.x}
            cy={handle.point.y}
            r="10"
            fill="color-mix(in srgb, var(--primary) 18%, var(--background))"
            stroke="var(--primary)"
            strokeWidth="2"
            className="cursor-grab active:cursor-grabbing"
            onPointerDown={(event) => {
              event.preventDefault()
              setDragHandle(handle.id as 'p1' | 'p2')
            }}
          />
          <text x={handle.point.x} y={handle.point.y - 16} textAnchor="middle" className="fill-muted-foreground text-[11px] font-medium">
            {handle.label}
          </text>
        </g>
      ))}
    </svg>
  )
}

function EasingPreview({ easing }: { easing: WallpaperAnimationEasing }) {
  const [replayCount, setReplayCount] = useState(0)
  const easingCss = useMemo(() => getWallpaperAnimationEasingCss(easing), [easing])
  const trackRef = useRef<HTMLDivElement | null>(null)
  const dotRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const trackWidth = Math.max((trackRef.current?.clientWidth ?? 0) - 12, 0)
    const dotElement = dotRef.current
    if (!dotElement) {
      return
    }

    dotElement.getAnimations().forEach((animation) => animation.cancel())
    dotElement.animate(
      [
        { transform: 'translate(0px, -50%)' },
        { transform: `translate(${trackWidth}px, -50%)` },
      ],
      {
        duration: 900,
        fill: 'forwards',
        easing: easingCss,
      },
    )
  }, [easingCss, replayCount])

  return (
    <div className="rounded-sm border border-border bg-surface-low p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>미리보기</span>
        <button type="button" className="text-secondary hover:text-foreground" onClick={() => setReplayCount((current) => current + 1)}>
          다시 재생
        </button>
      </div>
      <div className="relative h-12 overflow-hidden rounded-sm border border-border/70 bg-background">
        <div ref={trackRef} className="absolute inset-y-0 left-2 right-2">
          <div
            ref={dotRef}
            className="absolute left-0 top-1/2 h-3 w-3 rounded-full bg-primary shadow-[0_0_22px_color-mix(in_srgb,var(--primary)_28%,transparent)]"
            style={{ transform: 'translate(0px, -50%)' }}
          />
        </div>
      </div>
    </div>
  )
}

export function WallpaperEasingPicker({ value, fallbackPreset = 'easeOutCubic', onChange }: WallpaperEasingPickerProps) {
  const normalizedValue = normalizeWallpaperAnimationEasing(value, fallbackPreset)
  const isCustom = normalizedValue.startsWith('cubic-bezier(')
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'preset' | 'custom'>(isCustom ? 'custom' : 'preset')
  const [customPoints, setCustomPoints] = useState<WallpaperBezierControlPoints>(() => getWallpaperEditableBezierControlPoints(normalizedValue, fallbackPreset))

  const customEasing = useMemo(() => buildWallpaperCubicBezierEasing(customPoints), [customPoints])
  const previewEasing = activeTab === 'custom' ? customEasing : normalizedValue

  const updateCustomPoint = (key: keyof WallpaperBezierControlPoints, nextValue: string) => {
    const parsed = Number(nextValue)
    if (!Number.isFinite(parsed)) {
      return
    }

    setCustomPoints((current) => ({
      ...current,
      [key]: key === 'x1' || key === 'x2'
        ? clamp(parsed, 0, 1)
        : clamp(parsed, GRAPH_RANGE_MIN_Y, GRAPH_RANGE_MAX_Y),
    }))
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="w-full justify-between"
        onClick={() => {
          setActiveTab(isCustom ? 'custom' : 'preset')
          setCustomPoints(getWallpaperEditableBezierControlPoints(normalizedValue, fallbackPreset))
          setOpen(true)
        }}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 text-secondary" />
          <span className="truncate">{getWallpaperAnimationEasingLabel(normalizedValue)}</span>
        </span>
        <ChevronRight className="h-4 w-4 opacity-70" />
      </Button>

      <SettingsModal
        open={open}
        onClose={() => setOpen(false)}
        title="이징 설정"
        description="프리셋을 바로 고르거나, 커스텀 탭에서 그래프를 직접 만져서 cubic-bezier를 만들 수 있어."
        widthClassName="max-w-5xl"
      >
        <div className="space-y-4">
          <div className="inline-flex rounded-sm border border-border bg-surface-low p-1">
            <Button type="button" size="sm" variant={activeTab === 'preset' ? 'default' : 'ghost'} onClick={() => setActiveTab('preset')}>
              프리셋
            </Button>
            <Button type="button" size="sm" variant={activeTab === 'custom' ? 'default' : 'ghost'} onClick={() => setActiveTab('custom')}>
              커스텀
            </Button>
          </div>

          {activeTab === 'preset' ? (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {WALLPAPER_ANIMATION_EASING_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                  className={cn(
                    'rounded-sm border p-3 text-left transition',
                    normalizedValue === option.value
                      ? 'border-primary bg-[color-mix(in_srgb,var(--primary)_10%,var(--surface-low))]'
                      : 'border-border bg-surface-low hover:border-primary/50 hover:bg-surface-high',
                  )}
                >
                  <div className="text-sm font-medium text-foreground">{option.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{getWallpaperAnimationEasingCss(option.value)}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.95fr)]">
              <div className="space-y-4">
                <EasingGraph value={customPoints} onChange={setCustomPoints} />
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {([
                    ['x1', 'X1'],
                    ['y1', 'Y1'],
                    ['x2', 'X2'],
                    ['y2', 'Y2'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="space-y-1 text-xs text-muted-foreground">
                      <span>{label}</span>
                      <Input
                        variant="settings"
                        type="number"
                        step="0.01"
                        value={formatPointValue(customPoints[key])}
                        onChange={(event) => updateCustomPoint(key, event.target.value)}
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <EasingPreview easing={previewEasing} />
                <div className="rounded-sm border border-border bg-surface-low p-3">
                  <div className="mb-2 text-xs text-muted-foreground">현재 커스텀 값</div>
                  <div className="rounded-sm border border-border/70 bg-background px-3 py-2 font-mono text-xs text-foreground break-all">
                    {customEasing}
                  </div>
                </div>
                <div className="rounded-sm border border-border bg-surface-low p-3 text-xs leading-5 text-muted-foreground">
                  <div>X는 시간 흐름, Y는 진행 느낌이야.</div>
                  <div>위로 올리면 초반에 더 빨리 치고 나가고, 아래로 내리면 더 눌렀다가 나가.</div>
                  <div>`easeOutBounce` 같은 다중 튕김 계열은 프리셋으로 두고, 커스텀은 bezier 기반으로 다루는 게 안정적이야.</div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                    닫기
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      onChange(customEasing)
                      setOpen(false)
                    }}
                  >
                    커스텀 적용
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </SettingsModal>
    </>
  )
}
