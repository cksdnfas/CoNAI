import type { ComponentPropsWithoutRef, ElementType } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const textVariants = cva('', {
  variants: {
    variant: {
      /** Small uppercase kicker above a title, value or field group. */
      overline: 'text-2xs font-semibold uppercase tracking-overline text-muted-foreground',
      /** Field and row labels — the codebase's most repeated text style. */
      label: 'text-sm font-medium text-foreground',
      body: 'text-sm text-foreground',
      /** Secondary body copy such as descriptions under a heading. */
      muted: 'text-sm text-muted-foreground',
      caption: 'text-xs text-muted-foreground',
      /** Inline card/row title that is not a document heading. */
      title: 'text-sm font-semibold text-foreground',
    },
    tone: {
      default: 'text-foreground',
      muted: 'text-muted-foreground',
      primary: 'text-primary',
      secondary: 'text-secondary-text',
      destructive: 'text-destructive',
      success: 'text-success',
      warning: 'text-warning',
      info: 'text-info',
      inherit: 'text-inherit',
    },
    mono: { true: 'font-mono tabular-nums', false: '' },
  },
  defaultVariants: {
    variant: 'body',
  },
})

type TextElement = 'p' | 'span' | 'div' | 'label' | 'dt' | 'dd' | 'li' | 'strong' | 'small' | 'legend' | 'figcaption'

type TextProps<T extends TextElement = 'p'> = {
  /** Rendered element; defaults to `p`. */
  as?: T
} & VariantProps<typeof textVariants> & Omit<ComponentPropsWithoutRef<T>, 'as'>

/** Render text in one of the shared type roles. */
function Text<T extends TextElement = 'p'>({ as, variant, tone, mono, className, ...props }: TextProps<T>) {
  // The element union is too wide for TS to check spread props per tag; `TextProps<T>` already did.
  const Comp = (as ?? 'p') as ElementType<ComponentPropsWithoutRef<'p'>>

  return <Comp data-slot="text" className={cn(textVariants({ variant, tone, mono }), className)} {...(props as ComponentPropsWithoutRef<'p'>)} />
}

export { Text, textVariants }
export type { TextProps }
