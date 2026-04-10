import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronRight, Pencil, Save, Sparkles, Trash2, X } from 'lucide-react'
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
  previewKind?: WallpaperEasingPreviewKind
  onChange: (value: WallpaperAnimationEasing) => void
}

type WallpaperEasingPreviewKind = 'transition' | 'hover' | 'motion'

interface WallpaperSavedEasingPreset {
  id: string
  name: string
  easing: WallpaperAnimationEasing
  createdAt: string
}

const GRAPH_SIZE = 304
const GRAPH_PADDING = 24
const GRAPH_RANGE_MIN_Y = -1
const GRAPH_RANGE_MAX_Y = 2
const WALLPAPER_EASING_PRESETS_STORAGE_KEY = 'conai:wallpaper:easing-presets'
const MAX_WALLPAPER_SAVED_EASING_PRESETS = 24

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function formatPointValue(value: number) {
  return Number(value.toFixed(3))
}

function loadWallpaperSavedEasingPresets() {
  if (typeof window === 'undefined') {
    return [] as WallpaperSavedEasingPreset[]
  }

  try {
    const rawValue = window.localStorage.getItem(WALLPAPER_EASING_PRESETS_STORAGE_KEY)
    if (!rawValue) {
      return []
    }

    const parsedValue = JSON.parse(rawValue) as unknown
    if (!Array.isArray(parsedValue)) {
      return []
    }

    return parsedValue.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') {
        return []
      }

      const candidate = entry as Partial<WallpaperSavedEasingPreset>
      if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || typeof candidate.easing !== 'string') {
        return []
      }

      return [{
        id: candidate.id,
        name: candidate.name.trim(),
        easing: normalizeWallpaperAnimationEasing(candidate.easing),
        createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
      } satisfies WallpaperSavedEasingPreset]
    }).filter((preset) => preset.name.length > 0)
  }
  catch {
    return []
  }
}

function saveWallpaperSavedEasingPresets(presets: WallpaperSavedEasingPreset[]) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
    WALLPAPER_EASING_PRESETS_STORAGE_KEY,
    JSON.stringify(presets.slice(0, MAX_WALLPAPER_SAVED_EASING_PRESETS)),
  )
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
          const x = mapGraphX(line)
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
          { id: 'p1', point: controlOne, label: 'P1', valueText: `${formatPointValue(value.x1)}, ${formatPointValue(value.y1)}` },
          { id: 'p2', point: controlTwo, label: 'P2', valueText: `${formatPointValue(value.x2)}, ${formatPointValue(value.y2)}` },
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

function EasingPreview({ easing, kind }: { easing: WallpaperAnimationEasing; kind: WallpaperEasingPreviewKind }) {
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

function EasingPreviewPanel({
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

      <EasingPreview easing={easing} kind={activePreviewKind} />
      {extraContent}
    </div>
  )
}

export function WallpaperEasingPicker({ value, fallbackPreset = 'easeOutCubic', previewKind = 'transition', onChange }: WallpaperEasingPickerProps) {
  const normalizedValue = normalizeWallpaperAnimationEasing(value, fallbackPreset)
  const isCustom = normalizedValue.startsWith('cubic-bezier(')
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'preset' | 'custom'>(isCustom ? 'custom' : 'preset')
  const [activePreviewKind, setActivePreviewKind] = useState<WallpaperEasingPreviewKind>(previewKind)
  const [customPoints, setCustomPoints] = useState<WallpaperBezierControlPoints>(() => getWallpaperEditableBezierControlPoints(normalizedValue, fallbackPreset))
  const [savedPresets, setSavedPresets] = useState<WallpaperSavedEasingPreset[]>(() => loadWallpaperSavedEasingPresets())
  const [presetName, setPresetName] = useState('')
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
  const [editingPresetName, setEditingPresetName] = useState('')

  const customEasing = useMemo(() => buildWallpaperCubicBezierEasing(customPoints), [customPoints])
  const previewEasing = activeTab === 'custom' ? customEasing : normalizedValue
  const matchingSavedPreset = useMemo(
    () => savedPresets.find((preset) => preset.easing === normalizedValue) ?? null,
    [normalizedValue, savedPresets],
  )
  const pickerLabel = matchingSavedPreset?.name ?? getWallpaperAnimationEasingLabel(normalizedValue)

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

  const handleSavePreset = () => {
    const trimmedName = presetName.trim()
    if (!trimmedName) {
      return
    }

    setSavedPresets((current) => {
      const existingPreset = current.find((preset) => preset.name === trimmedName)
      const nextPresets = existingPreset
        ? current.map((preset) => preset.id === existingPreset.id ? { ...preset, easing: customEasing } : preset)
        : [{
            id: `wallpaper-easing-${Date.now()}`,
            name: trimmedName,
            easing: customEasing,
            createdAt: new Date().toISOString(),
          }, ...current]

      saveWallpaperSavedEasingPresets(nextPresets)
      return nextPresets.slice(0, MAX_WALLPAPER_SAVED_EASING_PRESETS)
    })
    setPresetName('')
  }

  const handleRemovePreset = (presetId: string) => {
    setSavedPresets((current) => {
      const nextPresets = current.filter((preset) => preset.id !== presetId)
      saveWallpaperSavedEasingPresets(nextPresets)
      return nextPresets
    })

    if (editingPresetId === presetId) {
      setEditingPresetId(null)
      setEditingPresetName('')
    }
  }

  const handleStartEditingPreset = (preset: WallpaperSavedEasingPreset) => {
    setEditingPresetId(preset.id)
    setEditingPresetName(preset.name)
  }

  const handleCancelEditingPreset = () => {
    setEditingPresetId(null)
    setEditingPresetName('')
  }

  const handleRenamePreset = (presetId: string) => {
    const trimmedName = editingPresetName.trim()
    if (!trimmedName) {
      return
    }

    setSavedPresets((current) => {
      const nextPresets = current.map((preset) => preset.id === presetId ? { ...preset, name: trimmedName } : preset)
      saveWallpaperSavedEasingPresets(nextPresets)
      return nextPresets
    })
    setEditingPresetId(null)
    setEditingPresetName('')
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="w-full justify-between"
        onClick={() => {
          setActiveTab(isCustom ? 'custom' : 'preset')
          setActivePreviewKind(previewKind)
          setCustomPoints(getWallpaperEditableBezierControlPoints(normalizedValue, fallbackPreset))
          setPresetName(matchingSavedPreset?.name ?? '')
          setSavedPresets(loadWallpaperSavedEasingPresets())
          setEditingPresetId(null)
          setEditingPresetName('')
          setOpen(true)
        }}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 text-secondary" />
          <span className="truncate">{pickerLabel}</span>
        </span>
        <ChevronRight className="h-4 w-4 opacity-70" />
      </Button>

      <SettingsModal
        open={open}
        onClose={() => setOpen(false)}
        title="이징 설정"
        description="프리셋은 바로 적용하고, 커스텀은 그래프를 직접 만져서 cubic-bezier를 만들 수 있어."
        widthClassName="max-w-6xl"
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
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_360px]">
              <div className="space-y-4">
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-2">
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
                      <div className="mt-1 text-xs text-muted-foreground break-all">{getWallpaperAnimationEasingCss(option.value)}</div>
                    </button>
                  ))}
                </div>

                <div className="rounded-sm border border-border bg-surface-low p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-foreground">내 프리셋</div>
                      <div className="text-xs text-muted-foreground">커스텀 탭에서 저장한 이징을 여기서 다시 바로 쓸 수 있어.</div>
                    </div>
                    <div className="text-xs text-muted-foreground">{savedPresets.length}/{MAX_WALLPAPER_SAVED_EASING_PRESETS}</div>
                  </div>

                  {savedPresets.length > 0 ? (
                    <div className="space-y-2">
                      {savedPresets.map((preset) => {
                        const isEditing = editingPresetId === preset.id
                        const isDuplicateName = editingPresetName.trim().length > 0 && savedPresets.some((candidate) => candidate.id !== preset.id && candidate.name === editingPresetName.trim())

                        return (
                          <div key={preset.id} className="flex items-center gap-2 rounded-sm border border-border/70 bg-background p-2">
                            {isEditing ? (
                              <div className="min-w-0 flex-1 space-y-2 rounded-sm px-2 py-2">
                                <Input
                                  variant="settings"
                                  value={editingPresetName}
                                  onChange={(event) => setEditingPresetName(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' && editingPresetName.trim() && !isDuplicateName) {
                                      event.preventDefault()
                                      handleRenamePreset(preset.id)
                                    }
                                    if (event.key === 'Escape') {
                                      event.preventDefault()
                                      handleCancelEditingPreset()
                                    }
                                  }}
                                />
                                <div className="truncate text-[11px] text-muted-foreground">{preset.easing}</div>
                                {isDuplicateName ? (
                                  <div className="text-[11px] text-destructive">같은 이름의 프리셋이 이미 있어.</div>
                                ) : null}
                              </div>
                            ) : (
                              <button
                                type="button"
                                className={cn(
                                  'min-w-0 flex-1 rounded-sm px-2 py-2 text-left transition hover:bg-surface-low',
                                  normalizedValue === preset.easing ? 'bg-[color-mix(in_srgb,var(--primary)_10%,var(--surface-low))]' : '',
                                )}
                                onClick={() => {
                                  onChange(preset.easing)
                                  setOpen(false)
                                }}
                              >
                                <div className="truncate text-sm font-medium text-foreground">{preset.name}</div>
                                <div className="truncate text-[11px] text-muted-foreground">{preset.easing}</div>
                              </button>
                            )}

                            {isEditing ? (
                              <>
                                <Button type="button" size="icon-xs" variant="ghost" onClick={() => handleRenamePreset(preset.id)} disabled={!editingPresetName.trim() || isDuplicateName} title="이름 저장" aria-label="이름 저장">
                                  <Check className="h-3.5 w-3.5" />
                                </Button>
                                <Button type="button" size="icon-xs" variant="ghost" onClick={handleCancelEditingPreset} title="이름 편집 취소" aria-label="이름 편집 취소">
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            ) : (
                              <Button type="button" size="icon-xs" variant="ghost" onClick={() => handleStartEditingPreset(preset)} title="이름 편집" aria-label="이름 편집">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}

                            <Button type="button" size="icon-xs" variant="ghost" onClick={() => handleRemovePreset(preset.id)} title="프리셋 삭제" aria-label="프리셋 삭제">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="rounded-sm border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
                      아직 저장한 커스텀 프리셋이 없어.
                    </div>
                  )}
                </div>
              </div>

              <EasingPreviewPanel
                activePreviewKind={activePreviewKind}
                easing={previewEasing}
                onChangePreviewKind={setActivePreviewKind}
                extraContent={(
                  <div className="rounded-sm border border-border bg-surface-low p-3 text-xs leading-5 text-muted-foreground">
                    <div>프리셋은 바로 적용돼.</div>
                    <div>완전히 다른 감각을 만들고 싶으면 커스텀 탭에서 그래프를 직접 만지면 돼.</div>
                  </div>
                )}
              />
            </div>
          ) : (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_380px]">
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

              <EasingPreviewPanel
                activePreviewKind={activePreviewKind}
                easing={previewEasing}
                onChangePreviewKind={setActivePreviewKind}
                extraContent={(
                  <>
                    <div className="rounded-sm border border-border bg-surface-low p-3">
                      <div className="mb-2 text-xs text-muted-foreground">현재 커스텀 값</div>
                      <div className="rounded-sm border border-border/70 bg-background px-3 py-2 font-mono text-xs text-foreground break-all">
                        {customEasing}
                      </div>
                    </div>

                    <div className="rounded-sm border border-border bg-surface-low p-3">
                      <div className="mb-2 text-xs text-muted-foreground">프리셋으로 저장</div>
                      <div className="flex gap-2">
                        <Input
                          variant="settings"
                          placeholder="예: 부드러운 진입"
                          value={presetName}
                          onChange={(event) => setPresetName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              handleSavePreset()
                            }
                          }}
                        />
                        <Button type="button" onClick={handleSavePreset} disabled={!presetName.trim()}>
                          <Save className="h-4 w-4" />
                          저장
                        </Button>
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
                  </>
                )}
              />
            </div>
          )}
        </div>
      </SettingsModal>
    </>
  )
}
