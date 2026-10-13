import * as React from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { stopAtPortalEdge } from '@/lib/portal-events'
import { cn } from '@/lib/utils'
import { floatingMotionClassName, floatingSurfaceClassName } from './floating-surface'

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverAnchor(props: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverClose(props: React.ComponentProps<typeof PopoverPrimitive.Close>) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />
}

/** Render a floating panel in a body portal (above modals) on a raised tonal surface. */
function PopoverContent({ className, align = 'center', sideOffset = 6, onClick, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        data-surface="high"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          floatingSurfaceClassName,
          floatingMotionClassName,
          'z-floating w-72 max-w-[calc(100vw-2rem)] origin-(--radix-popover-content-transform-origin) p-4 text-sm text-foreground outline-none',
          className,
        )}
        onClick={stopAtPortalEdge(onClick)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverTrigger }
