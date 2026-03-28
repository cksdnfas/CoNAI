import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { SEARCH_SCOPE_TABS } from '@/features/search/search-constants'
import { getSearchScopeStyle } from '@/features/search/search-utils'
import type { SearchScope } from '@/features/search/search-types'

interface SearchScopeTabsProps {
  searchScope: SearchScope
  onChange: (scope: SearchScope) => void
  className?: string
}

/** Render the shared search scope tabs with drag-scroll and edge hints. */
export function SearchScopeTabs({ searchScope, onChange, className }: SearchScopeTabsProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const dragPointerIdRef = useRef<number | null>(null)
  const dragStartXRef = useRef(0)
  const dragStartScrollLeftRef = useRef(0)
  const suppressClickRef = useRef(false)
  const bodyUserSelectRef = useRef('')
  const [isDragging, setIsDragging] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) {
      return
    }

    const updateScrollHints = () => {
      const maxScrollLeft = Math.max(element.scrollWidth - element.clientWidth, 0)
      setCanScrollLeft(element.scrollLeft > 8)
      setCanScrollRight(element.scrollLeft < maxScrollLeft - 8)
    }

    updateScrollHints()

    const resizeObserver = new ResizeObserver(updateScrollHints)
    resizeObserver.observe(element)

    const contentElement = element.firstElementChild
    if (contentElement instanceof HTMLElement) {
      resizeObserver.observe(contentElement)
    }

    element.addEventListener('scroll', updateScrollHints, { passive: true })
    window.addEventListener('resize', updateScrollHints)

    return () => {
      resizeObserver.disconnect()
      element.removeEventListener('scroll', updateScrollHints)
      window.removeEventListener('resize', updateScrollHints)
    }
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) {
      return
    }

    const activeButton = element.querySelector<HTMLButtonElement>(`button[data-scope="${searchScope}"]`)
    activeButton?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  }, [searchScope])

  const finishDrag = () => {
    dragPointerIdRef.current = null
    dragStartXRef.current = 0
    dragStartScrollLeftRef.current = 0
    setIsDragging(false)

    if (document.body.style.userSelect === 'none') {
      document.body.style.userSelect = bodyUserSelectRef.current
    }

    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 0)
  }

  return (
    <div className={cn('relative', className)}>
      {canScrollLeft ? (
        <button
          type="button"
          onClick={() => scrollRef.current?.scrollBy({ left: -160, behavior: 'smooth' })}
          className="absolute left-0 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center bg-gradient-to-r from-background via-background/95 to-transparent text-sm font-semibold text-muted-foreground transition hover:text-foreground"
          aria-label="이전 필터 항목"
          title="이전 필터 항목"
        >
          {'<'}
        </button>
      ) : null}

      {canScrollRight ? (
        <button
          type="button"
          onClick={() => scrollRef.current?.scrollBy({ left: 160, behavior: 'smooth' })}
          className="absolute right-0 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center bg-gradient-to-l from-background via-background/95 to-transparent text-sm font-semibold text-muted-foreground transition hover:text-foreground"
          aria-label="다음 필터 항목"
          title="다음 필터 항목"
        >
          {'>'}
        </button>
      ) : null}

      <div
        ref={scrollRef}
        className={cn('theme-nav-scroll overflow-x-auto', isDragging && 'cursor-grabbing select-none')}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return
          }

          dragPointerIdRef.current = event.pointerId
          dragStartXRef.current = event.clientX
          dragStartScrollLeftRef.current = scrollRef.current?.scrollLeft ?? 0
          suppressClickRef.current = false
          bodyUserSelectRef.current = document.body.style.userSelect
          setIsDragging(false)
        }}
        onPointerMove={(event) => {
          if (dragPointerIdRef.current !== event.pointerId || !scrollRef.current) {
            return
          }

          const deltaX = event.clientX - dragStartXRef.current
          if (!isDragging && Math.abs(deltaX) > 6) {
            suppressClickRef.current = true
            document.body.style.userSelect = 'none'
            setIsDragging(true)
          }

          if (Math.abs(deltaX) <= 1) {
            return
          }

          scrollRef.current.scrollLeft = dragStartScrollLeftRef.current - deltaX
          event.preventDefault()
          event.stopPropagation()
        }}
        onPointerUp={(event) => {
          if (dragPointerIdRef.current !== event.pointerId) {
            return
          }
          finishDrag()
        }}
        onPointerCancel={(event) => {
          if (dragPointerIdRef.current !== event.pointerId) {
            return
          }
          finishDrag()
        }}
        onPointerLeave={(event) => {
          if (dragPointerIdRef.current !== event.pointerId || !isDragging) {
            return
          }
          finishDrag()
        }}
      >
        <div className="inline-flex min-w-full items-center gap-2 pr-8">
          {SEARCH_SCOPE_TABS.map((tab) => (
            <button
              key={tab.value}
              data-scope={tab.value}
              type="button"
              onClick={() => {
                if (suppressClickRef.current) {
                  return
                }
                onChange(tab.value)
              }}
              className={cn(
                'shrink-0 rounded-sm px-3 py-1.5 text-xs font-semibold transition-colors select-none',
                searchScope === tab.value ? '' : 'text-muted-foreground hover:bg-surface-high hover:text-foreground',
              )}
              style={searchScope === tab.value ? getSearchScopeStyle(tab.value) : undefined}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
