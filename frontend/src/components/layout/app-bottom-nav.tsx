import { useEffect } from 'react'
import { LayoutGrid } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { prefetchAppRoute } from '@/app/lazy-routes'
import { CountBadge } from '@/components/ui/count-badge'
import { CODEX_CHAT_ROUTE } from '@/features/codex-chat/codex-chat-context'
import { useCodexChatUnreadCount } from '@/features/codex-chat/codex-chat-shell'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { AppNavLink } from './app-navigation'

/** Phones get at most four pinned pages as tabs; 전체 is the fifth. */
const PINNED_TABS = 4

/**
 * The phone's bottom tabs (below md): the first four pinned pages and 전체, the page of every page by group. While it
 * is mounted, `data-bottom-nav` on <html> gives the shell, full-height pages and floating bars its room
 * (`--shell-bottom-inset`, index.css).
 */
export function AppBottomNav({ pinned }: { pinned: AppNavLink[] }) {
  const { t } = useI18n()
  const unread = useCodexChatUnreadCount()
  useEffect(() => {
    document.documentElement.setAttribute('data-bottom-nav', '')
    return () => document.documentElement.removeAttribute('data-bottom-nav')
  }, [])
  const tabs = [
    ...pinned.filter((link) => link.to !== '/access').slice(0, PINNED_TABS),
    { key: 'access', to: '/access', label: t({ ko: '전체', en: 'All' }), icon: LayoutGrid },
  ]

  return (
    <nav aria-label={t('appShell.mainPageNavigation')} className="app-bottom-nav fixed inset-x-0 bottom-0 z-header flex md:hidden">
      {tabs.map(({ key, to, label, icon: Icon }) => (
        <NavLink
          key={key}
          to={to}
          end={to === '/'}
          onMouseEnter={() => prefetchAppRoute(to)}
          onFocus={() => prefetchAppRoute(to)}
          className={({ isActive }) => cn(
            'flex h-(--shell-bottom-nav-height) min-w-0 flex-1 flex-col items-center justify-center gap-1 text-2xs text-muted-foreground outline-none transition-colors focus-visible:bg-fill',
            isActive && 'font-semibold text-primary',
          )}
        >
          <span className="relative">
            <Icon className="size-5" aria-hidden />
            {to === CODEX_CHAT_ROUTE && unread > 0 ? <CountBadge corner="top-right" ring label={t({ ko: '안 읽은 답변 {count}개', en: '{count} unread' }, { count: unread })} /> : null}
          </span>
          <span className="max-w-full truncate px-1">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
