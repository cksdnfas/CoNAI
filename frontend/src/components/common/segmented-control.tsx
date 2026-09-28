import type { KeyboardEvent, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type SegmentedControlItem = {
  value: string
  label: ReactNode
  disabled?: boolean
}

type SegmentedControlProps = {
  value: string
  items: SegmentedControlItem[]
  onChange: (value: string) => void
  className?: string
  fullWidth?: boolean
  size?: 'xs' | 'sm' | 'md'
  /**
   * `toggle` (default): a toggle group with `aria-pressed` buttons.
   * `tabs`: `role="tablist"` / `role="tab"` with `aria-selected`; arrow keys also select (automatic activation).
   */
  semantics?: 'toggle' | 'tabs'
  ariaLabel?: string
}

const NAVIGATION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'])

/**
 * Render a reusable segmented control with stable container tokens and themed hover states.
 * Keyboard: one Tab stop (the active item), arrow keys/Home/End move between enabled items.
 */
export function SegmentedControl({
  value,
  items,
  onChange,
  className,
  fullWidth = false,
  size = 'md',
  semantics = 'toggle',
  ariaLabel,
}: SegmentedControlProps) {
  const isTabs = semantics === 'tabs'
  const itemBaseClassName = size === 'xs'
    ? 'px-3 py-1.5 text-xs font-semibold'
    : size === 'sm'
      ? 'px-3 py-2 text-sm font-medium'
      : 'px-4 py-2 text-sm font-semibold'
  // Roving tab stop: the active item, or the first enabled one when nothing matches `value`.
  const tabStopValue = items.some((item) => item.value === value && !item.disabled)
    ? value
    : items.find((item) => !item.disabled)?.value

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!NAVIGATION_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) {
      return
    }

    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)'))
    const currentIndex = buttons.indexOf(event.target as HTMLButtonElement)
    if (buttons.length === 0 || currentIndex < 0) {
      return
    }

    event.preventDefault()
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (currentIndex + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
    const nextButton = buttons[nextIndex]
    nextButton.focus()

    const nextValue = nextButton.dataset.value
    if (isTabs && nextValue !== undefined && nextValue !== value) {
      onChange(nextValue)
    }
  }

  return (
    <div
      role={isTabs ? 'tablist' : 'group'}
      aria-label={ariaLabel}
      aria-orientation={isTabs ? 'horizontal' : undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        'inline-flex flex-wrap gap-1 rounded-sm border border-border bg-surface-container p-1',
        fullWidth && 'flex w-full',
        className,
      )}
    >
      {items.map((item) => {
        const isActive = value === item.value

        return (
          <button
            key={item.value}
            type="button"
            data-value={item.value}
            disabled={item.disabled}
            role={isTabs ? 'tab' : undefined}
            aria-selected={isTabs ? isActive : undefined}
            aria-pressed={isTabs ? undefined : isActive}
            tabIndex={item.value === tabStopValue ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={cn(
              'rounded-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50',
              fullWidth && 'flex-1',
              itemBaseClassName,
              isActive
                ? 'bg-background text-primary shadow-sm'
                : 'text-muted-foreground hover:bg-surface-high hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
