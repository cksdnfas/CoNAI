import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { SEARCH_SCOPE_LABEL_KEYS, SEARCH_SCOPE_TABS } from '@/features/search/search-constants'
import { getSearchScopeStyle } from '@/features/search/search-utils'
import type { SearchScope } from '@/features/search/search-types'
import { SegmentedControl } from '@/components/common/segmented-control'
import { useHorizontalDragScroll } from '@/components/common/use-horizontal-drag-scroll'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'

interface SearchScopeTabsProps {
  searchScope: SearchScope
  onChange: (scope: SearchScope) => void
  /** Tabs to show (default: the chip scopes). */
  scopes?: SearchScope[]
  className?: string
}

const DEFAULT_SCOPES = SEARCH_SCOPE_TABS.map((tab) => tab.value)

/** Render the shared search scope tabs with drag-scroll and edge hints. */
export function SearchScopeTabs({ searchScope, onChange, scopes = DEFAULT_SCOPES, className }: SearchScopeTabsProps) {
  const { t } = useI18n()
  const {
    scrollRef,
    canScrollLeft,
    canScrollRight,
    isDragging,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handlePointerLeave,
    handleItemClick,
  } = useHorizontalDragScroll(scopes)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) {
      return
    }

    const activeButton = element.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
    activeButton?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  }, [searchScope, scrollRef])

  return (
    <div className={cn('relative', className)}>
      {canScrollLeft ? (
        <IconButton
          size="icon-sm"
          variant="secondary"
          onClick={() => scrollRef.current?.scrollBy({ left: -160, behavior: 'smooth' })}
          className="absolute left-0 top-1/2 z-10 -translate-y-1/2"
          label={t('search.components.search.scope.tabs.previous.filter.item')}
        >
          <ChevronLeft className="h-4 w-4" />
        </IconButton>
      ) : null}

      {canScrollRight ? (
        <IconButton
          size="icon-sm"
          variant="secondary"
          onClick={() => scrollRef.current?.scrollBy({ left: 160, behavior: 'smooth' })}
          className="absolute right-0 top-1/2 z-10 -translate-y-1/2"
          label={t('search.components.search.scope.tabs.next.filter.item')}
        >
          <ChevronRight className="h-4 w-4" />
        </IconButton>
      ) : null}

      <div
        ref={scrollRef}
        className={cn('scroll-x theme-nav-scroll', isDragging && 'cursor-grabbing select-none')}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
        onClickCapture={handleItemClick}
      >
        <div className="min-w-full pr-9">
          <SegmentedControl
            value={searchScope}
            items={scopes.map((scope) => ({ value: scope, label: t(SEARCH_SCOPE_LABEL_KEYS[scope]), activeStyle: getSearchScopeStyle(scope) }))}
            size="xs"
            className="flex-nowrap"
            onChange={(scope) => onChange(scope as SearchScope)}
          />
        </div>
      </div>
    </div>
  )
}
