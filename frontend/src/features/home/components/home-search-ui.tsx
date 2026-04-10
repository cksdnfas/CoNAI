import { Suspense, lazy, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { useHomeSearch } from '@/features/home/home-search-context'

const HomeSearchDrawerContentLazy = lazy(async () => {
  const module = await import('./home-search-drawer-content')
  return { default: module.HomeSearchDrawerContent }
})

/** Render the header search control as a drawer-open button only. */
export function HomeSearchHeaderBox({ active }: { active: boolean }) {
  const { appliedChips, openDrawer } = useHomeSearch()

  if (!active) {
    return null
  }

  return (
    <button
      type="button"
      onClick={openDrawer}
      className="theme-floating-panel inline-flex items-center gap-2 rounded-full p-2 text-sm text-foreground transition hover:bg-surface-high"
      aria-label="검색 열기"
      title="검색"
    >
      <Search className="h-4 w-4" />
      {appliedChips.length > 0 ? <span className="rounded-full bg-primary/14 px-2 py-0.5 text-[11px] font-semibold text-primary">{appliedChips.length}</span> : null}
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

  if (!active || !shouldMountDrawer) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <HomeSearchDrawerContentLazy active={active} />
    </Suspense>
  )
}
