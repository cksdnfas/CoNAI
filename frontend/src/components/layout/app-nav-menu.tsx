import { Fragment } from 'react'
import { ChevronDown } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { prefetchAppRoute } from '@/app/lazy-routes'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { isAppNavLinkActive, type AppNavGroup } from './app-navigation'

/**
 * One grouped header menu (라이브러리·만들기·확장) for pages that are not pinned. The key is tinted while the current
 * page is one of them. Installed plugin pages sit under a hairline after the group's own pages.
 */
export function AppNavGroupMenu({ group }: { group: AppNavGroup }) {
  const { pathname } = useLocation()
  const links = group.links.filter((link) => !link.pinned)
  if (!links.length) return null
  const current = links.some((link) => isAppNavLinkActive(link.to, pathname))
  const GroupIcon = group.icon

  return (
    <DropdownMenu modal={false}>
      <Tip content={group.label} side="bottom">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" data-pressed={current || undefined}>
            <GroupIcon />
            {/* Like the pinned pages: the name from xl; narrower, only the group of the current page keeps it. */}
            <span className={cn('sr-only xl:not-sr-only xl:whitespace-nowrap', current && 'md:not-sr-only md:whitespace-nowrap')}>{group.label}</span>
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="start" className="w-56">
        {links.map((link, index) => {
          const active = isAppNavLinkActive(link.to, pathname)
          const Icon = link.icon
          return (
            <Fragment key={link.key}>
              {link.plugin && index > 0 && !links[index - 1].plugin ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem asChild>
                <Link to={link.to} aria-current={active ? 'page' : undefined} onMouseEnter={() => prefetchAppRoute(link.to)} onFocus={() => prefetchAppRoute(link.to)}>
                  <Icon className={cn(active && 'text-primary-text')} />
                  <span className={cn('truncate', active && 'text-primary-text')}>{link.label}</span>
                </Link>
              </DropdownMenuItem>
            </Fragment>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
