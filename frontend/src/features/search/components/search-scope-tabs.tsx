import { getThemeToneStyle } from '@/lib/theme-tones'
import { cn } from '@/lib/utils'
import { SEARCH_SCOPE_TABS } from '@/features/search/search-constants'
import type { SearchScope } from '@/features/search/search-types'

interface SearchScopeTabsProps {
  searchScope: SearchScope
  onChange: (scope: SearchScope) => void
  className?: string
}

/** Render the shared search scope tabs used by home search and auto-collect. */
export function SearchScopeTabs({ searchScope, onChange, className }: SearchScopeTabsProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {SEARCH_SCOPE_TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={cn(
            'rounded-sm px-3 py-1.5 text-xs font-semibold transition-colors',
            searchScope === tab.value ? '' : 'text-muted-foreground hover:bg-surface-high hover:text-foreground',
          )}
          style={searchScope === tab.value ? getThemeToneStyle(tab.value) : undefined}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
