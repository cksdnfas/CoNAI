import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { SEARCH_SCOPE_LABEL_KEYS, SEARCH_SCOPE_TABS } from '@/features/search/search-constants'
import { getSearchScopeStyle } from '@/features/search/search-utils'
import type { SearchScope } from '@/features/search/search-types'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'

interface SearchScopeTabsProps {
  searchScope: SearchScope
  onChange: (scope: SearchScope) => void
  className?: string
}

/** Render the shared search scope tabs with drag-scroll and edge hints. */
export function SearchScopeTabs({ searchScope, onChange, className }: SearchScopeTabsProps) {
  const { t } = useI18n()
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
        <IconButton
          size="icon-sm"
          variant="ghost"
          onClick={() => scrollRef.current?.scrollBy({ left: -160, behavior: 'smooth' })}
          className="absolute left-0 top-1/2 z-10 -translate-y-1/2 bg-gradient-to-r from-background via-background/95 to-transparent"
          label={t('search.components.search.scope.tabs.previous.filter.item')}
        >
          <ChevronLeft className="h-4 w-4" />
        </IconButton>
      ) : null}

      {canScrollRight ? (
        <IconButton
          size="icon-sm"
          variant="ghost"
          onClick={() => scrollRef.current?.scrollBy({ left: 160, behavior: 'smooth' })}
          className="absolute right-0 top-1/2 z-10 -translate-y-1/2 bg-gradient-to-l from-background via-background/95 to-transparent"
          label={t('search.components.search.scope.tabs.next.filter.item')}
        >
          <ChevronRight className="h-4 w-4" />
        </IconButton>
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
        <div className="inline-flex min-w-full items-center gap-1 rounded-sm bg-surface-low p-1 pr-9">
          {SEARCH_SCOPE_TABS.map((tab) => (
            <Button
              key={tab.value}
              data-scope={tab.value}
              type="button"
              variant="ghost"
              size="xs"
              aria-pressed={searchScope === tab.value}
              onClick={() => {
                if (suppressClickRef.current) {
                  return
                }
                onChange(tab.value)
              }}
              className={cn('px-3 font-semibold select-none', searchScope === tab.value && 'shadow-elevation-1')}
              style={searchScope === tab.value ? getSearchScopeStyle(tab.value) : undefined}
            >
              {t(SEARCH_SCOPE_LABEL_KEYS[tab.value])}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
