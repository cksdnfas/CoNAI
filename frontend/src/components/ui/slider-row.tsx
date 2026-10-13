import { useEffect, useState, type ReactNode } from 'react'
import { Slider } from '@/components/ui/slider'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

interface SliderRowProps {
  label: ReactNode
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  /** Fires once when a drag ends (one undo step per drag). A typed `editable` value goes to `onChange` only. */
  onCommit?: (value: number) => void
  /** Text after the slider; defaults to the value. Pass it when the slider position is not the shown number. */
  readout?: ReactNode
  /** The readout is a small number field: type a value, commits on blur or Enter, clamped to the range. */
  editable?: boolean
  /** Suffix of the editable readout (`%`, `px`). */
  unit?: string
  /** Several selected things disagree: dimmed thumb, empty readout until a value is set. */
  mixed?: boolean
  disabled?: boolean
  /** Name for the slider when it differs from the label (or the label is not a string). */
  ariaLabel?: string
  /** `row` (default): label column, the slider fills the line. `inline`: toolbar size — fixed-width slider, no fill. */
  layout?: 'row' | 'inline'
  /** Width of the label column in a `row`, so stacked sliders line up (default `w-18`). */
  labelClassName?: string
  className?: string
}

/** Label, slider and its value on one line. Stack several rows directly; give the stack one `labelClassName` width. */
function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  readout,
  editable = false,
  unit = '',
  mixed = false,
  disabled,
  ariaLabel,
  layout = 'row',
  labelClassName,
  className,
}: SliderRowProps) {
  const name = ariaLabel ?? (typeof label === 'string' ? label : undefined)
  const inline = layout === 'inline'

  return (
    <div data-slot="slider-row" className={cn('flex min-w-0 items-center gap-3', inline && 'shrink-0', className)}>
      <span className={cn('shrink-0 truncate text-xs text-muted-foreground', !inline && (labelClassName ?? 'w-18'))}>{label}</span>
      <Slider
        className={cn(inline ? 'w-28 md:w-32' : 'min-w-0 flex-1', mixed && 'opacity-45')}
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={name}
        onValueChange={([next]) => onChange(next ?? value)}
        onValueCommit={onCommit ? ([next]) => onCommit(next ?? value) : undefined}
      />
      {editable ? (
        <SliderValueInput value={value} min={min} max={max} unit={unit} mixed={mixed} label={name} disabled={disabled} onCommit={onChange} />
      ) : (
        <span className={cn('shrink-0 text-right font-mono text-xs tabular-nums text-foreground', inline ? 'w-10' : 'w-14')}>
          {mixed ? null : readout ?? value}
        </span>
      )}
    </div>
  )
}

/** The editable readout: commits on blur or Enter, Escape restores, clamped to the slider range. */
function SliderValueInput({ value, min, max, unit, label, mixed, disabled, onCommit }: {
  value: number
  min: number
  max: number
  unit: string
  label?: string
  mixed: boolean
  disabled?: boolean
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
        disabled={disabled}
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

export { SliderRow }
export type { SliderRowProps }
