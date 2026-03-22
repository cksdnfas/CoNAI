import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useHomeSearch } from '@/features/home/home-search-context'
import type { SearchScope } from '@/features/home/search-types'

const SEARCH_SCOPE_TABS: Array<{ value: SearchScope; label: string }> = [
  { value: 'positive', label: '긍정' },
  { value: 'auto', label: '오토' },
  { value: 'negative', label: '부정' },
  { value: 'rating', label: '평가' },
]

const SEARCH_SCOPE_BADGE: Record<SearchScope, { label: string; className: string }> = {
  positive: { label: '긍정', className: 'bg-emerald-500/12 text-emerald-300' },
  negative: { label: '부정', className: 'bg-rose-500/12 text-rose-300' },
  auto: { label: '오토', className: 'bg-sky-500/12 text-sky-300' },
  rating: { label: '평가', className: 'bg-violet-500/12 text-violet-300' },
}

/** Render the shared header search input with autocomplete-style suggestion results. */
export function HomeSearchHeaderBox({ active }: { active: boolean }) {
  const {
    isDrawerOpen,
    searchScope,
    searchInput,
    promptSuggestions,
    filteredRatingTiers,
    suggestionsLoading,
    ratingTiersLoading,
    appliedChips,
    openDrawer,
    setSearchInput,
    setSearchScope,
    submitSearchFromInput,
    addSuggestionChip,
    addRatingChip,
  } = useHomeSearch()

  if (!active) {
    return (
      <div className="hidden items-center rounded-sm bg-surface-lowest px-3 py-1.5 text-sm text-muted-foreground md:flex">
        <Search className="mr-2 h-4 w-4" />
        <span className="w-44 truncate">Search gallery…</span>
      </div>
    )
  }

  const showSuggestionMenu = isDrawerOpen && (searchScope === 'rating' || searchInput.trim().length > 0)
  const activeCountLabel = appliedChips.length > 0 ? `${appliedChips.length} filters` : 'Search gallery…'

  return (
    <div className="relative hidden md:block">
      <div className="flex h-10 w-[380px] items-center rounded-sm border border-white/10 bg-surface-lowest px-3 text-sm text-foreground transition focus-within:border-primary focus-within:shadow-[0_0_0_1px_rgba(249,94,20,0.35)]">
        <Search className="mr-2 h-4 w-4 text-muted-foreground" />
        <input
          value={searchInput}
          onFocus={openDrawer}
          onChange={(event) => setSearchInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submitSearchFromInput()
            }
          }}
          placeholder={activeCountLabel}
          className="h-full w-full bg-transparent outline-none placeholder:text-muted-foreground"
          aria-label="갤러리 검색"
        />
      </div>

      {showSuggestionMenu ? (
        <div className="absolute right-0 top-12 z-[70] w-[380px] overflow-hidden rounded-sm border border-white/10 bg-background shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
          <div className="flex items-center gap-1 border-b border-white/5 px-2 py-2">
            {SEARCH_SCOPE_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setSearchScope(tab.value)}
                className={cn(
                  'rounded-sm px-3 py-1.5 text-xs font-semibold transition-colors',
                  searchScope === tab.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-surface-high hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="max-h-[420px] overflow-y-auto py-2">
            {searchScope !== 'rating' ? (
              <>
                {searchInput.trim().length > 0 ? (
                  <button
                    type="button"
                    onClick={submitSearchFromInput}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-surface-high"
                  >
                    <span className="text-sm text-foreground">"{searchInput.trim()}" 검색</span>
                    <span className="text-xs text-muted-foreground">Enter</span>
                  </button>
                ) : null}

                {suggestionsLoading ? <div className="px-4 py-6 text-sm text-muted-foreground">추천 항목을 불러오는 중…</div> : null}
                {!suggestionsLoading && promptSuggestions.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-muted-foreground">일치하는 추천 프롬프트가 아직 없어.</div>
                ) : null}
                {!suggestionsLoading && promptSuggestions.length > 0
                  ? promptSuggestions.map((item) => (
                      <button
                        key={`${item.type}-${item.id}`}
                        type="button"
                        onClick={() => addSuggestionChip(item)}
                        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-surface-high"
                      >
                        <span className="truncate text-sm text-secondary">{item.prompt}</span>
                        <span className="shrink-0 text-sm text-muted-foreground">{item.usage_count.toLocaleString('ko-KR')}</span>
                      </button>
                    ))
                  : null}
              </>
            ) : (
              <>
                {ratingTiersLoading ? <div className="px-4 py-6 text-sm text-muted-foreground">평가 티어를 불러오는 중…</div> : null}
                {!ratingTiersLoading && filteredRatingTiers.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-muted-foreground">일치하는 평가 티어가 없어.</div>
                ) : null}
                {!ratingTiersLoading && filteredRatingTiers.length > 0
                  ? filteredRatingTiers.map((tier) => (
                      <button
                        key={tier.id}
                        type="button"
                        onClick={() => addRatingChip(tier)}
                        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-surface-high"
                      >
                        <span className="text-sm font-semibold" style={tier.color ? { color: tier.color } : undefined}>
                          {tier.tier_name}
                        </span>
                        <span className="shrink-0 text-sm text-muted-foreground">
                          {tier.min_score}~{tier.max_score === null ? '∞' : tier.max_score}
                        </span>
                      </button>
                    ))
                  : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Render the right-side search drawer for active filters and saved history. */
export function HomeSearchDrawer({ active }: { active: boolean }) {
  const {
    isDrawerOpen,
    draftChips,
    historyEntries,
    historyLoading,
    closeDrawer,
    cycleChipOperator,
    removeChip,
    applySearch,
    clearSearch,
    selectHistoryEntry,
    deleteHistoryEntry,
    clearHistoryEntries,
  } = useHomeSearch()

  if (!active) {
    return null
  }

  return (
    <>
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 top-16 z-40 bg-black/40 transition-opacity',
          isDrawerOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={closeDrawer}
      />

      <aside
        className={cn(
          'fixed bottom-0 right-0 top-16 z-40 flex h-[calc(100vh-4rem)] w-[420px] max-w-full flex-col border-l border-white/10 bg-background shadow-[0_0_40px_rgba(0,0,0,0.4)] transition-transform duration-300',
          isDrawerOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
          <div className="text-2xl font-semibold tracking-tight text-foreground">search</div>
          <button type="button" onClick={closeDrawer} className="rounded-sm p-2 text-muted-foreground transition hover:bg-surface-high hover:text-foreground" aria-label="검색 드로어 닫기">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Current filters</div>
            {draftChips.length === 0 ? <div className="rounded-sm border border-white/5 bg-surface-lowest px-4 py-4 text-sm text-muted-foreground">No filters</div> : null}
            {draftChips.length > 0 ? (
              <div className="space-y-2">
                {draftChips.map((chip) => {
                  const scopeBadge = SEARCH_SCOPE_BADGE[chip.scope]

                  return (
                    <div key={chip.id} className="flex items-center gap-2 rounded-sm border border-white/10 bg-surface-lowest px-3 py-3">
                      <span className={cn('rounded-sm px-2 py-1 text-[11px] font-semibold tracking-[0.08em]', scopeBadge.className)}>
                        {scopeBadge.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => cycleChipOperator(chip.id)}
                        className="rounded-sm border border-primary/35 bg-primary/10 px-2.5 py-1 text-[11px] font-bold tracking-[0.16em] text-primary shadow-[inset_0_0_0_1px_rgba(249,94,20,0.08)] transition hover:bg-primary/18 hover:border-primary/55 active:scale-[0.98]"
                        aria-label={`${chip.label} 연산자 변경`}
                        title="클릭해서 OR / AND / NOT 전환"
                      >
                        {chip.operator}
                      </button>
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground" style={chip.color ? { color: chip.color } : undefined}>
                        {chip.label}
                      </span>
                      <button type="button" onClick={() => removeChip(chip.id)} className="text-muted-foreground transition hover:text-foreground" aria-label={`${chip.label} 삭제`}>
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button type="button" className="flex-1" onClick={applySearch}>
                검색
              </Button>
              <Button type="button" variant="outline" className="flex-1" onClick={clearSearch}>
                초기화
              </Button>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Recent searches</div>
              <button type="button" onClick={() => void clearHistoryEntries()} className="text-xs text-muted-foreground transition hover:text-foreground">
                Clear History
              </button>
            </div>

            {historyLoading ? <div className="rounded-sm border border-white/5 bg-surface-lowest px-4 py-4 text-sm text-muted-foreground">Loading…</div> : null}
            {!historyLoading && historyEntries.length === 0 ? (
              <div className="rounded-sm border border-white/5 bg-surface-lowest px-4 py-4 text-sm text-muted-foreground">No history</div>
            ) : null}
            {!historyLoading && historyEntries.length > 0 ? (
              <div className="space-y-3">
                {historyEntries.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3 rounded-sm border border-white/10 bg-surface-lowest px-4 py-3">
                    <button type="button" onClick={() => selectHistoryEntry(entry)} className="min-w-0 flex-1 text-left">
                      <div className="flex flex-wrap gap-2">
                        {entry.chips.map((chip) => {
                          const scopeBadge = SEARCH_SCOPE_BADGE[chip.scope]

                          return (
                            <span key={chip.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-background px-2.5 py-1.5 text-xs text-foreground">
                              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em]', scopeBadge.className)}>
                                {scopeBadge.label}
                              </span>
                              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold tracking-[0.14em] text-primary">
                                {chip.operator}
                              </span>
                              <span className="truncate" style={chip.color ? { color: chip.color } : undefined}>
                                {chip.label}
                              </span>
                            </span>
                          )
                        })}
                      </div>
                    </button>
                    <button type="button" onClick={() => void deleteHistoryEntry(entry.id)} className="mt-1 text-muted-foreground transition hover:text-foreground" aria-label="검색 히스토리 삭제">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      </aside>
    </>
  )
}
