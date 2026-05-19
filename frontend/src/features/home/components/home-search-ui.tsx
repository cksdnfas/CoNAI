import { Suspense, lazy, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { useHomeSearch } from '@/features/home/home-search-context'
import { useI18n } from '@/i18n'

type HomeSearchDrawerContentModule = typeof import('./home-search-drawer-content')
type HomeSearchDrawerContentComponent = HomeSearchDrawerContentModule['HomeSearchDrawerContent']
type IdlePreloadWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

let homeSearchDrawerContentLoadPromise: Promise<{ default: HomeSearchDrawerContentComponent }> | null = null

function loadHomeSearchDrawerContent() {
  homeSearchDrawerContentLoadPromise ??= import('./home-search-drawer-content')
    .then((module) => ({ default: module.HomeSearchDrawerContent }))
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
    <button
      type="button"
      onClick={() => {
        if (isDrawerOpen) {
          closeDrawer()
          return
        }

        void loadHomeSearchDrawerContent()
        openDrawer()
      }}
      data-state={isDrawerOpen ? 'open' : appliedChips.length > 0 ? 'active' : 'closed'}
      className="theme-shell-icon-button relative inline-flex size-9 shrink-0 items-center justify-center rounded-sm text-foreground/80 transition-all duration-300 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
      aria-label={isDrawerOpen ? t({ ko: '검색 닫기', en: 'Close search' }) : t({ ko: '검색 열기', en: 'Open search' })}
      title={isDrawerOpen ? t({ ko: '검색 닫기', en: 'Close search' }) : t({ ko: '검색', en: 'Search' })}
    >
      <Search className="h-4 w-4" />
      {appliedChips.length > 0 ? (
        <span className="absolute -right-1 -top-1 inline-flex min-w-[1rem] items-center justify-center rounded-sm border border-primary/25 bg-primary/16 px-1 text-[10px] font-semibold leading-4 text-primary shadow-[0_0_0_2px_var(--background)]">
          {appliedChips.length}
        </span>
      ) : null}
    </button>
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
