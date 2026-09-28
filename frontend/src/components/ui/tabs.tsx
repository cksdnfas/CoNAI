import * as React from 'react'
import { Tabs as TabsPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'

/** Radix Tabs root: roving arrow-key focus, `role="tablist"`/`tab`/`tabpanel` wiring. */
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-3', className)} {...props} />
}

/** Render the tab strip on the same tonal track as SegmentedControl. */
function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('inline-flex w-fit flex-wrap items-center gap-0.5 rounded-md bg-fill p-0.75', className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-sm px-4 py-2 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors outline-none',
        'hover:bg-fill hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40',
        'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-key',
        'disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
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
