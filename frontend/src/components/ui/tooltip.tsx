import * as React from 'react'
import { Tooltip as TooltipPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'

/** Share tooltip open/skip delays; mounted once in AppProviders. */
function TooltipProvider({ delayDuration = 400, skipDelayDuration = 200, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration} {...props} />
}

function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

/** Render the floating tooltip bubble in a body portal, above modals. */
function TooltipContent({ className, sideOffset = 6, children, ...props }: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-floating max-w-72 origin-(--radix-tooltip-content-transform-origin) rounded-sm bg-surface-bright px-2 py-1 text-xs font-medium text-balance text-foreground shadow-elevation-1',
          'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 motion-reduce:animate-none',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

interface TipProps extends Pick<React.ComponentProps<typeof TooltipPrimitive.Content>, 'side' | 'align' | 'sideOffset'> {
  /** Tooltip text. Nothing (null/empty) renders the child alone. */
  content: React.ReactNode
  /** One element that can hold a ref (Button, a, span…); it becomes the trigger via `asChild`. */
  children: React.ReactElement
  delayDuration?: number
  className?: string
}

/** Wrap one element with a tooltip: `<Tip content="Delete"><Button …/></Tip>`. */
function Tip({ content, children, side, align, sideOffset, delayDuration, className }: TipProps) {
  if (content === null || content === undefined || content === false || content === '') {
    return children
  }

  return (
    <Tooltip delayDuration={delayDuration}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align} sideOffset={sideOffset} className={className}>
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

export { Tip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
