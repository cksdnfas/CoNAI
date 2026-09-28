import { useState, type ComponentProps, type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { ChevronDown } from 'lucide-react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { Button } from './button'

/**
 * Flat by default (DESIGN_PRESET "Flat"): a heading row + content on the page tone, no box, no padding. Separate
 * sections with spacing on the parent (`space-y-6`/`space-y-8`). `tone="raised"` keeps the old tonal plinth for
 * the rare block that must read as a surface (a floating controller, a standalone card on a busy canvas).
 */
const sectionVariants = cva('min-w-0', {
  variants: {
    variant: {
      page: '',
      settings: '',
      drawer: '',
      controller: '',
    },
    tone: {
      flat: '',
      raised: 'ui-tone-plinth overflow-hidden rounded-sm',
    },
  },
  defaultVariants: {
    variant: 'page',
    tone: 'flat',
  },
})

type SectionVariant = NonNullable<VariantProps<typeof sectionVariants>['variant']>
type SectionTone = NonNullable<VariantProps<typeof sectionVariants>['tone']>

type SectionHeadingElement = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'div'

type SectionSlots = {
  header: string
  headerRow?: string
  titleBlock: string
  heading: string
  headingAs: SectionHeadingElement
  actions: string
  body: string
}

const sectionSlots: Record<SectionVariant, SectionSlots> = {
  page: {
    header: 'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between',
    titleBlock: 'min-w-0 flex-1',
    heading: 'text-base font-semibold tracking-tight text-foreground',
    headingAs: 'h2',
    actions: 'flex shrink-0 flex-wrap items-center gap-2',
    body: 'space-y-4',
  },
  settings: {
    header: 'flex min-h-8 items-center justify-between gap-3',
    titleBlock: 'min-w-0 flex-1',
    heading: 'text-sm font-semibold tracking-tight text-foreground',
    headingAs: 'h3',
    actions: 'flex shrink-0 items-center gap-2',
    body: 'space-y-4',
  },
  drawer: {
    header: 'flex min-h-8 items-center justify-between gap-3',
    titleBlock: 'min-w-0 flex-1',
    heading: 'text-2xs font-semibold uppercase tracking-overline text-muted-foreground',
    headingAs: 'div',
    actions: 'flex shrink-0 items-center gap-2',
    body: '',
  },
  controller: {
    header: '',
    headerRow: 'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between',
    titleBlock: 'min-w-0',
    heading: 'text-base font-semibold tracking-tight text-foreground',
    headingAs: 'p',
    actions: 'flex flex-wrap gap-2',
    body: 'space-y-4',
  },
}

/** Padding added around header and body when the section is a raised plinth (`tone="raised"`). */
const RAISED_SLOT_PADDING = { header: 'px-4 py-3', body: 'px-4 py-4' }

type SectionProps = ComponentProps<'section'> & VariantProps<typeof sectionVariants> & {
  /** `flat` (default): heading + content, no surface. `raised`: the tonal plinth, for blocks that truly float. */
  tone?: SectionTone
  heading?: ReactNode
  headingAs?: SectionHeadingElement
  description?: ReactNode
  actions?: ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
  headerClassName?: string
  bodyClassName?: string
}

/** Render one content section: an optional heading row (title, description, actions) and a collapsible body. */
function Section({
  variant,
  tone,
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
  const isRaised = tone === 'raised'
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
    <section
      data-slot="section"
      data-tone={isRaised ? 'raised' : 'flat'}
      data-surface={isRaised ? 'raised' : undefined}
      className={cn(sectionVariants({ variant, tone }), className)}
      {...props}
    >
      {hasHeader ? (
        <div className={cn(slots.header, isRaised && RAISED_SLOT_PADDING.header, headerClassName)}>
          {slots.headerRow ? <div className={slots.headerRow}>{headerContent}</div> : headerContent}
        </div>
      ) : null}
      {/* No divider under the header: a short gap keeps heading and content apart by spacing. */}
      {isOpen ? (
        <div className={cn(slots.body, isRaised ? RAISED_SLOT_PADDING.body : hasHeader && 'pt-2', isRaised && hasHeader && 'pt-1', bodyClassName)}>
          {children}
        </div>
      ) : null}
    </section>
  )
}

export { Section, sectionVariants }
