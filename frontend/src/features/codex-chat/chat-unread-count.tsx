import { CountBadge } from '@/components/ui/count-badge'
import { useI18n } from '@/i18n'

/** The count of replies not read yet, as a filled pill (chat list rows, the account menu). */
export function UnreadCount({ count, className }: { count: number; className?: string }) {
  const { t } = useI18n()
  const label = t({ ko: '안 읽은 답변 {count}개', en: '{count} unread replies' }, { count })
  return <CountBadge size="md" count={count} max={999} label={label} title={label} className={className} />
}
