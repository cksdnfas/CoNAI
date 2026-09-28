import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { cn } from '@/lib/utils'

/**
 * Small inline pieces of user content (tags, filters, tokens, search terms). Unlike Badge (an uppercase status
 * label) a chip keeps the text's own case and weight, so it suits free text in any language.
 */
const chipVariants = cva(
  'inline-flex max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-sm whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        /** Neutral piece on a plinth or card. */
        default: 'bg-surface-high text-foreground',
        /** Quieter piece; translucent, so it reads on any surface tone. */
        muted: 'bg-foreground/5 text-muted-foreground',
        /** Selected / current value. */
        primary: 'bg-primary/12 text-primary',
        success: 'bg-success-soft text-success-soft-foreground',
        warning: 'bg-warning-soft text-warning-soft-foreground',
        info: 'bg-info-soft text-info-soft-foreground',
        destructive: 'bg-destructive-soft text-destructive-soft-foreground',
      },
      size: {
        sm: 'px-1.5 py-0.5 text-2xs [&_svg:not([class*=size-])]:size-3',
        md: 'px-2 py-1 text-xs [&_svg:not([class*=size-])]:size-3.5',
      },
    },
    defaultVariants: {
      tone: 'default',
      size: 'md',
    },
  },
)

type ChipProps = ComponentProps<'span'> & VariantProps<typeof chipVariants> & {
  asChild?: boolean
}

/** Render a static chip. For a pressable on/off chip use ToggleChip. */
function Chip({ className, tone, size, asChild = false, ...props }: ChipProps) {
  const Comp = asChild ? Slot.Root : 'span'

  return <Comp data-slot="chip" className={cn(chipVariants({ tone, size }), className)} {...props} />
}

const toggleChipVariants = cva(
  [
    'inline-flex max-w-full min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-sm font-medium whitespace-nowrap transition-colors outline-none',
    'bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
    'aria-pressed:bg-primary/12 aria-pressed:text-primary aria-pressed:hover:bg-primary/16 aria-pressed:hover:text-primary',
    'focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      size: {
        sm: 'h-6 px-2 text-2xs [&_svg:not([class*=size-])]:size-3',
        md: 'h-8 px-3 text-xs [&_svg:not([class*=size-])]:size-3.5',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
)

type ToggleChipProps = Omit<ComponentProps<'button'>, 'aria-pressed'> & VariantProps<typeof toggleChipVariants> & {
  /** On/off state, announced as aria-pressed. */
  pressed: boolean
}

/** Render a pressable filter / option chip with aria-pressed state (multi-select filters, category toggles). */
function ToggleChip({ className, size, pressed, type = 'button', ...props }: ToggleChipProps) {
  return (
    <button
      data-slot="toggle-chip"
      type={type}
      aria-pressed={pressed}
      className={cn(toggleChipVariants({ size }), className)}
      {...props}
    />
  )
}

export { Chip, ToggleChip, chipVariants, toggleChipVariants }
export type { ChipProps, ToggleChipProps }
