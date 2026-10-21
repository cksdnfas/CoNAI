import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const selectVariants = cva(
  'w-full rounded-sm text-sm text-foreground outline-none transition-[background-color,border-color,box-shadow] focus:border-primary/55 focus:ring-2 focus:ring-primary/15 aria-invalid:border-destructive/70 aria-invalid:focus:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'theme-input-surface h-9 border px-3',
        settings: 'theme-settings-control theme-input-surface h-9 border',
        detail: 'theme-input-surface h-10 border px-3',
        detailNested: 'theme-input-surface h-10 border px-3',
      },
      controlSize: { compact: 'h-7 px-2 text-xs' },
      mono: { true: 'font-mono tabular-nums', false: '' },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

/** Render a reusable native select control with shared surface variants. */
function Select({ className, variant, controlSize, mono, ...props }: React.ComponentProps<'select'> & VariantProps<typeof selectVariants>) {
  return <select data-slot="select" className={cn(selectVariants({ variant, controlSize, mono }), className)} {...props} />
}

export { Select, selectVariants }
