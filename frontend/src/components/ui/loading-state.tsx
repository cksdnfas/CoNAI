import type { ComponentProps, ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { LoaderCircle } from 'lucide-react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

const spinnerVariants = cva('shrink-0 animate-spin motion-reduce:animate-none', {
  variants: {
    size: {
      sm: 'size-3.5',
      md: 'size-4',
      lg: 'size-6',
    },
  },
  defaultVariants: {
    size: 'md',
  },
})

type SpinnerSize = NonNullable<VariantProps<typeof spinnerVariants>['size']>

interface SpinnerProps extends Omit<ComponentProps<typeof LoaderCircle>, 'size'> {
  size?: SpinnerSize
  /** Accessible name. Without it the spinner is decorative and hidden from assistive tech. */
  label?: string
}

/** Render the shared rotating loader icon. Stops rotating under reduced motion. */
function Spinner({ size, label, className, ...props }: SpinnerProps) {
  return (
    <LoaderCircle
      data-slot="spinner"
      className={cn(spinnerVariants({ size }), className)}
      {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}
      {...props}
    />
  )
}

const loadingStateVariants = cva('text-muted-foreground', {
  variants: {
    variant: {
      /** Fills a content area while its data loads. */
      block: 'flex w-full flex-col items-center justify-center gap-3 px-4 py-10 text-center text-sm',
      /** Sits in a row next to other content. */
      inline: 'inline-flex items-center gap-2 text-sm',
    },
  },
  defaultVariants: {
    variant: 'block',
  },
})

interface LoadingStateProps extends Omit<ComponentProps<'div'>, 'children'>, VariantProps<typeof loadingStateVariants> {
  /** Visible status text. Defaults to "Loading…". Pass `null` to show only the spinner (the region keeps an accessible name). */
  label?: ReactNode
  spinnerSize?: SpinnerSize
}

/** Render a polite loading status with the shared spinner. */
function LoadingState({ label, variant, spinnerSize, className, ...props }: LoadingStateProps) {
  const { t } = useI18n()
  const defaultLabel = t({ ko: '불러오는 중…', en: 'Loading…' })
  const visibleLabel = label === undefined ? defaultLabel : label
  const resolvedSpinnerSize = spinnerSize ?? (variant === 'inline' ? 'sm' : 'lg')

  return (
    <div
      data-slot="loading-state"
      role="status"
      aria-live="polite"
      aria-label={visibleLabel === null ? defaultLabel : undefined}
      className={cn(loadingStateVariants({ variant }), className)}
      {...props}
    >
      <Spinner size={resolvedSpinnerSize} />
      {visibleLabel !== null ? <span>{visibleLabel}</span> : null}
    </div>
  )
}

export { LoadingState, Spinner, spinnerVariants }
export type { LoadingStateProps, SpinnerProps, SpinnerSize }
