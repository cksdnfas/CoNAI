import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { X } from 'lucide-react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { IconButton } from './icon-button'

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
      mono: { true: 'font-mono tabular-nums', false: '' },
    },
    defaultVariants: {
      tone: 'default',
      size: 'md',
    },
  },
)

type ChipProps = ComponentProps<'span'> & VariantProps<typeof chipVariants> & {
  asChild?: boolean
  /** Adds a trailing X key that calls this (tag lists, applied filters, keyword lists). Ignored with `asChild`. */
  onRemove?: () => void
  /** Aria-label + tooltip of the X key. Defaults to "빼기". */
  removeLabel?: string
  removeDisabled?: boolean
}

/** The X key at the end of a removable chip; sized to the chip so the row height does not change. */
function ChipRemoveKey({ size, label, disabled, onRemove }: { size: ChipProps['size']; label?: string; disabled?: boolean; onRemove: () => void }) {
  const { t } = useI18n()
  return (
    <IconButton
      size="icon-xs"
      variant="ghost"
      className={cn('text-current hover:text-current', size === 'sm' ? 'size-4' : 'size-5')}
      label={label ?? t({ ko: '빼기', en: 'Remove' })}
      disabled={disabled}
      onClick={onRemove}
    >
      <X />
    </IconButton>
  )
}

/** A text key inside a chip (e.g. a search operator that cycles on click): ghost wash on hover, keeps the chip's tone. */
function ChipAction({ className, type = 'button', ...props }: Omit<ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return <Button type={type} variant="ghost" size="xs" className={cn('px-1.5 font-bold text-current hover:text-current', className)} {...props} />
}

/** Render a static chip; with `onRemove` it ends in an X key. For a pressable on/off chip use ToggleChip. */
function Chip({ className, tone, size, mono, asChild = false, onRemove, removeLabel, removeDisabled, children, ...props }: ChipProps) {
  const Comp = asChild ? Slot.Root : 'span'
  const removable = Boolean(onRemove) && !asChild

  return (
    <Comp
      data-slot="chip"
      className={cn(chipVariants({ tone, size, mono }), removable && (size === 'sm' ? 'gap-1 pr-0.5' : 'gap-0.5 py-0.5 pr-0.5'), className)}
      {...props}
    >
      {children}
      {removable && onRemove ? <ChipRemoveKey size={size} label={removeLabel} disabled={removeDisabled} onRemove={onRemove} /> : null}
    </Comp>
  )
}

const toggleChipVariants = cva(
  [
    'inline-flex max-w-full min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-sm font-medium whitespace-nowrap transition-colors outline-none',
    'focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      tone: {
        /** Neutral when off, primary tint when pressed. */
        default: 'bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground aria-pressed:bg-primary/12 aria-pressed:text-primary aria-pressed:hover:bg-primary/16 aria-pressed:hover:text-primary',
        /** Neutral on/off for a dense block of options (header menu items), where primary would flood the screen: outlined when off, a neutral fill when pressed. */
        neutral: 'border border-foreground/15 bg-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground aria-pressed:border-transparent aria-pressed:bg-foreground/12 aria-pressed:text-foreground aria-pressed:hover:bg-foreground/16',
        /** Categorical tones (e.g. prompt syntax kinds): the category fill stays, pressed adds an inset ring. */
        primary: 'bg-primary/12 text-foreground hover:bg-primary/18 aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-primary/60',
        info: 'bg-info-soft text-info-soft-foreground hover:brightness-110 aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-info/70',
        warning: 'bg-warning-soft text-warning-soft-foreground hover:brightness-110 aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-warning/70',
        success: 'bg-success-soft text-success-soft-foreground hover:brightness-110 aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-success/70',
      },
      size: {
        sm: 'h-6 px-2 text-2xs [&_svg:not([class*=size-])]:size-3',
        md: 'h-8 px-3 text-xs [&_svg:not([class*=size-])]:size-3.5',
      },
    },
    defaultVariants: {
      tone: 'default',
      size: 'md',
    },
  },
)

type ToggleChipProps = Omit<ComponentProps<'button'>, 'aria-pressed'> & VariantProps<typeof toggleChipVariants> & {
  /** On/off state, announced as aria-pressed. */
  pressed: boolean
}

/** Render a pressable filter / option chip with aria-pressed state (multi-select filters, category toggles). */
function ToggleChip({ className, tone, size, pressed, type = 'button', ...props }: ToggleChipProps) {
  return (
    <button
      data-slot="toggle-chip"
      type={type}
      aria-pressed={pressed}
      className={cn(toggleChipVariants({ tone, size }), className)}
      {...props}
    />
  )
}

export { Chip, ChipAction, ToggleChip, chipVariants, toggleChipVariants }
export type { ChipProps, ToggleChipProps }
