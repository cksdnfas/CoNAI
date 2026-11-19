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
        inline: 'h-6 w-auto max-w-full cursor-pointer field-sizing-content bg-transparent px-1 text-xs text-muted-foreground hover:bg-field focus:border-transparent focus:ring-0 focus-visible:ring-2 focus-visible:ring-primary/15',
        node: 'nodrag nowheel h-6 min-w-0 w-full appearance-none truncate bg-surface-high px-1.5 pr-5 text-xs text-foreground focus:border-transparent focus:ring-0 focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60',
        nodeWidget: 'nodrag nowheel h-6 min-w-0 w-auto max-w-full cursor-pointer appearance-none truncate bg-transparent text-right text-xs text-foreground [field-sizing:content] [&_option]:bg-surface-high [&_option]:text-left focus:border-transparent focus:ring-0 focus-visible:underline focus-visible:decoration-muted-foreground/60 disabled:opacity-60',
        nodeVariant: 'nodrag nopan nowheel h-6 min-w-0 w-auto max-w-[125px] border border-line bg-surface-high px-1 text-2xs text-foreground disabled:opacity-50',
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
