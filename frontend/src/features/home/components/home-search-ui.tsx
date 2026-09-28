import { Suspense, lazy, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { useHomeSearch } from '@/features/home/home-search-context'
import { registerTranslationCatalog, useI18n } from '@/i18n'

type HomeSearchDrawerContentModule = typeof import('./home-search-drawer-content')
type HomeSearchDrawerContentComponent = HomeSearchDrawerContentModule['HomeSearchDrawerContent']
type IdlePreloadWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

let homeSearchDrawerContentLoadPromise: Promise<{ default: HomeSearchDrawerContentComponent }> | null = null

function loadHomeSearchDrawerContent() {
  homeSearchDrawerContentLoadPromise ??= Promise.all([
    import('./home-search-drawer-content'),
    import('@/i18n/resources/home').then((catalogModule) => catalogModule.homeCatalog),
    import('@/i18n/resources/search').then((catalogModule) => catalogModule.searchCatalog),
  ])
    .then(([module, homeCatalog, searchCatalog]) => {
      registerTranslationCatalog(homeCatalog)
      registerTranslationCatalog(searchCatalog)
      return { default: module.HomeSearchDrawerContent }
    })
    .catch((error: unknown) => {
      homeSearchDrawerContentLoadPromise = null
      throw error
    })

  return homeSearchDrawerContentLoadPromise
}

function scheduleHomeSearchDrawerContentPreload() {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const idleWindow = window as IdlePreloadWindow
  if (typeof idleWindow.requestIdleCallback === 'function') {
    const idleHandle = idleWindow.requestIdleCallback(() => {
      void loadHomeSearchDrawerContent()
    }, { timeout: 2500 })

    return () => idleWindow.cancelIdleCallback?.(idleHandle)
  }

  const timeoutHandle = window.setTimeout(() => {
    void loadHomeSearchDrawerContent()
  }, 1200)

  return () => window.clearTimeout(timeoutHandle)
}

const HomeSearchDrawerContentLazy = lazy(loadHomeSearchDrawerContent)

/** Render the header search control as a drawer toggle button. */
export function HomeSearchHeaderBox({ active }: { active: boolean }) {
  const { appliedChips, isDrawerOpen, openDrawer, closeDrawer } = useHomeSearch()
  const { t } = useI18n()

  if (!active) {
    return null
  }

  return (
    <IconButton
      variant="ghost"
      onClick={() => {
        if (isDrawerOpen) {
          closeDrawer()
          return
        }

        void loadHomeSearchDrawerContent()
        openDrawer()
      }}
      data-state={isDrawerOpen ? 'open' : appliedChips.length > 0 ? 'active' : 'closed'}
      aria-expanded={isDrawerOpen}
      className="theme-shell-icon-button relative text-foreground/80 hover:text-foreground"
      label={isDrawerOpen ? t({ ko: '라이브러리 검색 닫기', en: 'Close library search' }) : t({ ko: '라이브러리 검색', en: 'Search library' })}
      tooltipSide="bottom"
    >
      <Search className="h-4 w-4" />
      {appliedChips.length > 0 ? (
        <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-sm bg-primary px-1 text-2xs font-semibold leading-4 text-primary-foreground ring-2 ring-background">
          {appliedChips.length}
        </span>
      ) : null}
    </IconButton>
  )
}

/** Mount the heavy drawer content only after the drawer has been opened at least once. */
export function HomeSearchDrawer({ active }: { active: boolean }) {
  const { isDrawerOpen } = useHomeSearch()
  const [shouldMountDrawer, setShouldMountDrawer] = useState(isDrawerOpen)

  useEffect(() => {
    if (isDrawerOpen) {
      setShouldMountDrawer(true)
    }
  }, [isDrawerOpen])

  useEffect(() => {
    if (!active) {
      return
    }

    return scheduleHomeSearchDrawerContentPreload()
  }, [active])

  if (!active || !shouldMountDrawer) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <HomeSearchDrawerContentLazy active={active} />
    </Suspense>
  )
}
