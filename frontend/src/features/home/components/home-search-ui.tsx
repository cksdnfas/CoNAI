import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SearchChipList } from '@/features/search/components/search-chip-list'
import { SearchScopeTabs } from '@/features/search/components/search-scope-tabs'
import { SearchSuggestionList } from '@/features/search/components/search-suggestion-list'
import { SEARCH_SCOPE_LABELS } from '@/features/search/search-constants'
import { createRatingSearchChip, getSearchScopeStyle } from '@/features/search/search-utils'
import type { RatingTierRecord } from '@/features/search/search-types'
import { useSearchSuggestionData } from '@/features/search/use-search-suggestion-data'
import { useHomeSearch } from '@/features/home/home-search-context'
import type { PromptCollectionItem } from '@/types/prompt'
import { cn } from '@/lib/utils'

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
  searchScope: ReturnType<typeof useHomeSearch>['searchScope']
  setSearchScope: ReturnType<typeof useHomeSearch>['setSearchScope']
  searchInput: string
  submitSearchFromInput: () => void
  addSuggestionChip: (value: string) => void
  addAIToolChip: ReturnType<typeof useHomeSearch>['addAIToolChip']
  addRatingChip: (chip: ReturnType<typeof createRatingSearchChip>) => void
  onClose?: () => void
  className?: string
  style?: CSSProperties
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

/** Render the shared suggestion panel below the drawer search input. */
function HomeSearchSuggestionPanel({
  searchScope,
  setSearchScope,
  searchInput,
  submitSearchFromInput,
  addSuggestionChip,
  addAIToolChip,
  addRatingChip,
  onClose,
  className,
  style,
}: HomeSearchSuggestionPanelProps) {
  const {
    promptSuggestions,
    filteredRatingTiers,
    modelSuggestions,
    loraSuggestions,
    suggestionsLoading,
    ratingTiersLoading,
    modelSuggestionsLoading,
    loraSuggestionsLoading,
  } = useSearchSuggestionData(searchScope, searchInput)

  return (
    <div className={cn('theme-floating-panel overflow-hidden rounded-sm', className)} style={style}>
      <div className="flex items-center gap-2 border-b border-white/5 px-[var(--theme-panel-padding-x)] py-[calc(var(--theme-panel-padding-y)_-_0.125rem)]">
        <div className="min-w-0 flex-1">
          <SearchScopeTabs searchScope={searchScope} onChange={setSearchScope} />
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

      <div className="max-h-[420px] overflow-y-auto py-2">
        <SearchSuggestionList
          searchScope={searchScope}
          searchInput={searchInput}
          promptSuggestions={promptSuggestions}
          filteredRatingTiers={filteredRatingTiers}
          modelSuggestions={modelSuggestions}
          loraSuggestions={loraSuggestions}
          suggestionsLoading={suggestionsLoading}
          ratingTiersLoading={ratingTiersLoading}
          modelSuggestionsLoading={modelSuggestionsLoading}
          loraSuggestionsLoading={loraSuggestionsLoading}
          onSubmitInput={submitSearchFromInput}
          onSelectSuggestion={(item: PromptCollectionItem) => addSuggestionChip(item.prompt)}
          onSelectMetadataSuggestion={(value: string) => addSuggestionChip(value)}
          onSelectRatingTier={(tier: RatingTierRecord) => addRatingChip(createRatingSearchChip(tier))}
          onSelectAIToolSuggestion={addAIToolChip}
          emptyRatingText="일치하는 평가 티어가 없어."
          idlePromptText="검색어 입력"
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
      {appliedChips.length > 0 ? <span className="rounded-full bg-primary/14 px-2 py-0.5 text-[11px] font-semibold text-primary">{appliedChips.length}</span> : null}
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
    historyEntries,
    historyLoading,
    closeDrawer,
    setSearchInput,
    setSearchScope,
    submitSearchFromInput,
    addSuggestionChip,
    addAIToolChip,
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

  const handleAddSuggestionChip = (value: string) => {
    addSuggestionChip(value)
    setIsSuggestionPanelOpen(false)
  }

  const handleAddAIToolChip = (tool: 'nai' | 'comfyui' | 'other') => {
    addAIToolChip(tool)
    setIsSuggestionPanelOpen(false)
  }

  const handleAddRatingChip = (chip: ReturnType<typeof createRatingSearchChip>) => {
    addRatingChip(chip)
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
                submitSearchFromInput={handleSubmitSearchFromInput}
                addSuggestionChip={handleAddSuggestionChip}
                addAIToolChip={handleAddAIToolChip}
                addRatingChip={handleAddRatingChip}
                onClose={handleCloseSuggestionPanel}
              />
            ) : null}
          </section>

          <section className="space-y-3">
            <SearchChipList chips={draftChips} title="Current filters" emptyMessage="No filters" onCycleOperator={cycleChipOperator} onRemove={removeChip} />

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
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em]" style={getSearchScopeStyle(chip.scope)}>
                              {chip.scopeLabel ?? SEARCH_SCOPE_LABELS[chip.scope]}
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
