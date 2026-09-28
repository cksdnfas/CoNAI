import type { ComponentPropsWithoutRef, ElementType } from 'react'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const headingVariants = cva('font-semibold tracking-tight text-foreground', {
  variants: {
    level: {
      /** Page title (PageHeader). */
      1: 'text-2xl',
      /** Section title (SectionHeading, Section). */
      2: 'text-xl',
      /** Subsection title inside a section or card. */
      3: 'text-base',
    },
  },
  defaultVariants: {
    level: 2,
  },
})

type HeadingLevel = 1 | 2 | 3

type HeadingElement = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'div'

interface HeadingProps extends ComponentPropsWithoutRef<'h2'> {
  level?: HeadingLevel
  /** Override the element when the visual level and document outline differ. Defaults to `h{level}`. */
  as?: HeadingElement
}

/** Render a document heading with the shared page/section/subsection scale. */
function Heading({ level = 2, as, className, ...props }: HeadingProps) {
  const Comp: ElementType = as ?? `h${level}`

  return <Comp data-slot="heading" className={cn(headingVariants({ level }), className)} {...props} />
}

export { Heading, headingVariants }
export type { HeadingLevel, HeadingProps }
