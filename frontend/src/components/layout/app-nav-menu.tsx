import { ChevronDown, Pin } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { prefetchAppRoute } from '@/app/lazy-routes'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { HEADER_PIN_SETTING_PATH, isAppNavLinkActive, type AppNavGroup } from './app-navigation'

/**
 * One grouped header menu (라이브러리·만들기·확장): its pages that are not pinned, each with a line about it. The key is
 * tinted while the current page is one of them; an administrator also gets the way to the pin setting.
 */
export function AppNavGroupMenu({ group }: { group: AppNavGroup }) {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const canPin = hasAuthPermission(useAuthStatusQuery().data?.permissionKeys, 'page.settings.view')
  const links = group.links.filter((link) => !link.pinned)
  if (!links.length) return null
  const current = links.some((link) => isAppNavLinkActive(link.to, pathname))

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" data-pressed={current || undefined}>
          {group.label}
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {links.map((link) => {
          const active = isAppNavLinkActive(link.to, pathname)
          const Icon = link.icon
          return (
            <DropdownMenuItem key={link.key} asChild>
              <Link to={link.to} aria-current={active ? 'page' : undefined} onMouseEnter={() => prefetchAppRoute(link.to)} onFocus={() => prefetchAppRoute(link.to)}>
                <Icon className={cn(active && 'text-primary')} />
                <span className="flex min-w-0 flex-col">
                  <span className={cn('truncate font-medium', active && 'text-primary')}>{link.label}</span>
                  {link.description ? <span className="truncate text-xs text-muted-foreground">{link.description}</span> : null}
                </span>
              </Link>
            </DropdownMenuItem>
          )
        })}
        {canPin ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate(HEADER_PIN_SETTING_PATH)}>
              <Pin />
              <span className="text-xs text-muted-foreground">{t({ ko: '자주 가는 곳은 상단에 고정할 수 있어', en: 'Pin the pages you visit often' })}</span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
