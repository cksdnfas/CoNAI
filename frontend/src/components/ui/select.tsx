import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const selectVariants = cva(
  'w-full rounded-sm text-sm text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'h-9 border border-border bg-surface-low px-3 transition focus:border-primary',
        settings: 'theme-settings-control h-10 bg-surface-lowest focus:ring-1 focus:ring-primary',
        detail: 'h-10 border border-border bg-surface-high px-3 focus:border-primary',
        detailNested: 'h-10 border border-border bg-surface-container px-3 focus:border-primary',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

/** Render a reusable native select control with shared surface variants. */
function Select({ className, variant, ...props }: React.ComponentProps<'select'> & VariantProps<typeof selectVariants>) {
  return <select data-slot="select" className={cn(selectVariants({ variant }), className)} {...props} />
}

export { Select, selectVariants }
