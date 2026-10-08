import type { ReactNode } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

export type TextTabItem<T extends string> = {
  value: T
  label: ReactNode
  /** Small mono count after the label. */
  count?: number | string | null
}

const TEXT_TAB_LIST_CLASS = 'flex min-w-0 flex-1 flex-nowrap gap-5 overflow-x-auto rounded-none bg-transparent p-0 [scrollbar-width:none]'
const TEXT_TAB_TRIGGER_CLASS = 'relative shrink-0 rounded-none px-0 pt-0 pb-2 text-sm font-semibold text-muted-foreground hover:bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary after:opacity-0 data-[state=active]:after:opacity-100'

/**
 * Underlined text tabs (the app's in-place tab style) on one hairline, with an optional trailing slot for icon actions.
 * Only the strip: the caller renders the content for the active value.
 */
export function TextTabs<T extends string>({
  value,
  items,
  onChange,
  actions,
  ariaLabel,
  className,
}: {
  value: T
  items: Array<TextTabItem<T>>
  onChange: (value: T) => void
  actions?: ReactNode
  ariaLabel?: string
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 items-end gap-2 border-b border-line', className)}>
      <Tabs value={value} onValueChange={(next) => onChange(next as T)} className="min-w-0 flex-1 gap-0">
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
      </Tabs>
      {actions ? <div className="flex shrink-0 items-center gap-0.5 pb-1">{actions}</div> : null}
    </div>
  )
}
