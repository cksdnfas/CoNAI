import type { ReactNode } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

export type TextTabItem<T extends string> = {
  value: T
  label: ReactNode
  /** Small mono count after the label. */
  count?: number | string | null
}

// Full width of its column and wrapping: a narrow column (the wallpaper inspector) gets a second row instead of tabs spilling past it.
// Never give the strip an overflow: the active underline sits 1px below the list, so any overflow box grows a stray scrollbar.
const TEXT_TAB_LIST_CLASS = 'flex h-auto w-full min-w-0 flex-1 flex-wrap justify-start gap-x-5 gap-y-1.5 rounded-none bg-transparent p-0'
const TEXT_TAB_TRIGGER_CLASS = 'relative shrink-0 rounded-none px-0 pt-0 pb-2 text-sm font-semibold text-muted-foreground hover:bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary after:opacity-0 data-[state=active]:after:opacity-100'

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
    <Tabs value={value} onValueChange={(next) => onChange(next as T)} className={cn('min-w-0 gap-0', className)}>
      <div className={cn('flex min-w-0 items-end gap-2', hairline && 'border-b border-line', stripClassName)}>
        <TabsList aria-label={ariaLabel} className={TEXT_TAB_LIST_CLASS}>
          {items.map((item) => (
            <TabsTrigger key={item.value} value={item.value} className={TEXT_TAB_TRIGGER_CLASS}>
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
