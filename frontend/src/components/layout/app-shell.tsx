import { Image } from 'lucide-react'
import { NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router-dom'
import { HomeSearchProvider } from '@/features/home/home-search-context'
import { HomeSearchDrawer, HomeSearchHeaderBox } from '@/features/home/components/home-search-ui'
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
      <AppShellLayout />
    </HomeSearchProvider>
  )
}

function AppShellLayout() {
  const location = useLocation()
  const shouldUseGlobalScrollRestoration = location.pathname !== '/'

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="fixed inset-x-0 top-0 z-50 bg-background/70 backdrop-blur-[24px]">
        <div className="mx-auto flex h-16 w-full max-w-[1680px] items-center justify-between px-6 md:px-10">
          <div className="flex items-center gap-10">
            <div className="flex items-center gap-3">
              <div className="rounded-sm bg-surface-high p-2 text-secondary">
                <Image className="h-4 w-4" />
              </div>
              <span className="text-lg font-bold tracking-[-0.04em] text-foreground">CoNAI</span>
            </div>

            <nav className="hidden items-center gap-8 text-sm font-medium tracking-tight lg:flex">
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
            <HomeSearchHeaderBox active={true} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1680px] px-6 pb-16 pt-24 md:px-10">
        <Outlet />
      </main>

      <HomeSearchDrawer active={true} />
      {shouldUseGlobalScrollRestoration ? <ScrollRestoration getKey={(location) => `${location.pathname}${location.search}`} /> : null}
    </div>
  )
}
