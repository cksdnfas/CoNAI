import { useState, type ComponentProps, type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { ChevronDown } from 'lucide-react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { Button } from './button'

// Tonal plinth, no outline (DESIGN_PRESET D1): surface-low on the page, recessed to surface-lowest when nested
// inside another raised surface (Section, Card, Panel, drawer). Variants differ only in their header typography.
const sectionVariants = cva('overflow-hidden rounded-sm bg-surface-low in-data-[surface=raised]:bg-surface-lowest', {
  variants: {
    variant: {
      page: '',
      settings: '',
      drawer: '',
      controller: '',
    },
  },
  defaultVariants: {
    variant: 'page',
  },
})

type SectionVariant = NonNullable<VariantProps<typeof sectionVariants>['variant']>

type SectionHeadingElement = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'div'

const sectionSlots: Record<SectionVariant, {
  header: string
  headerRow?: string
  titleBlock: string
  heading: string
  headingAs: SectionHeadingElement
  actions: string
  body: string
}> = {
  page: {
    header: 'flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between',
    titleBlock: 'min-w-0 flex-1',
    heading: 'text-xl font-semibold tracking-tight text-foreground',
    headingAs: 'h2',
    actions: 'flex shrink-0 flex-wrap items-center gap-2',
    body: 'space-y-4 px-4 py-4',
  },
  settings: {
    header: 'flex items-center justify-between gap-3 px-4 py-3',
    titleBlock: 'min-w-0 flex-1',
    heading: 'text-xl font-semibold tracking-tight text-foreground',
    headingAs: 'p',
    actions: 'flex shrink-0 items-center gap-2',
    body: 'space-y-4 px-4 py-4',
  },
  drawer: {
    header: 'flex items-center justify-between gap-3 px-4 py-3',
    titleBlock: 'min-w-0 flex-1',
    heading: 'text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground',
    headingAs: 'div',
    actions: 'flex shrink-0 items-center gap-2',
    body: 'px-4 py-4',
  },
  controller: {
    header: 'px-4 py-3',
    headerRow: 'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
    titleBlock: 'min-w-0',
    heading: 'text-xl font-semibold tracking-tight text-foreground',
    headingAs: 'p',
    actions: 'flex flex-wrap gap-2',
    body: 'space-y-4 px-4 py-4',
  },
}

type SectionProps = ComponentProps<'section'> & VariantProps<typeof sectionVariants> & {
  heading?: ReactNode
  headingAs?: SectionHeadingElement
  description?: ReactNode
  actions?: ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
  headerClassName?: string
  bodyClassName?: string
}

/** Render one tonal content section with an optional heading row and collapsible body. */
function Section({
  variant,
  heading,
  headingAs,
  description,
  actions,
  collapsible = false,
  defaultOpen = true,
  children,
  className,
  headerClassName,
  bodyClassName,
  ...props
}: SectionProps) {
  const { t } = useI18n()
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const slots = sectionSlots[variant ?? 'page']
  const Heading = headingAs ?? slots.headingAs
  const hasHeader = Boolean(heading || description || actions || collapsible)
  const toggleLabel = isOpen
    ? t({ ko: '섹션 접기', en: 'Collapse section' })
    : t({ ko: '섹션 펼치기', en: 'Expand section' })

  const headerContent = (
    <>
      <div className={slots.titleBlock}>
        {heading ? <Heading className={slots.heading}>{heading}</Heading> : null}
        {description ? <div className="mt-1 text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {actions || collapsible ? (
        <div className={slots.actions}>
          {actions}
          {collapsible ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => setIsOpen((current) => !current)}
              aria-expanded={isOpen}
              aria-label={toggleLabel}
            >
              <ChevronDown className={cn('h-4 w-4 transition-transform', !isOpen && '-rotate-90')} />
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  )

  return (
    <section data-slot="section" data-surface="raised" className={cn(sectionVariants({ variant }), className)} {...props}>
      {hasHeader ? (
        <div className={cn(slots.header, headerClassName)}>
          {slots.headerRow ? <div className={slots.headerRow}>{headerContent}</div> : headerContent}
        </div>
      ) : null}
      {/* No divider under the header: a short top gap on the body keeps the two apart by spacing. */}
      {isOpen ? <div className={cn(slots.body, hasHeader && 'pt-1', bodyClassName)}>{children}</div> : null}
    </section>
  )
}

export { Section, sectionVariants }
