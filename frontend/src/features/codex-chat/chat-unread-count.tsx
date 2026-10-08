import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/** The count of replies not read yet, as a filled pill (chat list rows, the account menu). */
export function UnreadCount({ count, className }: { count: number; className?: string }) {
  const { t } = useI18n()
  const label = t({ ko: '안 읽은 답변 {count}개', en: '{count} unread replies' }, { count })
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn('inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1.5 text-2xs font-semibold leading-none tabular-nums text-primary-foreground', className)}
    >
      {count > 999 ? '999+' : count}
    </span>
  )
}
