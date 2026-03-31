import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const textareaVariants = cva(
  'w-full rounded-sm text-sm text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'border border-border bg-surface-container px-3 py-2 transition focus:border-primary',
        settings: 'theme-settings-control border border-border bg-surface-container px-3 py-2 focus:ring-1 focus:ring-primary',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

/** Render a reusable textarea control with shared surface variants. */
function Textarea({ className, variant, ...props }: React.ComponentProps<'textarea'> & VariantProps<typeof textareaVariants>) {
  return <textarea data-slot="textarea" className={cn(textareaVariants({ variant }), className)} {...props} />
}

export { Textarea, textareaVariants }
