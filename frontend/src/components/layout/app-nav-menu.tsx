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
      <DropdownMenuContent align="start" className="w-56">
        {links.map((link) => {
          const active = isAppNavLinkActive(link.to, pathname)
          const Icon = link.icon
          return (
            <DropdownMenuItem key={link.key} asChild>
              <Link to={link.to} aria-current={active ? 'page' : undefined} onMouseEnter={() => prefetchAppRoute(link.to)} onFocus={() => prefetchAppRoute(link.to)}>
                <Icon className={cn(active && 'text-primary')} />
                <span className={cn('truncate', active && 'text-primary')}>{link.label}</span>
              </Link>
            </DropdownMenuItem>
          )
        })}
        {canPin ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate(HEADER_PIN_SETTING_PATH)}>
              <Pin />
              {t({ ko: '고정 페이지 바꾸기', en: 'Change pinned pages' })}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
