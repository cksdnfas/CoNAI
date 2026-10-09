import { useEffect, useState, type KeyboardEvent, type SyntheticEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import type { TypedFieldOption } from '@/features/shared-fields/typed-field-input'
import { cn } from '@/lib/utils'

/**
 * Small controls that live inside node cards. They keep one height (24px) so every node row lines up, never start a
 * node drag or canvas pan, and never scroll the canvas with the wheel.
 */
export const NODE_CONTROL_CLASS = 'nodrag nowheel h-6 min-w-0 rounded-[5px] bg-surface-high px-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60'

/** Keep pointer presses inside a control from selecting or dragging the node. */
export function stopNodeEvent(event: SyntheticEvent) {
  event.stopPropagation()
}

function normalizeOptions(options: readonly TypedFieldOption[] | null | undefined) {
  return (options ?? []).map((option) => (typeof option === 'string' ? { value: option, label: option } : option))
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
  const normalized = normalizeOptions(options)
  const current = value === undefined || value === null ? '' : String(value)
  const knownCurrent = current === '' || normalized.some((option) => option.value === current)

  return (
    <span className={cn('relative inline-flex min-w-0', className)} onMouseDown={stopNodeEvent} onPointerDown={stopNodeEvent}>
      <select
        aria-label={ariaLabel}
        value={current}
        onChange={(event) => onChange(event.target.value)}
        className={cn(NODE_CONTROL_CLASS, 'w-full appearance-none truncate pr-5')}
      >
        {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
        {!knownCurrent ? <option value={current}>{current}</option> : null}
        {normalized.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-1 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </span>
  )
}

/** A number box that commits on Enter / blur; ↑↓ step it. Empty means "use the default". */
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
  const external = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value : ''
  const [draft, setDraft] = useState(external)
  useEffect(() => setDraft(external), [external])

  const clamp = (next: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, next))
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
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commit(draft)
      event.currentTarget.blur()
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const base = Number(draft || placeholder || 0)
      const precision = String(step).split('.')[1]?.length ?? 0
      const next = clamp(Number(((Number.isFinite(base) ? base : 0) + (event.key === 'ArrowUp' ? step : -step)).toFixed(precision)))
      setDraft(String(next))
      onChange(next)
    }
  }

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
  return (
    <input
      aria-label={ariaLabel}
      value={value === undefined || value === null ? '' : String(value)}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onMouseDown={stopNodeEvent}
      onPointerDown={stopNodeEvent}
      className={cn(NODE_CONTROL_CLASS, 'w-full', className)}
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
