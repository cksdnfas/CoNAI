import { Image } from 'lucide-react'
import { NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { HomeSearchProvider } from '@/features/home/home-search-context'
import { HomeSearchDrawer, HomeSearchHeaderBox } from '@/features/home/components/home-search-ui'
import { ImageViewModalProvider } from '@/features/images/components/detail/image-view-modal-provider'
import { getAppSettings } from '@/lib/api'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { useMinWidth } from '@/lib/use-min-width'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', label: 'Home' },
  { to: '/groups', label: 'Group' },
  { to: '/prompts', label: 'Prompt' },
  { to: '/upload', label: 'Upload' },
  { to: '/settings', label: 'Settings' },
]

export function AppShell() {
  return (
    <HomeSearchProvider>
      <ImageViewModalProvider>
        <AppShellLayout />
      </ImageViewModalProvider>
    </HomeSearchProvider>
  )
}

function AppShellLayout() {
  const location = useLocation()
  const shouldUseGlobalScrollRestoration = location.pathname !== '/'
  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })
  const appearance = settingsQuery.data?.appearance ?? DEFAULT_APPEARANCE_SETTINGS
  const showDesktopSearch = useMinWidth(appearance.desktopSearchMinWidth)
  const showDesktopNav = useMinWidth(appearance.desktopNavMinWidth)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="theme-shell-header fixed inset-x-0 top-0 z-50">
        <div className="theme-shell-inner mx-auto flex w-full max-w-[1680px] items-center justify-between">
          <div className="flex items-center gap-10">
            <div className="flex items-center gap-3">
              <div className="rounded-sm bg-surface-high p-2 text-secondary">
                <Image className="h-4 w-4" />
              </div>
              <span className="text-lg font-bold tracking-[-0.04em] text-foreground">CoNAI</span>
            </div>

            <nav className={cn('items-center gap-8 text-sm font-medium tracking-tight', showDesktopNav ? 'flex' : 'hidden')}>
              {navItems.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'border-b-2 border-transparent pb-1 text-foreground/60 transition-colors duration-300 hover:text-foreground',
                      isActive && 'border-primary text-primary',
                    )
                  }
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <HomeSearchHeaderBox active={true} desktopMode={showDesktopSearch} />
          </div>
        </div>
      </header>

      <main className="theme-shell-main mx-auto w-full max-w-[1680px]">
        <Outlet />
      </main>

      <HomeSearchDrawer active={true} />
      {shouldUseGlobalScrollRestoration ? <ScrollRestoration getKey={(location) => `${location.pathname}${location.search}`} /> : null}
    </div>
  )
}
