import type { ComponentProps, ReactNode } from 'react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/** Flat: hairlines above and below set a proposal off from the reply text; nothing inside it is boxed again. */
export function ProposalFrame({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('space-y-2.5 border-y border-line py-2.5', className)} {...props} />
}

/** A proposal's last row over a hairline: its actions, or with `status` the muted outcome line (saved, dismissed…). */
export function ProposalFooter({ status = false, className, ...props }: ComponentProps<'div'> & { status?: boolean }) {
  return <div className={cn('flex items-center gap-2 border-t border-line pt-2', status && 'text-xs text-muted-foreground', className)} {...props} />
}

/** One proposed value: a muted label beside a capped, scrolling pre-wrap value. */
export function ProposalRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 text-xs">
      <span className="pt-px text-muted-foreground">{label}</span>
      <div className="max-h-28 min-w-0 overflow-auto whitespace-pre-wrap break-words">{children}</div>
    </div>
  )
}

const CHANGE_TEXT_CLASS = 'max-h-28 overflow-auto whitespace-pre-wrap break-words'

/** One changed field in a `<dl>`: label over a before / after pair, each side a capped scrolling pre-wrap block. */
export function ProposalChange({ label, before, after }: { label: ReactNode; before: ReactNode; after: ReactNode }) {
  const { t } = useI18n()
  return (
    <div>
      <dt className="mb-1 font-medium">{label}</dt>
      <dd className="grid grid-cols-2 gap-2">
        <span className={cn(CHANGE_TEXT_CLASS, 'text-muted-foreground')} aria-label={t({ ko: '변경 전', en: 'Before' })}>{before}</span>
        <span className={cn(CHANGE_TEXT_CLASS, 'text-foreground')} aria-label={t({ ko: '변경 후', en: 'After' })}>{after}</span>
      </dd>
    </div>
  )
}
