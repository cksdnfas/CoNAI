import type { ComponentProps } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface DisclosureButtonProps extends Omit<ComponentProps<typeof Button>, 'variant' | 'size' | 'type' | 'asChild'> {
  open: boolean
  /** `start` for a label that can wrap to several lines: taller row, chevron on the first line. */
  align?: 'center' | 'start'
}

/**
 * The header of a section that folds open in place ("고급", a workflow field): a `nav` row with a chevron before the
 * label, whose hover wash bleeds 0.5rem past the content edges so the text lines up with the fields under it.
 * Children are the label (an overline `Text`, or a title with marks). Use `CollapsibleRow` for a hairline list row.
 */
function DisclosureButton({ open, align = 'center', className, children, ...props }: DisclosureButtonProps) {
  return (
    <Button
      type="button"
      variant="nav"
      size="sm"
      aria-expanded={open}
      data-slot="disclosure-button"
      className={cn('-mx-2 w-[calc(100%+1rem)] gap-2 px-2 has-[>svg]:px-2', align === 'start' && 'h-auto min-h-8 items-start py-2.5', className)}
      {...props}
    >
      <ChevronDown aria-hidden className={cn('text-muted-foreground transition-transform', !open && '-rotate-90', align === 'start' && 'mt-0.5')} />
      {children}
    </Button>
  )
}

export { DisclosureButton }
export type { DisclosureButtonProps }
