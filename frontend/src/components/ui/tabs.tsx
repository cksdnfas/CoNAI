import * as React from 'react'
import { Tabs as TabsPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'

type TabAppearance = 'segment' | 'text' | 'field'
type TabAppearanceProps = { variant?: TabAppearance; bare?: boolean }

const LIST_APPEARANCE: Record<TabAppearance, string> = {
  segment: 'inline-flex w-fit flex-wrap items-center gap-0.5 rounded-md bg-fill p-0.75',
  text: 'flex h-auto w-full min-w-0 flex-1 flex-wrap justify-start gap-x-5 gap-y-1.5 rounded-none bg-transparent p-0',
  field: 'flex h-auto w-full justify-start gap-4 rounded-none border-b border-line bg-transparent px-3 pt-2 pb-0',
}
const UNDERLINE_TRIGGER = 'relative rounded-none px-0 pt-0 text-muted-foreground hover:bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary after:opacity-0 data-[state=active]:after:opacity-100'

/** Radix Tabs root: roving arrow-key focus, `role="tablist"`/`tab`/`tabpanel` wiring. */
function Tabs({ className, flush = false, ...props }: React.ComponentProps<typeof TabsPrimitive.Root> & { flush?: boolean }) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col', flush ? 'gap-0' : 'gap-3', className)} {...props} />
}

/** Render the tab strip on the same tonal track as SegmentedControl. */
function TabsList({ className, variant = 'segment', bare = false, ...props }: React.ComponentProps<typeof TabsPrimitive.List> & TabAppearanceProps) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(LIST_APPEARANCE[variant], variant === 'field' && bare && 'min-h-9 items-center border-b-0 py-0', className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, variant = 'segment', bare = false, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger> & TabAppearanceProps) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-sm px-4 py-2 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors outline-none',
        'hover:bg-fill hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40',
        'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-key',
        'disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
        variant !== 'segment' && UNDERLINE_TRIGGER,
        variant === 'text' && 'shrink-0 pb-2',
        variant === 'field' && 'flex-none pb-1.5 text-xs',
        variant === 'field' && bare && 'py-1',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40', className)}
      {...props}
    />
  )
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
