import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getThemeToneStyle } from '@/lib/theme-tones'
import { cn } from '@/lib/utils'
import { useHomeSearch } from '@/features/home/home-search-context'
import type { RatingTierRecord, SearchScope } from '@/features/home/search-types'
import type { PromptCollectionItem } from '@/types/prompt'

const SEARCH_SCOPE_TABS: Array<{ value: SearchScope; label: string }> = [
  { value: 'positive', label: '긍정' },
  { value: 'auto', label: '오토' },
  { value: 'negative', label: '부정' },
  { value: 'rating', label: '평가' },
]

const SEARCH_SCOPE_LABELS: Record<SearchScope, string> = {
  positive: '긍정',
  negative: '부정',
  auto: '오토',
  rating: '평가',
}

interface HomeSearchScopeTabsProps {
  searchScope: SearchScope
  setSearchScope: (scope: SearchScope) => void
  onClose?: () => void
}

interface HomeSearchSuggestionListProps {
  searchScope: SearchScope
  searchInput: string
  promptSuggestions: PromptCollectionItem[]
  filteredRatingTiers: RatingTierRecord[]
  suggestionsLoading: boolean
  ratingTiersLoading: boolean
  submitSearchFromInput: () => void
  addSuggestionChip: (item: PromptCollectionItem) => void
  addRatingChip: (tier: RatingTierRecord) => void
}

interface HomeSearchInputBoxProps {
  searchInput: string
  setSearchInput: (value: string) => void
  submitSearchFromInput: () => void
  placeholder: string
  ariaLabel: string
  onFocus?: () => void
  style?: CSSProperties
}

interface HomeSearchSuggestionPanelProps {
  searchScope: SearchScope
  setSearchScope: (scope: SearchScope) => void
  searchInput: string
  promptSuggestions: PromptCollectionItem[]
  filteredRatingTiers: RatingTierRecord[]
  suggestionsLoading: boolean
  ratingTiersLoading: boolean
  submitSearchFromInput: () => void
  addSuggestionChip: (item: PromptCollectionItem) => void
  addRatingChip: (tier: RatingTierRecord) => void
  onClose?: () => void
  className?: string
  style?: CSSProperties
}

/** Render the shared search scope tabs used by the search suggestion panel. */
function HomeSearchScopeTabs({ searchScope, setSearchScope, onClose }: HomeSearchScopeTabsProps) {
  return (
    <div className="flex items-center gap-2 border-b border-white/5 px-[var(--theme-panel-padding-x)] py-[calc(var(--theme-panel-padding-y)_-_0.125rem)]">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {SEARCH_SCOPE_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setSearchScope(tab.value)}
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

      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm p-2 text-muted-foreground transition hover:bg-surface-high hover:text-foreground"
          aria-label="입력 필터 닫기"
          title="입력 필터 닫기"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  )
}

/** Render the shared search input box used by the drawer search entry. */
function HomeSearchInputBox({ searchInput, setSearchInput, submitSearchFromInput, placeholder, ariaLabel, onFocus, style }: HomeSearchInputBoxProps) {
  return (
    <div
      className="theme-settings-control flex items-center rounded-sm border border-border bg-surface-lowest text-sm text-foreground transition focus-within:border-primary focus-within:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_35%,transparent)]"
      style={style}
    >
      <Search className="mr-2 h-4 w-4 text-muted-foreground" />
      <input
        value={searchInput}
        onFocus={onFocus}
        onChange={(event) => setSearchInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submitSearchFromInput()
          }
        }}
        placeholder={placeholder}
        className="h-full w-full bg-transparent outline-none placeholder:text-muted-foreground"
        aria-label={ariaLabel}
      />
    </div>
  )
}

/** Render the shared search suggestion list for text and rating scopes. */
function HomeSearchSuggestionList({
  searchScope,
  searchInput,
  promptSuggestions,
  filteredRatingTiers,
  suggestionsLoading,
  ratingTiersLoading,
  submitSearchFromInput,
  addSuggestionChip,
  addRatingChip,
}: HomeSearchSuggestionListProps) {
  if (searchScope !== 'rating') {
    return (
      <>
        {searchInput.trim().length > 0 ? (
          <button
            type="button"
            onClick={submitSearchFromInput}
            className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-surface-high"
          >
            <span className="text-sm text-foreground">&quot;{searchInput.trim()}&quot; 검색</span>
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
    )
  }

  return (
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
  )
}

/** Render the shared suggestion panel below the drawer search input. */
function HomeSearchSuggestionPanel({
  searchScope,
  setSearchScope,
  searchInput,
  promptSuggestions,
  filteredRatingTiers,
  suggestionsLoading,
  ratingTiersLoading,
  submitSearchFromInput,
  addSuggestionChip,
  addRatingChip,
  onClose,
  className,
  style,
}: HomeSearchSuggestionPanelProps) {
  return (
    <div className={cn('theme-floating-panel overflow-hidden rounded-sm', className)} style={style}>
      <HomeSearchScopeTabs searchScope={searchScope} setSearchScope={setSearchScope} onClose={onClose} />

      <div className="max-h-[420px] overflow-y-auto py-2">
        <HomeSearchSuggestionList
          searchScope={searchScope}
          searchInput={searchInput}
          promptSuggestions={promptSuggestions}
          filteredRatingTiers={filteredRatingTiers}
          suggestionsLoading={suggestionsLoading}
          ratingTiersLoading={ratingTiersLoading}
          submitSearchFromInput={submitSearchFromInput}
          addSuggestionChip={addSuggestionChip}
          addRatingChip={addRatingChip}
        />
      </div>
    </div>
  )
}

/** Render the header search control as a drawer-open button only. */
export function HomeSearchHeaderBox({ active, desktopMode: _desktopMode }: { active: boolean; desktopMode: boolean }) {
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
      {appliedChips.length > 0 ? (
        <span className="rounded-full bg-primary/14 px-2 py-0.5 text-[11px] font-semibold text-primary">{appliedChips.length}</span>
      ) : null}
    </button>
  )
}

/** Render the right-side search drawer for active filters and saved history. */
export function HomeSearchDrawer({ active }: { active: boolean }) {
  const {
    isDrawerOpen,
    searchScope,
    searchInput,
    draftChips,
    appliedChips,
    promptSuggestions,
    filteredRatingTiers,
    historyEntries,
    suggestionsLoading,
    historyLoading,
    ratingTiersLoading,
    closeDrawer,
    setSearchInput,
    setSearchScope,
    submitSearchFromInput,
    addSuggestionChip,
    addRatingChip,
    cycleChipOperator,
    removeChip,
    applySearch,
    clearSearch,
    selectHistoryEntry,
    deleteHistoryEntry,
    clearHistoryEntries,
  } = useHomeSearch()
  const [isSuggestionPanelOpen, setIsSuggestionPanelOpen] = useState(false)
  const searchSectionRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isDrawerOpen) {
      setIsSuggestionPanelOpen(false)
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!searchSectionRef.current?.contains(event.target as Node)) {
        setIsSuggestionPanelOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isDrawerOpen])

  if (!active) {
    return null
  }

  const activeCountLabel = appliedChips.length > 0 ? `${appliedChips.length} filters` : 'Search gallery…'

  const handleOpenSuggestionPanel = () => {
    setIsSuggestionPanelOpen(true)
  }

  const handleCloseSuggestionPanel = () => {
    setIsSuggestionPanelOpen(false)
  }

  const handleSubmitSearchFromInput = () => {
    submitSearchFromInput()
    setIsSuggestionPanelOpen(false)
  }

  const handleAddSuggestionChip = (item: PromptCollectionItem) => {
    addSuggestionChip(item)
    setIsSuggestionPanelOpen(false)
  }

  const handleAddRatingChip = (tier: RatingTierRecord) => {
    addRatingChip(tier)
    setIsSuggestionPanelOpen(false)
  }

  const handleApplySearch = () => {
    applySearch()
    setIsSuggestionPanelOpen(false)
  }

  const handleClearSearch = () => {
    clearSearch()
    setIsSuggestionPanelOpen(false)
  }

  return (
    <>
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 top-[var(--theme-shell-header-height)] z-40 bg-black/40 transition-opacity',
          isDrawerOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={closeDrawer}
      />

      <aside
        className={cn(
          'theme-floating-panel fixed bottom-0 right-0 top-[var(--theme-shell-header-height)] z-40 flex h-[calc(100vh-var(--theme-shell-header-height))] max-w-full flex-col transition-transform duration-300',
          isDrawerOpen ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ width: 'min(calc(100vw - 0.75rem), var(--theme-search-drawer-width))' }}
      >
        <div className="theme-drawer-header flex items-center justify-between border-b border-white/5">
          <div className="text-2xl font-semibold tracking-tight text-foreground">search</div>
          <button type="button" onClick={closeDrawer} className="rounded-sm p-2 text-muted-foreground transition hover:bg-surface-high hover:text-foreground" aria-label="검색 드로어 닫기">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="theme-drawer-body flex-1 space-y-6 overflow-y-auto">
          <section ref={searchSectionRef} className="space-y-3">
            <HomeSearchInputBox
              searchInput={searchInput}
              setSearchInput={setSearchInput}
              submitSearchFromInput={handleSubmitSearchFromInput}
              placeholder={activeCountLabel}
              ariaLabel="드로어 검색 입력"
              onFocus={handleOpenSuggestionPanel}
            />

            {isSuggestionPanelOpen ? (
              <HomeSearchSuggestionPanel
                searchScope={searchScope}
                setSearchScope={setSearchScope}
                searchInput={searchInput}
                promptSuggestions={promptSuggestions}
                filteredRatingTiers={filteredRatingTiers}
                suggestionsLoading={suggestionsLoading}
                ratingTiersLoading={ratingTiersLoading}
                submitSearchFromInput={handleSubmitSearchFromInput}
                addSuggestionChip={handleAddSuggestionChip}
                addRatingChip={handleAddRatingChip}
                onClose={handleCloseSuggestionPanel}
              />
            ) : null}
          </section>

          <section className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Current filters</div>
            {draftChips.length === 0 ? <div className="rounded-sm border border-white/5 bg-surface-lowest px-4 py-4 text-sm text-muted-foreground">No filters</div> : null}
            {draftChips.length > 0 ? (
              <div className="space-y-2">
                {draftChips.map((chip) => (
                  <div key={chip.id} className="flex items-center gap-2 rounded-sm border border-border bg-surface-lowest px-3 py-3">
                    <span className="rounded-sm px-2 py-1 text-[11px] font-semibold tracking-[0.08em]" style={getThemeToneStyle(chip.scope)}>
                      {SEARCH_SCOPE_LABELS[chip.scope]}
                    </span>
                    <button
                      type="button"
                      onClick={() => cycleChipOperator(chip.id)}
                      className="rounded-sm border border-primary/35 bg-primary/10 px-2.5 py-1 text-[11px] font-bold tracking-[0.16em] text-primary shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_8%,transparent)] transition hover:bg-primary/18 hover:border-primary/55 active:scale-[0.98]"
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
                ))}
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button type="button" className="flex-1" onClick={handleApplySearch}>
                검색
              </Button>
              <Button type="button" variant="outline" className="flex-1" onClick={handleClearSearch}>
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
                  <div key={entry.id} className="flex items-start gap-3 rounded-sm border border-border bg-surface-lowest px-4 py-3">
                    <button type="button" onClick={() => selectHistoryEntry(entry)} className="min-w-0 flex-1 text-left">
                      <div className="flex flex-wrap gap-2">
                        {entry.chips.map((chip) => (
                          <span key={chip.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1.5 text-xs text-foreground">
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em]" style={getThemeToneStyle(chip.scope)}>
                              {SEARCH_SCOPE_LABELS[chip.scope]}
                            </span>
                            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold tracking-[0.14em] text-primary">
                              {chip.operator}
                            </span>
                            <span className="truncate" style={chip.color ? { color: chip.color } : undefined}>
                              {chip.label}
                            </span>
                          </span>
                        ))}
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
