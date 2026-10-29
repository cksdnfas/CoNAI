import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const inputVariants = cva(
  'w-full rounded-sm text-sm text-foreground outline-none transition-[background-color,border-color,box-shadow] focus:border-primary/55 focus:ring-2 focus:ring-primary/15 aria-invalid:border-destructive/70 aria-invalid:focus:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'theme-input-surface h-9 border px-3',
        settings: 'theme-settings-control theme-input-surface h-9 border',
        detail: 'theme-input-surface h-10 border px-3',
        detailNested: 'theme-input-surface h-10 border px-3',
        /** A document title typed in place (post editor): heading type over one hairline, no field box. */
        title: 'rounded-none border-b border-line bg-transparent pb-2 text-2xl font-bold placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-0',
        /** The text slot inside a caller-framed field (tag chips box): no surface or ring of its own. */
        bare: 'bg-transparent placeholder:text-muted-foreground focus:ring-0',
      },
      controlSize: { compact: 'h-7 px-2 text-xs' },
      mono: { true: 'font-mono tabular-nums', false: '' },
      /** Space for SearchField's leading icon and trailing clear key. */
      adornments: { search: 'pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden' },
      assisted: { true: 'ring-1 ring-primary/50', false: '' },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

/** Render a reusable text-like input control with shared surface variants. */
function Input({ className, variant, controlSize, mono, adornments, assisted, type = 'text', ...props }: React.ComponentProps<'input'> & VariantProps<typeof inputVariants>) {
  return <input type={type} data-slot="input" className={cn(inputVariants({ variant, controlSize, mono, adornments, assisted }), className)} {...props} />
}

export { Input, inputVariants }
