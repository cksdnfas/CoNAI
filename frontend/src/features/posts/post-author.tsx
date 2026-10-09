import type { PostAuthor } from '@conai/shared'
import { CircleUserRound } from 'lucide-react'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { useI18n } from '@/i18n'
import { buildApiUrl } from '@/lib/api-url'
import { cn } from '@/lib/utils'

/** "방금", "5분 전", "3시간 전", "2일 전", then the date. */
export function useRelativeTime() {
  const { t, formatDate } = useI18n()
  return (value: string | null) => {
    if (!value) return ''
    const date = new Date(value)
    const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000)
    if (seconds < 60) return t({ ko: '방금', en: 'just now' })
    if (seconds < 3600) return t({ ko: '{count}분 전', en: '{count}m ago' }, { count: Math.floor(seconds / 60) })
    if (seconds < 86400) return t({ ko: '{count}시간 전', en: '{count}h ago' }, { count: Math.floor(seconds / 3600) })
    if (seconds < 86400 * 7) return t({ ko: '{count}일 전', en: '{count}d ago' }, { count: Math.floor(seconds / 86400) })
    return formatDate(date)
  }
}

/** A bot shows its profile face; a person a plain account mark. */
export function PostAuthorAvatar({ author, size = 'sm', className }: { author: PostAuthor; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }) {
  if (author.type === 'profile') {
    return <ChatProfileAvatar name={author.name} imageUrl={author.avatarUrl ? buildApiUrl(author.avatarUrl) : null} avatarCrop={author.avatarCrop} engine="llm" size={size} className={className} />
  }
  const sizeClass = { xs: 'size-5', sm: 'size-6', md: 'size-8', lg: 'size-10' }[size]
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-surface-high text-muted-foreground', sizeClass, className)} aria-hidden="true">
      <CircleUserRound className="size-[70%]" />
    </span>
  )
}

/** "봇" next to a bot's name. */
export function BotBadge() {
  const { t } = useI18n()
  return <span className="rounded-sm border border-line px-1 text-2xs font-normal leading-4 text-muted-foreground">{t({ ko: '봇', en: 'Bot' })}</span>
}

export function PostAuthorName({ author, className }: { author: PostAuthor; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <span className="truncate font-medium text-foreground">{author.name}</span>
      {author.type === 'profile' ? <BotBadge /> : null}
    </span>
  )
}
