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
}

/** Render the standard page/modal tab bar used across shared segmented-tab sections. */
export function SegmentedTabBar({
  value,
  items,
  onChange,
  className,
  controlClassName,
  actions,
  fullWidth = false,
  size = 'md',
}: SegmentedTabBarProps) {
  return (
    <div className={cn(actions ? 'flex flex-wrap items-center justify-between gap-3' : undefined, 'border-b border-border/70 pb-2', className)}>
      <div className={cn(actions && 'min-w-0 flex-1')}>
        <SegmentedControl
          value={value}
          items={items}
          onChange={onChange}
          className={controlClassName}
          fullWidth={fullWidth}
          size={size}
        />
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
