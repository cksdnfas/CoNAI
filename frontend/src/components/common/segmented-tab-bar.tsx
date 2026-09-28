import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { SegmentedControl, type SegmentedControlItem } from './segmented-control'

type SegmentedTabBarProps = {
  value: string
  items: SegmentedControlItem[]
  onChange: (value: string) => void
  className?: string
  controlClassName?: string
  actions?: ReactNode
  fullWidth?: boolean
  size?: 'xs' | 'sm' | 'md'
  /** Accessible name for the tab list, e.g. the section it switches. */
  ariaLabel?: string
}

/** Render the standard page/modal tab bar used across shared segmented-tab sections, with tablist/tab semantics. */
export function SegmentedTabBar({
  value,
  items,
  onChange,
  className,
  controlClassName,
  actions,
  fullWidth = false,
  size = 'md',
  ariaLabel,
}: SegmentedTabBarProps) {
  return (
    <div className={cn(actions ? 'flex flex-wrap items-center justify-between gap-3' : undefined, className)}>
      <div className={cn(actions && 'min-w-0 flex-1')}>
        <SegmentedControl
          value={value}
          items={items}
          onChange={onChange}
          className={controlClassName}
          fullWidth={fullWidth}
          size={size}
          semantics="tabs"
          ariaLabel={ariaLabel}
        />
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
