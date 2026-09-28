import * as React from 'react'
import { Checkbox as CheckboxPrimitive } from 'radix-ui'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Render an accessible checkbox (Radix) with checked, indeterminate and invalid states. */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer group/checkbox inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-muted-foreground/55 bg-surface-lowest text-primary-foreground transition-colors outline-none',
        'hover:border-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
        'aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="flex items-center justify-center text-current">
        <Check className="size-3.5 stroke-[3] group-data-[state=indeterminate]/checkbox:hidden" />
        <Minus className="hidden size-3.5 stroke-[3] group-data-[state=indeterminate]/checkbox:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
