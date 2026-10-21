import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const textareaVariants = cva(
  'w-full rounded-sm text-sm text-foreground outline-none transition-[background-color,border-color,box-shadow] focus:border-primary/55 focus:ring-2 focus:ring-primary/15 aria-invalid:border-destructive/70 aria-invalid:focus:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'theme-input-surface border px-3 py-2',
        settings: 'theme-settings-control theme-input-surface border px-3 py-2',
        detail: 'theme-input-surface border px-3 py-2',
        detailNested: 'theme-input-surface border px-3 py-2',
      },
      mono: { true: 'font-mono', false: '' },
      textSize: { xs: 'text-xs', sm: 'text-sm' },
      assisted: { true: 'ring-1 ring-primary/50', false: '' },
      autoGrow: { true: 'max-h-96 min-h-16 [field-sizing:content]', false: '' },
      /** De-emphasised but still editable text (e.g. summary stretches folded into the plot). */
      muted: { true: 'text-muted-foreground', false: '' },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

/** Render a reusable textarea control with shared surface variants. */
const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'> & VariantProps<typeof textareaVariants>>(
  ({ className, variant, mono, textSize, assisted, autoGrow, muted, ...props }, ref) => {
    return <textarea ref={ref} data-slot="textarea" className={cn(textareaVariants({ variant, mono, textSize, assisted, autoGrow, muted }), className)} {...props} />
  },
)

Textarea.displayName = 'Textarea'

export { Textarea, textareaVariants }
