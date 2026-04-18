import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const inputVariants = cva(
  'w-full rounded-sm text-sm text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'theme-input-surface h-9 border px-3 transition focus:border-primary',
        settings: 'theme-settings-control theme-input-surface h-10 border focus:ring-1 focus:ring-primary',
        detail: 'theme-input-surface h-10 border px-3 focus:border-primary',
        detailNested: 'theme-input-surface h-10 border px-3 focus:border-primary',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

/** Render a reusable text-like input control with shared surface variants. */
function Input({ className, variant, type = 'text', ...props }: React.ComponentProps<'input'> & VariantProps<typeof inputVariants>) {
  return <input type={type} data-slot="input" className={cn(inputVariants({ variant }), className)} {...props} />
}

export { Input, inputVariants }
