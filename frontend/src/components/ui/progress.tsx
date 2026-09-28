import * as React from 'react'
import { Progress as ProgressPrimitive } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const progressVariants = cva('relative w-full overflow-hidden rounded-full bg-surface-highest', {
  variants: {
    size: {
      sm: 'h-1',
      default: 'h-1.5',
      lg: 'h-2',
    },
  },
  defaultVariants: {
    size: 'default',
  },
})

const progressIndicatorVariants = cva('h-full rounded-full', {
  variants: {
    tone: {
      default: 'bg-primary',
      success: 'bg-success',
      warning: 'bg-warning',
      destructive: 'bg-destructive',
      info: 'bg-info',
    },
  },
  defaultVariants: {
    tone: 'default',
  },
})

type ProgressProps = Omit<React.ComponentProps<typeof ProgressPrimitive.Root>, 'value'>
  & VariantProps<typeof progressVariants>
  & VariantProps<typeof progressIndicatorVariants>
  & {
    /** Progress from 0 to `max` (default 100). `null`/`undefined` renders the indeterminate state. */
    value?: number | null
    /** Force the indeterminate state (unknown duration) even when a value is passed. */
    indeterminate?: boolean
    indicatorClassName?: string
  }

/**
 * Render a determinate or indeterminate progress bar (Radix, `role="progressbar"`).
 * Indeterminate sweeps a bar across the track; with reduced motion it shows a static dimmed full bar instead.
 */
function Progress({ className, indicatorClassName, value, max = 100, indeterminate = false, size, tone, ...props }: ProgressProps) {
  const isIndeterminate = indeterminate || value === null || value === undefined
  const clampedValue = isIndeterminate ? null : Math.min(Math.max(value, 0), max)
  const percent = clampedValue === null || max <= 0 ? 0 : (clampedValue / max) * 100

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={clampedValue}
      max={max}
      className={cn(progressVariants({ size }), className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          progressIndicatorVariants({ tone }),
          isIndeterminate
            ? 'w-2/5 animate-progress-indeterminate motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-40'
            : 'w-full transition-transform duration-300 motion-reduce:transition-none',
          indicatorClassName,
        )}
        style={isIndeterminate ? undefined : { transform: `translateX(-${100 - percent}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress, progressVariants }
