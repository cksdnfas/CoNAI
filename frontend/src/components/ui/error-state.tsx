import type { ComponentProps, ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { Spinner } from './loading-state'

const errorStateVariants = cva('rounded-sm bg-destructive-soft text-destructive-soft-foreground', {
  variants: {
    size: {
      default: 'flex w-full flex-col items-start gap-3 px-4 py-4',
      compact: 'flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5',
    },
  },
  defaultVariants: {
    size: 'default',
  },
})

interface ErrorStateProps extends Omit<ComponentProps<'div'>, 'title'>, VariantProps<typeof errorStateVariants> {
  /** Short headline. Defaults to "Something went wrong". */
  title?: ReactNode
  /** User-facing explanation or next step. Write this for people, not from `error.message`. */
  description?: ReactNode
  /**
   * The underlying failure. Only its message goes into a collapsed "Details" disclosure —
   * never the stack — so support info is reachable without showing it by default.
   */
  error?: unknown
  onRetry?: () => void
  retryLabel?: ReactNode
  isRetrying?: boolean
}

/** Read a one-line message from an unknown failure, never its stack. */
function readErrorDetail(error: unknown): string | null {
  if (error === null || error === undefined) {
    return null
  }

  if (error instanceof Error) {
    return error.message.trim() || error.name || null
  }

  if (typeof error === 'string') {
    return error.trim() || null
  }

  return null
}

/** Render a recoverable failure with an optional retry and collapsed technical detail. */
function ErrorState({
  title,
  description,
  error,
  onRetry,
  retryLabel,
  isRetrying = false,
  size,
  className,
  ...props
}: ErrorStateProps) {
  const { t } = useI18n()
  const detail = readErrorDetail(error)
  const isCompact = size === 'compact'

  const retryButton = onRetry ? (
    <Button
      type="button"
      size={isCompact ? 'xs' : 'sm'}
      variant="secondary"
      className="bg-destructive-soft-foreground/10 text-destructive-soft-foreground hover:bg-destructive-soft-foreground/20 hover:text-destructive-soft-foreground"
      onClick={onRetry}
      disabled={isRetrying}
    >
      {isRetrying ? <Spinner size="sm" /> : <RotateCw />}
      {retryLabel ?? t({ ko: '다시 시도', en: 'Retry' })}
    </Button>
  ) : null

  return (
    <div data-slot="error-state" data-size={isCompact ? 'compact' : 'default'} role="alert" className={cn(errorStateVariants({ size }), className)} {...props}>
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <AlertTriangle className={cn('shrink-0', isCompact ? 'mt-0.5 size-4' : 'mt-0.5 size-5')} aria-hidden />
        <div className="min-w-0 space-y-1">
          <div className="text-sm font-medium">{title ?? t({ ko: '문제가 발생했습니다', en: 'Something went wrong' })}</div>
          {description ? <div className="text-sm opacity-85">{description}</div> : null}
          {detail ? (
            <details className="text-xs opacity-80">
              <summary className="cursor-pointer select-none">{t({ ko: '자세히', en: 'Details' })}</summary>
              <p className="mt-1 break-words font-mono">{detail}</p>
            </details>
          ) : null}
        </div>
      </div>
      {retryButton ? <div className={cn('shrink-0', !isCompact && 'pl-7.5')}>{retryButton}</div> : null}
    </div>
  )
}

export { ErrorState, errorStateVariants }
export type { ErrorStateProps }
