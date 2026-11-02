import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type TextTabItem<T extends string> = {
  value: T
  label: ReactNode
  /** Shown before the label; when the strip runs out of room, only the icons stay (the label becomes the tooltip). */
  icon?: LucideIcon
  /** A state mark after the label (input needed, filled in) that stays visible when the strip folds. */
  mark?: ReactNode
  /** Small mono count after the label. */
  count?: number | string | null
}

/**
 * Underlined text tabs (the app's in-place tab style) on one hairline, with an optional trailing slot for icon actions.
 * The one tab strip of the app: never hand-roll TabsList/TabsTrigger classes in a feature.
 * Content: either the caller renders it for the active value, or passes `TabsContent` children (for forceMount panes).
 * Tabs with icons fold to icons alone when their names do not fit on one line.
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
  const listRef = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)
  // The named strip's width when it last overflowed: the names come back once the strip has that much room again.
  const namedWidthRef = useRef(0)
  const foldable = items.some((item) => item.icon)
  const itemsKey = items.map((item) => item.value).join('\n')
  useLayoutEffect(() => {
    const list = listRef.current
    if (!foldable || !list) return
    const fit = () => {
      if (!compact) {
        if (list.scrollWidth > list.clientWidth + 1) {
          namedWidthRef.current = list.scrollWidth
          setCompact(true)
        }
      } else if (list.clientWidth >= namedWidthRef.current) setCompact(false)
    }
    fit()
    // The tabs themselves too: a name or count that grows changes no size of the list.
    const observer = new ResizeObserver(fit)
    observer.observe(list)
    for (const tab of list.children) observer.observe(tab)
    return () => observer.disconnect()
  }, [foldable, compact, itemsKey])

  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as T)} flush className={cn('min-w-0', className)}>
      <div className={cn('flex min-w-0 items-end gap-2', hairline && 'border-b border-line', stripClassName)}>
        {/* Named tabs stay on one line so an overflow shows up as width; folded icons may wrap. */}
        <TabsList ref={listRef} aria-label={ariaLabel} variant="text" className={cn(foldable && !compact && 'flex-nowrap')}>
          {items.map((item) => {
            const Icon = item.icon
            const folded = compact && Icon !== undefined
            const tab = (
              <TabsTrigger key={item.value} value={item.value} variant="text">
                {/* One text line tall, so a folded strip keeps the named strip's height. */}
                {Icon ? <span className="flex h-[1lh] items-center"><Icon aria-hidden /></span> : null}
                <span className={cn(folded && 'sr-only')}>{item.label}</span>
                {item.mark}
                {item.count !== undefined && item.count !== null ? (
                  <span className="ml-1 font-mono text-2xs font-normal text-muted-foreground">{item.count}</span>
                ) : null}
              </TabsTrigger>
            )
            if (!Icon) return tab
            // A tab with an icon keeps one wrapper folded or not, so a fold does not remount (and unfocus) it. The
            // tooltip sits on the wrapper: on the tab, its data-state would replace the tab's active state.
            return (
              <Tooltip key={item.value}>
                <TooltipTrigger asChild><span className="flex">{tab}</span></TooltipTrigger>
                {folded ? <TooltipContent side="bottom">{item.label}</TooltipContent> : null}
              </Tooltip>
            )
          })}
        </TabsList>
        {actions ? <div className="flex shrink-0 items-center gap-0.5 pb-1">{actions}</div> : null}
      </div>
      {children}
    </Tabs>
  )
}
