import * as React from 'react'
import { Switch as SwitchPrimitive } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const switchVariants = cva(
  'peer group/switch inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-surface-highest aria-invalid:ring-1 aria-invalid:ring-destructive',
  {
    variants: {
      size: {
        default: 'h-5 w-9',
        sm: 'h-4 w-7',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
)

/** Render an accessible on/off switch (Radix, `role="switch"`). */
function Switch({ className, size = 'default', ...props }: React.ComponentProps<typeof SwitchPrimitive.Root> & VariantProps<typeof switchVariants>) {
  return (
    <SwitchPrimitive.Root data-slot="switch" data-size={size} className={cn(switchVariants({ size }), className)} {...props}>
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block aspect-square h-full rounded-full shadow-key transition-transform motion-reduce:transition-none',
          'data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary-foreground data-[state=unchecked]:translate-x-0 data-[state=unchecked]:bg-muted-foreground',
          size === 'sm' && 'data-[state=checked]:translate-x-3',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch, switchVariants }
