import { useEffect, useState, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { IconButton } from '@/components/ui/icon-button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { WallpaperColorWell } from './wallpaper-color-picker'

/** Label on the left, control on the right (one inspector line). */
export function InspectorRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-[84px_minmax(0,1fr)] items-center gap-3', className)}>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** A small overline that starts a group of rows. */
export function InspectorHeading({ children }: { children: ReactNode }) {
  return <div className="pt-2 text-2xs font-semibold uppercase tracking-overline text-muted-foreground">{children}</div>
}

/** The slider's readout, typed into directly; commits on blur or Enter, clamped to the slider range. */
function SliderValueInput({ value, min, max, unit, label, mixed = false, onCommit }: {
  value: number
  min: number
  max: number
  unit: string
  label?: string
  mixed?: boolean
  onCommit: (value: number) => void
}) {
  const { t } = useI18n()
  const shown = mixed ? '' : String(Math.round(value * 100) / 100)
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])
  const commit = () => {
    const parsed = Number(draft.replace(unit, '').trim())
    if (!draft.trim() || !Number.isFinite(parsed)) {
      setDraft(shown)
      return
    }
    const clamped = Math.min(max, Math.max(min, parsed))
    setDraft(String(Math.round(clamped * 100) / 100))
    if (mixed || clamped !== value) onCommit(clamped)
  }
  return (
    <label className="flex h-7 w-14 shrink-0 items-center justify-end rounded-md px-1 font-mono text-xs tabular-nums text-muted-foreground hover:bg-field focus-within:bg-field focus-within:text-foreground">
      <input
        inputMode="decimal"
        aria-label={label}
        className="w-full min-w-0 bg-transparent text-right outline-none placeholder:font-sans placeholder:text-muted-foreground"
        placeholder={mixed ? t({ ko: '혼합', en: 'Mixed' }) : undefined}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') setDraft(shown)
        }}
      />
      {unit ? <span className="shrink-0">{unit}</span> : null}
    </label>
  )
}

export function InspectorSlider({ label, value, min, max, step = 1, unit = '', mixed = false, onChange }: {
  label: ReactNode
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  /** Several selected widgets disagree: the thumb is dimmed and the readout empty until a value is set. */
  mixed?: boolean
  onChange: (value: number) => void
}) {
  return (
    <InspectorRow label={label}>
      <div className="flex items-center gap-3">
        <Slider className={mixed ? 'opacity-45' : undefined} value={[value]} min={min} max={max} step={step} onValueChange={([next]) => onChange(next)} aria-label={typeof label === 'string' ? label : undefined} />
        <SliderValueInput value={value} min={min} max={max} unit={unit} mixed={mixed} label={typeof label === 'string' ? label : undefined} onCommit={onChange} />
      </div>
    </InspectorRow>
  )
}

export function InspectorSegments<T extends string>({ label, value, items, onChange, stacked = false }: {
  label: ReactNode
  /** `''` selects nothing, for a mixed multi-selection. */
  value: T | ''
  items: Array<{ value: T; label: ReactNode; ariaLabel?: string }>
  onChange: (value: T) => void
  /** Label above a full-width control, for options too wide to sit beside it. */
  stacked?: boolean
}) {
  const control = <SegmentedControl size="xs" fullWidth className="flex-nowrap" value={value} items={items} onChange={(next) => onChange(next as T)} ariaLabel={typeof label === 'string' ? label : undefined} />
  if (stacked) {
    return (
      <div className="space-y-1.5">
        <span className="block text-xs text-muted-foreground">{label}</span>
        {control}
      </div>
    )
  }
  return <InspectorRow label={label}>{control}</InspectorRow>
}

export function InspectorSwitch({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

/** `#abc`, `abc`, `aabbcc` or `aabbccdd` → `#aabbcc(dd)` (a full-opacity `ff` drops); empty → null; else undefined. */
function parseHexColor(text: string): string | null | undefined {
  const digits = text.trim().replace(/^#/, '')
  if (!digits) return null
  if (/^[0-9a-f]{3}$/i.test(digits)) return `#${digits.split('').map((digit) => digit + digit).join('')}`.toLowerCase()
  if (/^[0-9a-f]{6}$/i.test(digits)) return `#${digits}`.toLowerCase()
  if (/^[0-9a-f]{8}$/i.test(digits)) return (/ff$/i.test(digits) ? `#${digits.slice(0, 6)}` : `#${digits}`).toLowerCase()
  return undefined
}

/** Hex text that commits on blur or Enter; an invalid entry snaps back. */
function HexInput({ value, placeholder, label, onCommit }: {
  value: string | null
  placeholder: string
  label?: string
  onCommit: (value: string | null) => void
}) {
  const shown = value ? value.toUpperCase() : ''
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])
  const commit = () => {
    const parsed = parseHexColor(draft)
    if (parsed === undefined || parsed === (value?.toLowerCase() ?? null)) {
      setDraft(shown)
      return
    }
    onCommit(parsed)
  }
  return (
    <input
      aria-label={label}
      spellCheck={false}
      className="h-8 min-w-0 flex-1 rounded-md bg-transparent px-1.5 font-mono text-xs text-muted-foreground uppercase outline-none placeholder:normal-case hover:bg-field focus:bg-field focus:text-foreground"
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') setDraft(shown)
      }}
    />
  )
}

/** A color well (in-app picker) with an editable hex, plus a reset to the theme color when `nullable`. */
export function InspectorColor({ label, value, fallback, themeVariable, nullable = false, mixed = false, onChange }: {
  label: ReactNode
  value: string | null
  fallback: string
  /** Theme token a null value draws with, so the well shows the real color instead of `fallback`. */
  themeVariable?: string
  nullable?: boolean
  /** Several selected widgets disagree. */
  mixed?: boolean
  onChange: (value: string | null) => void
}) {
  const { t } = useI18n()
  return (
    <InspectorRow label={label}>
      <div className="flex items-center gap-2">
        <WallpaperColorWell
          value={value}
          fallback={fallback}
          themeVariable={themeVariable}
          mixed={mixed}
          label={typeof label === 'string' ? label : undefined}
          onChange={onChange}
        />
        <HexInput
          value={mixed ? null : value}
          placeholder={mixed ? t({ ko: '혼합', en: 'Mixed' }) : nullable ? t({ ko: '테마', en: 'Theme' }) : fallback.toUpperCase()}
          label={typeof label === 'string' ? t({ ko: '{label} HEX', en: '{label} hex' }, { label }) : undefined}
          onCommit={(next) => onChange(next ?? (nullable ? null : fallback))}
        />

        {nullable && value && !mixed ? (
          <IconButton variant="ghost" size="icon-xs" label={t({ ko: '테마 색으로', en: 'Use the theme color' })} onClick={() => onChange(null)}>
            <RotateCcw />
          </IconButton>
        ) : null}
      </div>
    </InspectorRow>
  )
}

/** Number field that commits on blur or Enter (one undo step per edit); ↑/↓ step by 1, Shift by 10. */
export function InspectorNumber({ label, ariaLabel, value, min, max, suffix, mixed = false, onCommit }: {
  label: string
  ariaLabel?: string
  value: number
  min?: number
  max?: number
  suffix?: string
  /** Several selected widgets disagree: empty until a value is typed. */
  mixed?: boolean
  onCommit: (value: number) => void
}) {
  const { t } = useI18n()
  const shown = mixed ? '' : String(Math.round(value))
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])
  const clamp = (next: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Math.round(next)))
  const commit = () => {
    const parsed = Number(draft)
    // An emptied field means "never mind", not 0.
    if (!draft.trim() || !Number.isFinite(parsed)) {
      setDraft(shown)
      return
    }
    const clamped = clamp(parsed)
    setDraft(String(clamped))
    if (mixed || clamped !== Math.round(value)) onCommit(clamped)
  }
  return (
    <label className="flex h-8 min-w-0 items-center gap-1.5 rounded-md bg-field px-2 text-xs">
      <span className="shrink-0 font-semibold text-muted-foreground">{label}</span>
      <input
        inputMode="numeric"
        aria-label={ariaLabel}
        className="min-w-0 flex-1 bg-transparent font-mono tabular-nums outline-none placeholder:font-sans placeholder:text-muted-foreground"
        placeholder={mixed ? t({ ko: '혼합', en: 'Mixed' }) : undefined}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') setDraft(shown)
          if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !mixed) {
            event.preventDefault()
            const base = Number.isFinite(Number(draft)) && draft.trim() ? Number(draft) : value
            const next = clamp(base + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1))
            setDraft(String(next))
            if (next !== Math.round(value)) onCommit(next)
          }
        }}
      />
      {suffix ? <span className="shrink-0 text-muted-foreground">{suffix}</span> : null}
    </label>
  )
}
