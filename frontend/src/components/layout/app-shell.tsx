import { PageSettingsProvider } from '@/features/settings/page-settings-provider'
import { UnsavedSettingsGuardProvider } from '@/features/settings/use-unsaved-settings-guard'
import { PageSettingsButton } from '@/features/settings/page-settings-button'
import { Suspense, lazy, useEffect, useState } from 'react'
import { NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router-dom'
import { prefetchAppRoute } from '@/app/lazy-routes'
import { HomeSearchProvider } from '@/features/home/home-search-context'
import { HomeSearchDrawer, HomeSearchHeaderBox } from '@/features/home/components/home-search-ui'
import { HeaderAccountMenu } from '@/features/auth/header-account-menu'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useChatGenerationNotifications } from '@/features/runtime-events/use-chat-generation-notifications'
import { CodexChatProvider } from '@/features/codex-chat/codex-chat-provider'
import { ChatPageProvider } from '@/features/codex-chat/chat-page-context'
import { CodexChatDock, CodexChatHeaderButton, useCodexChatDockVisible } from '@/features/codex-chat/codex-chat-shell'
import { ImageViewModalProvider } from '@/features/images/components/detail/image-view-modal-provider'
import { registerTranslationCatalog, useI18n } from '@/i18n'
import { APP_BRAND_TOOLTIP, APP_ICON_SRC, APP_NAME } from '@/lib/app-metadata'
import { cn } from '@/lib/utils'
import { useGlobalAppearanceSettingsQuery } from '@/lib/use-global-appearance-settings'
import { useMinWidth } from '@/lib/use-min-width'
import { Tip } from '@/components/ui/tooltip'
import { AppBottomNav } from './app-bottom-nav'
import { AppNavGroupMenu } from './app-nav-menu'
import { isAppNavLinkActive, useAppNavigation } from './app-navigation'
import { CommandPaletteLauncher } from './command-palette-launcher'

const GenerationQueueHeaderWidgetLazy = lazy(async () => {
  const [module, imageGenerationCatalog] = await Promise.all([
    import('@/features/image-generation/components/generation-queue-header-widget'),
    import('@/i18n/resources/image-generation').then((catalogModule) => catalogModule.imageGenerationCatalog),
  ])
  registerTranslationCatalog(imageGenerationCatalog)
  return { default: module.GenerationQueueHeaderWidget }
})

/** Below Tailwind `sm` the search and chat keys fold into the account menu so the page keys get the room. */
const FULL_HEADER_MIN_WIDTH_PX = 640

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
      <UnsavedSettingsGuardProvider><PageSettingsProvider>
      <ChatPageProvider>
        <CodexChatProvider>
          {/* Inside the chat: the viewer's "참조" button and its room for the docked panel read the chat state. */}
          <ImageViewModalProvider>
            <AppShellLayout />
          </ImageViewModalProvider>
        </CodexChatProvider>
      </ChatPageProvider>
      </PageSettingsProvider></UnsavedSettingsGuardProvider>
    </HomeSearchProvider>
  )
}

/**
 * The shell: header (logo, pinned pages and grouped menus from md, right-side tools), the page, the chat dock and, on
 * phones, the bottom tabs.
 */
function AppShellLayout() {
  useChatGenerationNotifications()
  const location = useLocation()
  const { t } = useI18n()
  const authStatusQuery = useAuthStatusQuery()
  const appearanceQuery = useGlobalAppearanceSettingsQuery()
  const { items: headerNavigation, pinned, groups } = useAppNavigation()
  const isAnonymousSession = authStatusQuery.data?.hasCredentials === true && authStatusQuery.data?.authenticated !== true
  // The overview of every page: the logo here, 전체 in the phone's bottom tabs.
  const logoTarget = '/access'
  const shouldShowGenerationQueueWidget = headerNavigation.queue !== false && (authStatusQuery.data?.hasCredentials !== true || authStatusQuery.data?.authenticated === true)
  const shouldShowHeaderSearch = headerNavigation.search !== false && !isAnonymousSession
  const shouldShowAccountMenu = headerNavigation.account !== false
  // With the account menu hidden by settings there is nowhere to fold into, so the keys stay out.
  const shouldFoldKeysIntoAccountMenu = !useMinWidth(FULL_HEADER_MIN_WIDTH_PX) && shouldShowAccountMenu
  const shouldUseGlobalScrollRestoration = location.pathname !== '/' && !location.pathname.startsWith('/groups')
  const isCodexChatDockVisible = useCodexChatDockVisible()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="theme-shell-header fixed inset-x-0 top-0 z-50">
        <div className="theme-shell-inner mx-auto flex w-full max-w-[1680px] items-center gap-3 sm:gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3 lg:gap-6">
            <Tip content={APP_BRAND_TOOLTIP} side="bottom" align="start">
              <NavLink
                to={logoTarget}
                className="flex shrink-0 items-center gap-3 rounded-sm transition-opacity hover:opacity-90"
                aria-label={t('appShell.availablePages')}
                onMouseEnter={() => prefetchAppRoute(logoTarget)}
                onFocus={() => prefetchAppRoute(logoTarget)}
              >
                <img
                  src={appearanceQuery.data?.appIconDataUrl || APP_ICON_SRC}
                  alt=""
                  className="size-8 shrink-0 rounded-sm object-contain"
                  draggable={false}
                  onError={(event) => {
                    if (event.currentTarget.getAttribute('src') !== APP_ICON_SRC) event.currentTarget.src = APP_ICON_SRC
                  }}
                />
                <span className="text-lg font-bold tracking-tighter text-foreground md:hidden lg:inline">{APP_NAME}</span>
              </NavLink>
            </Tip>

            {/* From md: the pinned pages, then the grouped menus. Phones use the bottom tabs instead. */}
            <nav className="scroll-x theme-nav-scroll hidden min-w-0 flex-1 md:block" aria-label={t('appShell.mainPageNavigation')}>
              <div className="flex w-max items-center gap-0.5">
                {pinned.map(({ key, to, label, icon: Icon }) => {
                  // Resolved here (not via NavLink's render props) so the Tip trigger can merge a plain className.
                  const isActive = isAppNavLinkActive(to, location.pathname)
                  return (
                    <Tip key={key} content={label} side="bottom">
                      <NavLink
                        to={to}
                        end={to === '/'}
                        onMouseEnter={() => prefetchAppRoute(to)}
                        onFocus={() => prefetchAppRoute(to)}
                        className={cn(
                          // Icon and name from xl; narrower, only the current page keeps its name.
                          'inline-flex h-9 min-w-9 shrink-0 items-center justify-center gap-2 rounded-sm px-2.5 text-sm text-muted-foreground transition-colors duration-200 outline-none select-none hover:bg-fill hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40',
                          isActive && 'bg-primary/12 font-semibold text-primary hover:bg-primary/16 hover:text-primary',
                        )}
                      >
                        <Icon className="size-4 shrink-0" />
                        <span className={cn('sr-only xl:not-sr-only xl:whitespace-nowrap', isActive && 'md:not-sr-only md:whitespace-nowrap')}>{label}</span>
                      </NavLink>
                    </Tip>
                  )
                })}
                {pinned.length && groups.length ? <span className="mx-1.5 h-5 w-px shrink-0 bg-line" aria-hidden /> : null}
                {groups.map((group) => <AppNavGroupMenu key={group.id} group={group} />)}
              </div>
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2 lg:gap-4">
            <PageSettingsButton />
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
      <AppBottomNav pinned={pinned} />

      <HomeSearchDrawer active={shouldShowHeaderSearch} />
      <CommandPaletteLauncher />
      {shouldUseGlobalScrollRestoration ? <ScrollRestoration getKey={(location) => `${location.pathname}${location.search}`} /> : null}
    </div>
  )
}
