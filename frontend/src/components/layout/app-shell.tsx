import { Suspense, lazy, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Map as MapIcon, type LucideIcon } from 'lucide-react'
import { matchPath, NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router-dom'
import { prefetchAppRoute } from '@/app/lazy-routes'
import { HomeSearchProvider } from '@/features/home/home-search-context'
import { HomeSearchDrawer, HomeSearchHeaderBox } from '@/features/home/components/home-search-ui'
import { HeaderAccountMenu } from '@/features/auth/header-account-menu'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { PAGE_ACCESS_CATALOG } from '@/features/auth/page-access-catalog'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useChatGenerationNotifications } from '@/features/runtime-events/use-chat-generation-notifications'
import { CodexChatProvider } from '@/features/codex-chat/codex-chat-provider'
import { ChatPageProvider } from '@/features/codex-chat/chat-page-context'
import { CODEX_CHAT_ROUTE } from '@/features/codex-chat/codex-chat-context'
import { CodexChatDock, CodexChatHeaderButton, useCodexChatDockVisible } from '@/features/codex-chat/codex-chat-shell'
import { ImageViewModalProvider } from '@/features/images/components/detail/image-view-modal-provider'
import { registerTranslationCatalog, useI18n } from '@/i18n'
import { getPublicHeaderNavigationSettings } from '@/lib/api-settings-general'
import { APP_BRAND_TOOLTIP, APP_ICON_SRC, APP_NAME } from '@/lib/app-metadata'
import { cn } from '@/lib/utils'
import { useMinWidth } from '@/lib/use-min-width'
import type { HeaderNavigationItemKey } from '@conai/shared'
import { DEFAULT_HEADER_NAVIGATION_SETTINGS } from '@/lib/settings-defaults'
import { useHorizontalDragScroll } from '@/components/common/use-horizontal-drag-scroll'
import { Tip } from '@/components/ui/tooltip'

const GenerationQueueHeaderWidgetLazy = lazy(async () => {
  const [module, imageGenerationCatalog] = await Promise.all([
    import('@/features/image-generation/components/generation-queue-header-widget'),
    import('@/i18n/resources/image-generation').then((catalogModule) => catalogModule.imageGenerationCatalog),
  ])
  registerTranslationCatalog(imageGenerationCatalog)
  return { default: module.GenerationQueueHeaderWidget }
})

/** Below Tailwind `sm` the search and chat keys fold into the account menu so the page icons get the room. */
const FULL_HEADER_MIN_WIDTH_PX = 640

const PRIMARY_NAV_ORDER = ['/', '/groups', '/prompts', '/generation', '/audio', '/sprite', CODEX_CHAT_ROUTE, '/upload', '/files', '/wallpaper', '/settings'] as const
const PRIMARY_NAV_ITEM_IDS: Record<typeof PRIMARY_NAV_ORDER[number], HeaderNavigationItemKey> = {
  '/': 'home',
  '/groups': 'groups',
  '/prompts': 'prompts',
  '/generation': 'generation',
  '/audio': 'audio',
  '/sprite': 'sprite',
  [CODEX_CHAT_ROUTE]: 'chat',
  '/upload': 'upload',
  '/files': 'files',
  '/wallpaper': 'wallpaper',
  '/settings': 'settings',
}

type NavItem = { id: HeaderNavigationItemKey; to: string; labelKey: string; icon: LucideIcon; permissionKey: string | null }

// "이용 가능 페이지" leads the header: it is the hub people use to reach every page they may open.
const navItems: NavItem[] = [
  { id: 'access', to: '/access', labelKey: 'appShell.availablePages', icon: MapIcon, permissionKey: null },
  ...PRIMARY_NAV_ORDER.flatMap((path): NavItem[] => {
    const item = PAGE_ACCESS_CATALOG.find((entry) => entry.path === path)
    return item ? [{ id: PRIMARY_NAV_ITEM_IDS[path], to: item.path, labelKey: item.labelKey, icon: item.icon, permissionKey: item.permissionKey }] : []
  }),
]

function DeferredGenerationQueueHeaderWidget() {
  const [shouldRender, setShouldRender] = useState(false)

  useEffect(() => {
    const timerId = window.setTimeout(() => setShouldRender(true), 350)
    return () => window.clearTimeout(timerId)
  }, [])

  if (!shouldRender) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <GenerationQueueHeaderWidgetLazy />
    </Suspense>
  )
}

export function AppShell() {
  return (
    <HomeSearchProvider>
      <ImageViewModalProvider>
        <ChatPageProvider>
          <CodexChatProvider>
            <AppShellLayout />
          </CodexChatProvider>
        </ChatPageProvider>
      </ImageViewModalProvider>
    </HomeSearchProvider>
  )
}

/** Render the shell layout, leaving nav-scroll mechanics to a focused hook. */
function AppShellLayout() {
  useChatGenerationNotifications()
  const location = useLocation()
  const { t } = useI18n()
  const authStatusQuery = useAuthStatusQuery()
  const headerNavigationQuery = useQuery({
    queryKey: ['public-header-navigation-settings'],
    queryFn: getPublicHeaderNavigationSettings,
    staleTime: 60_000,
  })
  const headerNavigation = headerNavigationQuery.data ?? DEFAULT_HEADER_NAVIGATION_SETTINGS
  const permissionKeys = authStatusQuery.data?.permissionKeys ?? []
  const isAnonymousSession = authStatusQuery.data?.hasCredentials === true && authStatusQuery.data?.authenticated !== true
  const visibleNavItems = navItems.filter((item) => headerNavigation[item.id] !== false
    && (item.permissionKey === null || hasAuthPermission(permissionKeys, item.permissionKey)))
  const logoTarget = '/access'
  const isWallpaperRuntime = location.pathname === '/wallpaper/runtime'
  const shouldShowGenerationQueueWidget = headerNavigation.queue !== false && (authStatusQuery.data?.hasCredentials !== true || authStatusQuery.data?.authenticated === true)
  const shouldShowHeaderSearch = headerNavigation.search !== false && !isAnonymousSession
  const shouldShowAccountMenu = headerNavigation.account !== false
  // With the account menu hidden by settings there is nowhere to fold into, so the keys stay out.
  const shouldFoldKeysIntoAccountMenu = !useMinWidth(FULL_HEADER_MIN_WIDTH_PX) && shouldShowAccountMenu
  const shouldUseGlobalScrollRestoration = location.pathname !== '/' && !location.pathname.startsWith('/groups')
  const isCodexChatDockVisible = useCodexChatDockVisible()
  const {
    scrollRef: navScrollRef,
    canScrollLeft: canScrollNavLeft,
    canScrollRight: canScrollNavRight,
    isDragging: isDraggingNav,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handlePointerLeave,
    handleItemClick: handleNavItemClick,
  } = useHorizontalDragScroll(location.pathname)

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
            <NavLink
              to={logoTarget}
              className="flex shrink-0 items-center gap-3 rounded-sm transition-opacity hover:opacity-90"
              aria-label={t('appShell.availablePages')}
              title={APP_BRAND_TOOLTIP}
              onMouseEnter={() => prefetchAppRoute(logoTarget)}
              onFocus={() => prefetchAppRoute(logoTarget)}
            >
              <img src={APP_ICON_SRC} alt="" className="size-8 shrink-0 rounded-sm object-cover" draggable={false} />
              <span className="hidden text-lg font-bold tracking-[-0.04em] text-foreground sm:inline">{APP_NAME}</span>
            </NavLink>

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
                <nav className="flex min-w-max items-center gap-0.5 pr-10 sm:pr-2" aria-label={t('appShell.mainPageNavigation')}>
                  {visibleNavItems.map(({ to, labelKey, icon: Icon }) => {
                    const label = t(labelKey)
                    // Resolved here (not via NavLink's render props) so the Tip trigger can merge a plain className.
                    const isActive = matchPath({ path: to, end: to === '/' }, location.pathname) !== null

                    return (
                    <Tip key={to} content={label} side="bottom">
                    <NavLink
                      to={to}
                      end={to === '/'}
                      aria-label={label}
                      draggable={false}
                      onClick={handleNavItemClick}
                      onMouseEnter={() => prefetchAppRoute(to)}
                      onFocus={() => prefetchAppRoute(to)}
                      onDragStart={(event) => event.preventDefault()}
                      className={cn(
                        // Icon-only; from md the current page also shows its label.
                        'inline-flex size-9 shrink-0 items-center justify-center gap-2 rounded-sm text-muted-foreground transition-colors duration-200 outline-none hover:bg-fill hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 select-none',
                        isDraggingNav && 'pointer-events-none',
                        isActive && 'bg-primary/12 text-primary hover:bg-primary/16 hover:text-primary md:w-auto md:px-3',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className={cn('sr-only', isActive && 'md:not-sr-only md:whitespace-nowrap md:text-sm md:font-semibold')}>{label}</span>
                    </NavLink>
                    </Tip>
                    )
                  })}
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
            {shouldShowGenerationQueueWidget ? <DeferredGenerationQueueHeaderWidget /> : null}
            <HomeSearchHeaderBox active={shouldShowHeaderSearch && !shouldFoldKeysIntoAccountMenu} />
            {shouldFoldKeysIntoAccountMenu ? null : <CodexChatHeaderButton />}
            {shouldShowAccountMenu ? (
              <HeaderAccountMenu foldedSearch={shouldFoldKeysIntoAccountMenu && shouldShowHeaderSearch} foldedChat={shouldFoldKeysIntoAccountMenu} />
            ) : null}
          </div>
        </div>
      </header>

      {/* The docked chat panel takes the right edge from lg up; the page keeps the rest. */}
      <div className={cn(isCodexChatDockVisible && 'lg:pr-(--chat-dock-width)')}>
        <main className="theme-shell-main mx-auto w-full max-w-[1680px]">
          <Outlet />
        </main>
      </div>
      <CodexChatDock />

      <HomeSearchDrawer active={shouldShowHeaderSearch} />
      {shouldUseGlobalScrollRestoration ? <ScrollRestoration getKey={(location) => `${location.pathname}${location.search}`} /> : null}
    </div>
  )
}
