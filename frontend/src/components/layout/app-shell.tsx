import { ChevronLeft, ChevronRight, Image, ShieldCheck, type LucideIcon } from 'lucide-react'
import { NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router-dom'
import { HomeSearchProvider } from '@/features/home/home-search-context'
import { HomeSearchDrawer, HomeSearchHeaderBox } from '@/features/home/components/home-search-ui'
import { HeaderAccountMenu } from '@/features/auth/header-account-menu'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { PAGE_ACCESS_CATALOG } from '@/features/auth/page-access-catalog'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { GenerationQueueHeaderWidget } from '@/features/image-generation/components/generation-queue-header-widget'
import { ImageViewModalProvider } from '@/features/images/components/detail/image-view-modal-provider'
import { cn } from '@/lib/utils'
import { useAppShellNavScroll } from './use-app-shell-nav-scroll'

const navItems: Array<{ to: string; label: string; icon: LucideIcon; permissionKey: string | null }> = [
  { to: '/access', label: '이용 가능 페이지', icon: ShieldCheck, permissionKey: null },
  ...PAGE_ACCESS_CATALOG.map(({ path, label, icon, permissionKey }) => ({
    to: path,
    label,
    icon,
    permissionKey,
  })),
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

/** Render the shell layout, leaving nav-scroll mechanics to a focused hook. */
function AppShellLayout() {
  const location = useLocation()
  const authStatusQuery = useAuthStatusQuery()
  const permissionKeys = authStatusQuery.data?.permissionKeys ?? []
  const isAnonymousSession = authStatusQuery.data?.hasCredentials === true && authStatusQuery.data?.authenticated !== true
  const shouldShowAccessOverviewNav = authStatusQuery.data?.hasCredentials === true && authStatusQuery.data?.authenticated === true
  const visibleNavItems = navItems.filter((item) => item.permissionKey === null
    ? shouldShowAccessOverviewNav
    : hasAuthPermission(permissionKeys, item.permissionKey))
  const isWallpaperRuntime = location.pathname === '/wallpaper/runtime'
  const shouldShowGenerationQueueWidget = authStatusQuery.data?.authenticated === true
  const shouldUseGlobalScrollRestoration = location.pathname !== '/' && !location.pathname.startsWith('/groups')
  const {
    navScrollRef,
    canScrollNavLeft,
    canScrollNavRight,
    isDraggingNav,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handlePointerLeave,
    handleNavItemClick,
  } = useAppShellNavScroll(location.pathname)

  if (isWallpaperRuntime) {
    return (
      <div className="min-h-screen bg-background text-foreground overflow-hidden">
        <Outlet />
        {shouldUseGlobalScrollRestoration ? <ScrollRestoration getKey={(location) => `${location.pathname}${location.search}`} /> : null}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="theme-shell-header fixed inset-x-0 top-0 z-50">
        <div className="theme-shell-inner mx-auto flex w-full max-w-[1680px] items-center gap-3 sm:gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-6">
            <div className="flex shrink-0 items-center gap-3">
              <div className="rounded-sm bg-surface-high p-2 text-secondary">
                <Image className="h-4 w-4" />
              </div>
              <span className="hidden text-lg font-bold tracking-[-0.04em] text-foreground sm:inline">CoNAI</span>
            </div>

            <div className="relative min-w-0 flex-1">
              <div
                ref={navScrollRef}
                className={cn('theme-nav-scroll min-w-0 overflow-x-auto', isDraggingNav && 'cursor-grabbing select-none')}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                onPointerLeave={handlePointerLeave}
                style={{ touchAction: 'pan-y pinch-zoom' }}
              >
                <nav className="flex min-w-max items-center gap-2 pr-10 sm:pr-2" aria-label="주요 페이지 이동">
                  {visibleNavItems.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={to === '/'}
                      aria-label={label}
                      title={label}
                      draggable={false}
                      onClick={handleNavItemClick}
                      onDragStart={(event) => event.preventDefault()}
                      className={({ isActive }) =>
                        cn(
                          'inline-flex size-9 shrink-0 items-center justify-center rounded-sm border border-transparent text-foreground/70 transition-all duration-300 hover:border-border hover:bg-surface-high hover:text-foreground select-none',
                          isDraggingNav && 'pointer-events-none',
                          isActive && 'border-primary/35 bg-primary/12 text-primary shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_10%,transparent)]',
                        )
                      }
                    >
                      <Icon className="h-4 w-4" />
                      <span className="sr-only">{label}</span>
                    </NavLink>
                  ))}
                </nav>
              </div>

              {canScrollNavLeft ? (
                <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center bg-gradient-to-r from-background via-background/90 to-transparent pl-1 text-foreground/45">
                  <ChevronLeft className="h-4 w-4" />
                </div>
              ) : null}

              {canScrollNavRight ? (
                <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center bg-gradient-to-l from-background via-background/90 to-transparent pr-1 text-foreground/55">
                  <ChevronRight className="h-4 w-4" />
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            {shouldShowGenerationQueueWidget ? <GenerationQueueHeaderWidget /> : null}
            <HomeSearchHeaderBox active={!isAnonymousSession} />
            <HeaderAccountMenu />
          </div>
        </div>
      </header>

      <main className="theme-shell-main mx-auto w-full max-w-[1680px]">
        <Outlet />
      </main>

      <HomeSearchDrawer active={!isAnonymousSession} />
      {shouldUseGlobalScrollRestoration ? <ScrollRestoration getKey={(location) => `${location.pathname}${location.search}`} /> : null}
    </div>
  )
}
