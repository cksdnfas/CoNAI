import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { cn } from '@/lib/utils'

/**
 * Tonal block surface (DESIGN_PRESET D1): separation by tone, never by outline.
 * Padding follows the appearance density tokens (--theme-panel-padding-x/y).
 */
const panelVariants = cva('min-w-0', {
  variants: {
    tone: {
      /** Recessed tray: inside a Section / Card, or for code, previews and lists on a raised parent. */
      lowest: 'bg-surface-lowest',
      /** Default plinth on the page background (same tone as Section). */
      low: 'bg-surface-low',
      container: 'bg-surface-container',
      /** Lifted block: selected rows, callouts, floating content. */
      high: 'bg-surface-high',
    },
    padding: {
      none: '',
      sm: 'px-[calc(var(--theme-panel-padding-x)*0.75)] py-[calc(var(--theme-panel-padding-y)*0.66)]',
      md: 'px-(--theme-panel-padding-x) py-(--theme-panel-padding-y)',
      lg: 'px-[calc(var(--theme-panel-padding-x)*1.5)] py-[calc(var(--theme-panel-padding-y)*1.5)]',
    },
    radius: {
      none: 'rounded-none',
      sm: 'rounded-sm',
      md: 'rounded-md',
    },
    /** Vertical stack with the density field gap between children. */
    stack: {
      true: 'flex flex-col gap-(--theme-field-gap)',
      false: '',
    },
    /** Clickable / selectable panel: hover lifts one tone, data-selected="true" tints with primary. */
    interactive: {
      true: 'cursor-pointer transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[selected=true]:bg-primary/12 aria-selected:bg-primary/12',
      false: '',
    },
  },
  compoundVariants: [
    { interactive: true, tone: 'lowest', className: 'hover:bg-surface-container' },
    { interactive: true, tone: 'low', className: 'hover:bg-surface-high' },
    { interactive: true, tone: 'container', className: 'hover:bg-surface-high' },
    { interactive: true, tone: 'high', className: 'hover:bg-surface-highest' },
  ],
  defaultVariants: {
    tone: 'low',
    padding: 'md',
    radius: 'sm',
    stack: false,
    interactive: false,
  },
})

type PanelTone = NonNullable<VariantProps<typeof panelVariants>['tone']>

/** data-surface drives the automatic tone of nested Section / Inset / EmptyState and of secondary Buttons. */
const PANEL_SURFACE: Record<PanelTone, 'recessed' | 'raised' | 'high'> = {
  lowest: 'recessed',
  low: 'raised',
  container: 'raised',
  high: 'high',
}

type PanelProps = ComponentProps<'div'> & VariantProps<typeof panelVariants> & {
  /** Render the child element (e.g. <li>, <section>, <a>) with the panel classes instead of a <div>. */
  asChild?: boolean
}

/** Render a tonal panel: the building block for ad-hoc boxes that are not a full Section. */
function Panel({ className, tone, padding, radius, stack, interactive, asChild = false, ...props }: PanelProps) {
  const Comp = asChild ? Slot.Root : 'div'

  return (
    <Comp
      data-slot="panel"
      data-surface={PANEL_SURFACE[tone ?? 'low']}
      className={cn(panelVariants({ tone, padding, radius, stack, interactive }), className)}
      {...props}
    />
  )
}

export { Panel, panelVariants }
export type { PanelProps }
