import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Switch } from '@/components/ui/switch'
import type { TypedFieldOption } from '@/features/shared-fields/typed-field-input'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * Small controls that live inside node cards. They keep one height (24px) so every node row lines up, never start a
 * node drag or canvas pan, and never scroll the canvas with the wheel.
 */
export const NODE_CONTROL_CLASS = 'nodrag nowheel h-6 min-w-0 rounded-[5px] bg-surface-high px-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60'

/** Inside a widget pill the pill is the box: controls drop their own fill and sit right-aligned on it. */
const NODE_WIDGET_CONTROL_CLASS = 'nodrag nowheel h-6 min-w-0 bg-transparent text-right text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:underline focus-visible:decoration-muted-foreground/60 disabled:opacity-60 [field-sizing:content]'

/** Set by a widget row (ComfyUI-style pill) so the controls in it render as part of the pill. */
export const NodeWidgetContext = createContext(false)

/** Horizontal pixels per step when a number widget is dragged. */
const SCRUB_PIXELS_PER_STEP = 6

/** Keep pointer presses inside a control from selecting or dragging the node. */
export function stopNodeEvent(event: SyntheticEvent) {
  event.stopPropagation()
}

function normalizeOptions(options: readonly TypedFieldOption[] | null | undefined) {
  return (options ?? []).map((option) => (typeof option === 'string' ? { value: option, label: option } : option))
}

/** The ◀ / ▶ at either end of a number or choice widget. */
function WidgetStepButton({ direction, label, onStep, disabled }: { direction: -1 | 1; label: string; onStep: () => void; disabled?: boolean }) {
  const { t } = useI18n()
  const Icon = direction < 0 ? ChevronLeft : ChevronRight
  return (
    <IconButton
      size="icon-xs"
      variant="ghost"
      tooltip={false}
      tabIndex={-1}
      label={`${label} · ${direction < 0 ? t({ ko: '이전', en: 'Previous' }) : t({ ko: '다음', en: 'Next' })}`}
      disabled={disabled}
      onMouseDown={(event) => {
        event.stopPropagation()
        event.preventDefault()
      }}
      onPointerDown={stopNodeEvent}
      onClick={(event) => {
        event.stopPropagation()
        onStep()
      }}
      className="nodrag h-6 w-4 shrink-0 rounded-full text-muted-foreground/55 hover:bg-transparent hover:text-foreground disabled:opacity-40"
    >
      <Icon className="size-3" strokeWidth={2.5} />
    </IconButton>
  )
}

export function NodeSelectControl({
  value,
  options,
  onChange,
  emptyLabel,
  ariaLabel,
  className,
}: {
  value: unknown
  options: readonly TypedFieldOption[] | null | undefined
  onChange: (value: string) => void
  /** Adds an empty choice (the module default) with this label. */
  emptyLabel?: string
  ariaLabel: string
  className?: string
}) {
  const inWidget = useContext(NodeWidgetContext)
  const normalized = normalizeOptions(options)
  const current = value === undefined || value === null ? '' : String(value)
  const knownCurrent = current === '' || normalized.some((option) => option.value === current)
  const optionElements = (
    <>
      {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
      {!knownCurrent ? <option value={current}>{current}</option> : null}
      {normalized.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </>
  )

  if (inWidget) {
    // ◀ ▶ walk the same list the dropdown shows, skipping disabled entries and wrapping at the ends.
    const cycle = [
      ...(emptyLabel !== undefined ? [''] : []),
      ...(!knownCurrent ? [current] : []),
      ...normalized.filter((option) => !option.disabled).map((option) => option.value),
    ]
    const step = (direction: -1 | 1) => {
      if (cycle.length === 0) return
      const index = cycle.indexOf(current)
      const next = cycle[index < 0 ? 0 : (index + direction + cycle.length) % cycle.length]
      if (next !== current) onChange(next)
    }
    return (
      <span className={cn('flex min-w-0 items-center justify-end', className)} onMouseDown={stopNodeEvent} onPointerDown={stopNodeEvent}>
        <WidgetStepButton direction={-1} label={ariaLabel} onStep={() => step(-1)} disabled={cycle.length < 2} />
        <select
          aria-label={ariaLabel}
          value={current}
          onChange={(event) => onChange(event.target.value)}
          className={cn(NODE_WIDGET_CONTROL_CLASS, 'max-w-full cursor-pointer appearance-none truncate [&_option]:bg-surface-high [&_option]:text-left')}
        >
          {optionElements}
        </select>
        <WidgetStepButton direction={1} label={ariaLabel} onStep={() => step(1)} disabled={cycle.length < 2} />
      </span>
    )
  }

  return (
    <span className={cn('relative inline-flex min-w-0', className)} onMouseDown={stopNodeEvent} onPointerDown={stopNodeEvent}>
      <select
        aria-label={ariaLabel}
        value={current}
        onChange={(event) => onChange(event.target.value)}
        className={cn(NODE_CONTROL_CLASS, 'w-full appearance-none truncate pr-5')}
      >
        {optionElements}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-1 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </span>
  )
}

/**
 * A number box that commits on Enter / blur; ↑↓ step it. Empty means "use the default". In a widget pill it gets
 * ◀ ▶ steppers and can be dragged sideways to scrub; a plain click still edits it.
 */
export function NodeNumberControl({
  value,
  onChange,
  placeholder,
  min,
  max,
  step = 1,
  ariaLabel,
  className,
}: {
  value: unknown
  onChange: (value: number | '') => void
  placeholder?: string
  min?: number
  max?: number
  step?: number
  ariaLabel: string
  className?: string
}) {
  const inWidget = useContext(NodeWidgetContext)
  const external = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value : ''
  const [draft, setDraft] = useState(external)
  const scrubRef = useRef<{ x: number; base: number; moved: boolean } | null>(null)
  useEffect(() => setDraft(external), [external])

  const precision = String(step).split('.')[1]?.length ?? 0
  const clamp = (next: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, next))
  const currentNumber = () => {
    const base = Number(draft || placeholder || 0)
    return Number.isFinite(base) ? base : 0
  }
  const commit = (raw: string) => {
    const trimmed = raw.trim()
    if (trimmed === '') {
      if (external !== '') onChange('')
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      setDraft(external)
      return
    }
    const next = clamp(parsed)
    setDraft(String(next))
    if (String(next) !== external) onChange(next)
  }
  const stepBy = (direction: -1 | 1) => {
    const next = clamp(Number((currentNumber() + direction * step).toFixed(precision)))
    setDraft(String(next))
    onChange(next)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commit(draft)
      event.currentTarget.blur()
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      stepBy(event.key === 'ArrowUp' ? 1 : -1)
    }
  }

  if (!inWidget) {
    return (
      <input
        aria-label={ariaLabel}
        inputMode="decimal"
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={onKeyDown}
        onMouseDown={stopNodeEvent}
        onPointerDown={stopNodeEvent}
        className={cn(NODE_CONTROL_CLASS, 'w-full text-right tabular-nums', className)}
      />
    )
  }

  const scrubValue = (clientX: number) => {
    const scrub = scrubRef.current
    if (!scrub) return null
    return clamp(Number((scrub.base + Math.round((clientX - scrub.x) / SCRUB_PIXELS_PER_STEP) * step).toFixed(precision)))
  }
  const onPointerDown = (event: ReactPointerEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.button !== 0 || document.activeElement === event.currentTarget) return
    scrubRef.current = { x: event.clientX, base: currentNumber(), moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLInputElement>) => {
    const scrub = scrubRef.current
    if (!scrub) return
    if (!scrub.moved && Math.abs(event.clientX - scrub.x) < SCRUB_PIXELS_PER_STEP / 2) return
    scrub.moved = true
    const next = scrubValue(event.clientX)
    if (next !== null) setDraft(String(next))
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLInputElement>) => {
    const scrub = scrubRef.current
    if (!scrub) return
    const next = scrubValue(event.clientX)
    scrubRef.current = null
    if (scrub.moved && next !== null) {
      commit(String(next))
      return
    }
    event.currentTarget.focus()
    event.currentTarget.select()
  }

  return (
    <span className={cn('flex min-w-0 items-center justify-end', className)}>
      <WidgetStepButton direction={-1} label={ariaLabel} onStep={() => stepBy(-1)} />
      <input
        aria-label={ariaLabel}
        inputMode="decimal"
        value={draft}
        placeholder={placeholder ?? '—'}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={onKeyDown}
        onMouseDown={(event) => {
          event.stopPropagation()
          // Pressing an unfocused widget starts a scrub, not a text cursor; a click without moving focuses it.
          if (document.activeElement !== event.currentTarget) event.preventDefault()
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { scrubRef.current = null }}
        className={cn(NODE_WIDGET_CONTROL_CLASS, 'max-w-full min-w-[2ch] cursor-ew-resize tabular-nums focus:cursor-text')}
      />
      <WidgetStepButton direction={1} label={ariaLabel} onStep={() => stepBy(1)} />
    </span>
  )
}

export function NodeTextControl({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
}: {
  value: unknown
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel: string
  className?: string
}) {
  const inWidget = useContext(NodeWidgetContext)
  return (
    <input
      aria-label={ariaLabel}
      value={value === undefined || value === null ? '' : String(value)}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onMouseDown={stopNodeEvent}
      onPointerDown={stopNodeEvent}
      className={inWidget ? cn(NODE_WIDGET_CONTROL_CLASS, 'w-full [field-sizing:fixed]', className) : cn(NODE_CONTROL_CLASS, 'w-full', className)}
    />
  )
}

export function NodeSwitchControl({
  checked,
  onChange,
  ariaLabel,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel: string
  disabled?: boolean
}) {
  return (
    <Switch
      size="sm"
      checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onMouseDown={stopNodeEvent}
      onPointerDown={stopNodeEvent}
      onClick={(event) => event.stopPropagation()}
      onCheckedChange={(next) => onChange(next === true)}
      className="nodrag"
    />
  )
}
