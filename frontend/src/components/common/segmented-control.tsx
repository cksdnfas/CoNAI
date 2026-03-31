import type { ReactNode } from 'react'
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
}

/** Render a reusable segmented control with stable container tokens and themed hover states. */
export function SegmentedControl({
  value,
  items,
  onChange,
  className,
  fullWidth = false,
  size = 'md',
}: SegmentedControlProps) {
  const itemBaseClassName = size === 'xs'
    ? 'px-3 py-1.5 text-xs font-semibold'
    : size === 'sm'
      ? 'px-3 py-2 text-sm font-medium'
      : 'px-4 py-2 text-sm font-semibold'

  return (
    <div
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
            disabled={item.disabled}
            aria-pressed={isActive}
            onClick={() => onChange(item.value)}
            className={cn(
              'rounded-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
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
