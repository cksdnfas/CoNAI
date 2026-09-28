import type { ComponentProps } from 'react'
import { useI18n } from '@/i18n'
import { formatCountDisplay, type CountDisplayOptions, type CountState } from '@/lib/count-display'
import { cn } from '@/lib/utils'

interface CountSummaryProps extends CountState, CountDisplayOptions, Omit<ComponentProps<'span'>, 'children' | 'hidden'> {}

/**
 * Render a real total ("12,345 images", "12 / 12,345"), "Counting…" while it is unknown,
 * or "—" on failure, with a muted note for rating-hidden items.
 */
function CountSummary({ total, status, hidden, position, unit, className, ...props }: CountSummaryProps) {
  const { t, formatNumber } = useI18n()
  const { text, hiddenNote } = formatCountDisplay({ total, status, hidden, position }, { t, formatNumber }, { unit })

  return (
    <span
      data-slot="count-summary"
      data-status={status}
      aria-busy={status === 'pending' || undefined}
      className={cn('tabular-nums', className)}
      {...props}
    >
      {text}
      {hiddenNote ? <span className="text-muted-foreground"> {hiddenNote}</span> : null}
    </span>
  )
}

export { CountSummary }
export type { CountSummaryProps }
