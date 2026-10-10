import { useEffect, useState, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

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

export function InspectorSlider({ label, value, min, max, step = 1, unit = '', onChange }: {
  label: ReactNode
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number) => void
}) {
  return (
    <InspectorRow label={label}>
      <div className="flex items-center gap-3">
        <Slider value={[value]} min={min} max={max} step={step} onValueChange={([next]) => onChange(next)} aria-label={typeof label === 'string' ? label : undefined} />
        <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{Math.round(value * 100) / 100}{unit}</span>
      </div>
    </InspectorRow>
  )
}

export function InspectorSegments<T extends string>({ label, value, items, onChange, stacked = false }: {
  label: ReactNode
  value: T
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

/** A color well with its hex, plus a reset to the theme color when `nullable`. */
export function InspectorColor({ label, value, fallback, nullable = false, onChange }: {
  label: ReactNode
  value: string | null
  fallback: string
  nullable?: boolean
  onChange: (value: string | null) => void
}) {
  const { t } = useI18n()
  return (
    <InspectorRow label={label}>
      <div className="flex items-center gap-2">
        <Input
          type="color"
          aria-label={typeof label === 'string' ? label : undefined}
          className="h-8 w-10 shrink-0 cursor-pointer p-0.5"
          value={value ?? fallback}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {value ? value.toUpperCase() : t({ ko: '테마', en: 'Theme' })}
        </span>
        {nullable && value ? (
          <IconButton variant="ghost" size="icon-xs" label={t({ ko: '테마 색으로', en: 'Use the theme color' })} onClick={() => onChange(null)}>
            <RotateCcw />
          </IconButton>
        ) : null}
      </div>
    </InspectorRow>
  )
}

/** Number field that commits on blur or Enter (one undo step per edit). */
export function InspectorNumber({ label, value, min, max, suffix, onCommit }: {
  label: string
  value: number
  min?: number
  max?: number
  suffix?: string
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(Math.round(value)))
  useEffect(() => setDraft(String(Math.round(value))), [value])
  const commit = () => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(String(Math.round(value)))
      return
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Math.round(parsed)))
    setDraft(String(clamped))
    if (clamped !== Math.round(value)) onCommit(clamped)
  }
  return (
    <label className="flex h-8 min-w-0 items-center gap-1.5 rounded-md bg-field px-2 text-xs">
      <span className="shrink-0 font-semibold text-muted-foreground">{label}</span>
      <input
        inputMode="numeric"
        className="min-w-0 flex-1 bg-transparent font-mono tabular-nums outline-none"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') setDraft(String(Math.round(value)))
        }}
      />
      {suffix ? <span className="shrink-0 text-muted-foreground">{suffix}</span> : null}
    </label>
  )
}
