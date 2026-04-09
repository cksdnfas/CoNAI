import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, FolderTree, House, Image, LayoutGrid, MessageSquareText, Settings2, Sparkles, Upload, type LucideIcon } from 'lucide-react'
import { NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router-dom'
import { HomeSearchProvider } from '@/features/home/home-search-context'
import { HomeSearchDrawer, HomeSearchHeaderBox } from '@/features/home/components/home-search-ui'
import { ImageViewModalProvider } from '@/features/images/components/detail/image-view-modal-provider'
import { cn } from '@/lib/utils'

const navItems: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/', label: 'Home', icon: House },
  { to: '/groups', label: 'Group', icon: FolderTree },
  { to: '/prompts', label: 'Prompt', icon: MessageSquareText },
  { to: '/generation', label: 'Generate', icon: Sparkles },
  { to: '/wallpaper', label: 'Wallpaper', icon: LayoutGrid },
  { to: '/upload', label: 'Upload', icon: Upload },
  { to: '/settings', label: 'Settings', icon: Settings2 },
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
  const isWallpaperRuntime = location.pathname === '/wallpaper/runtime'
  const shouldUseGlobalScrollRestoration = location.pathname !== '/' && !location.pathname.startsWith('/groups')
  const navScrollRef = useRef<HTMLDivElement | null>(null)
  const navDragPointerIdRef = useRef<number | null>(null)
  const navDragStartXRef = useRef(0)
  const navDragStartScrollLeftRef = useRef(0)
  const suppressNavClickRef = useRef(false)
  const [canScrollNavLeft, setCanScrollNavLeft] = useState(false)
  const [canScrollNavRight, setCanScrollNavRight] = useState(false)
  const [isDraggingNav, setIsDraggingNav] = useState(false)

  useEffect(() => {
    const navScrollElement = navScrollRef.current
    if (!navScrollElement) {
      return
    }

    const updateNavScrollHints = () => {
      const maxScrollLeft = Math.max(0, navScrollElement.scrollWidth - navScrollElement.clientWidth)
      setCanScrollNavLeft(navScrollElement.scrollLeft > 4)
      setCanScrollNavRight(navScrollElement.scrollLeft < maxScrollLeft - 4)
    }

    updateNavScrollHints()

    const resizeObserver = new ResizeObserver(() => {
      updateNavScrollHints()
    })
    resizeObserver.observe(navScrollElement)

    const contentElement = navScrollElement.firstElementChild
    if (contentElement instanceof HTMLElement) {
      resizeObserver.observe(contentElement)
    }

    navScrollElement.addEventListener('scroll', updateNavScrollHints, { passive: true })
    window.addEventListener('resize', updateNavScrollHints)

    return () => {
      resizeObserver.disconnect()
      navScrollElement.removeEventListener('scroll', updateNavScrollHints)
      window.removeEventListener('resize', updateNavScrollHints)
    }
  }, [location.pathname])

  /** Reset the temporary nav-drag state after horizontal scroll gestures. */
  const finishNavDrag = () => {
    navDragPointerIdRef.current = null
    navDragStartXRef.current = 0
    navDragStartScrollLeftRef.current = 0
    setIsDraggingNav(false)

    window.setTimeout(() => {
      suppressNavClickRef.current = false
    }, 0)
  }

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
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return
                  }

                  navDragPointerIdRef.current = event.pointerId
                  navDragStartXRef.current = event.clientX
                  navDragStartScrollLeftRef.current = navScrollRef.current?.scrollLeft ?? 0
                  suppressNavClickRef.current = false
                  setIsDraggingNav(false)
                }}
                onPointerMove={(event) => {
                  if (navDragPointerIdRef.current !== event.pointerId || !navScrollRef.current) {
                    return
                  }

                  const deltaX = event.clientX - navDragStartXRef.current
                  if (!isDraggingNav && Math.abs(deltaX) > 6) {
                    suppressNavClickRef.current = true
                    setIsDraggingNav(true)
                  }

                  if (Math.abs(deltaX) <= 1) {
                    return
                  }

                  navScrollRef.current.scrollLeft = navDragStartScrollLeftRef.current - deltaX
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onPointerUp={(event) => {
                  if (navDragPointerIdRef.current !== event.pointerId) {
                    return
                  }

                  finishNavDrag()
                }}
                onPointerCancel={(event) => {
                  if (navDragPointerIdRef.current !== event.pointerId) {
                    return
                  }

                  finishNavDrag()
                }}
                onPointerLeave={(event) => {
                  if (navDragPointerIdRef.current !== event.pointerId || !isDraggingNav) {
                    return
                  }

                  finishNavDrag()
                }}
                style={{ touchAction: 'pan-y pinch-zoom' }}
              >
                <nav className="flex min-w-max items-center gap-2 pr-10 sm:pr-2" aria-label="주요 페이지 이동">
                  {navItems.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={to === '/'}
                      aria-label={label}
                      title={label}
                      draggable={false}
                      onClick={(event) => {
                        if (!suppressNavClickRef.current) {
                          return
                        }

                        event.preventDefault()
                        event.stopPropagation()
                      }}
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
            <HomeSearchHeaderBox active={true} />
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
