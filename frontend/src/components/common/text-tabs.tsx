import type { ReactNode } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

export type TextTabItem<T extends string> = {
  value: T
  label: ReactNode
  /** Small mono count after the label. */
  count?: number | string | null
}

/**
 * Underlined text tabs (the app's in-place tab style) on one hairline, with an optional trailing slot for icon actions.
 * The one tab strip of the app: never hand-roll TabsList/TabsTrigger classes in a feature.
 * Content: either the caller renders it for the active value, or passes `TabsContent` children (for forceMount panes).
 */
export function TextTabs<T extends string>({
  value,
  items,
  onChange,
  actions,
  ariaLabel,
  hairline = true,
  className,
  stripClassName,
  children,
}: {
  value: T
  items: Array<TextTabItem<T>>
  onChange: (value: T) => void
  actions?: ReactNode
  ariaLabel?: string
  /** The bottom rule under the strip; off where the surrounding bar already draws one. */
  hairline?: boolean
  className?: string
  stripClassName?: string
  /** `TabsContent` panes under the strip. */
  children?: ReactNode
}) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as T)} flush className={cn('min-w-0', className)}>
      <div className={cn('flex min-w-0 items-end gap-2', hairline && 'border-b border-line', stripClassName)}>
        <TabsList aria-label={ariaLabel} variant="text">
          {items.map((item) => (
            <TabsTrigger key={item.value} value={item.value} variant="text">
              {item.label}
              {item.count !== undefined && item.count !== null ? (
                <span className="ml-1 font-mono text-2xs font-normal text-muted-foreground">{item.count}</span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {actions ? <div className="flex shrink-0 items-center gap-0.5 pb-1">{actions}</div> : null}
      </div>
      {children}
    </Tabs>
  )
}
