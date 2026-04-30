import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BottomDrawerNotice } from '@/components/ui/bottom-drawer-sheet'
import { SearchChipList } from '@/features/search/components/search-chip-list'
import { SearchScopeTabs } from '@/features/search/components/search-scope-tabs'
import { SearchSuggestionList } from '@/features/search/components/search-suggestion-list'
import { SEARCH_SCOPE_LABEL_KEYS } from '@/features/search/search-constants'
import { createRatingSearchChip, getSearchScopeStyle } from '@/features/search/search-utils'
import type { RatingTierRecord } from '@/features/search/search-types'
import { useSearchSuggestionData } from '@/features/search/use-search-suggestion-data'
import { useHomeSearch } from '@/features/home/home-search-context'
import { useI18n } from '@/i18n'
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
      className="theme-settings-control theme-input-surface flex items-center rounded-sm border text-sm text-foreground transition focus-within:border-primary focus-within:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_35%,transparent)]"
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
  const { t } = useI18n()

  return (
    <div className={cn('theme-floating-panel overflow-hidden rounded-sm border border-border/80 bg-background/95 shadow-[0_18px_40px_rgba(0,0,0,0.24)]', className)} style={style}>
      <div className="flex items-center gap-2 border-b border-border/70 px-[var(--theme-panel-padding-x)] py-[calc(var(--theme-panel-padding-y)_-_0.125rem)]">
        <div className="min-w-0 flex-1">
          <SearchScopeTabs searchScope={searchScope} onChange={setSearchScope} />
        </div>

        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-2 text-muted-foreground transition hover:bg-surface-high hover:text-foreground"
            aria-label={t('homeSearchDrawerContent.closeInputFilter')}
            title={t('homeSearchDrawerContent.closeInputFilter')}
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
          emptyRatingText={t('homeSearchDrawerContent.noMatchingRatingTiers')}
          idlePromptText={t('homeSearchDrawerContent.enterSearchTerms')}
        />
      </div>
    </div>
  )
}

/** Render the full search drawer body only after the drawer path has been requested. */
export function HomeSearchDrawerContent({ active }: { active: boolean }) {
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
  const { t, formatNumber } = useI18n()

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

  const activeCountLabel = appliedChips.length > 0
    ? t({ ko: '{count}개 필터', en: '{count} filters' }, { count: formatNumber(appliedChips.length) })
    : t({ ko: '갤러리 검색…', en: 'Search gallery…' })

  const handleOpenSuggestionPanel = () => {
    setIsSuggestionPanelOpen(true)
  }

  const handleCloseSuggestionPanel = () => {
    setIsSuggestionPanelOpen(false)
  }

  const handleSubmitSearchFromInput = () => {
    submitSearchFromInput()
    setIsSuggestionPanelOpen(false)
    closeDrawer()
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
    closeDrawer()
  }

  const handleClearSearch = () => {
    clearSearch()
    setIsSuggestionPanelOpen(false)
    closeDrawer()
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
          'theme-floating-panel fixed bottom-0 right-0 top-[var(--theme-shell-header-height)] z-40 flex h-[calc(100vh-var(--theme-shell-header-height))] max-w-full flex-col border-l border-border/80 bg-background/94 transition-transform duration-300',
          isDrawerOpen ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ width: 'min(calc(100vw - 0.75rem), 420px)' }}
      >
        <div className="theme-drawer-header flex items-center justify-between border-b border-border/80 bg-background/40">
          <div className="text-2xl font-semibold tracking-tight text-foreground">{t({ ko: '검색', en: 'Search' })}</div>
          <button type="button" onClick={closeDrawer} className="rounded-sm p-2 text-muted-foreground transition hover:bg-surface-high hover:text-foreground" aria-label={t('homeSearchDrawerContent.closeSearchDrawer')}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="theme-drawer-body flex-1 space-y-4 overflow-y-auto">
          <section ref={searchSectionRef} className="space-y-3">
            <HomeSearchInputBox
              searchInput={searchInput}
              setSearchInput={setSearchInput}
              submitSearchFromInput={handleSubmitSearchFromInput}
              placeholder={activeCountLabel}
              ariaLabel={t('homeSearchDrawerContent.drawerSearchInput')}
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
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t({ ko: '현재 필터', en: 'Current filters' })}</div>
            </div>

            <SearchChipList chips={draftChips} title={null} emptyMessage={t({ ko: '필터 없음', en: 'No filters' })} onCycleOperator={cycleChipOperator} onRemove={removeChip} />

            <div className="flex gap-2">
              <Button type="button" className="flex-1" onClick={handleApplySearch}>
                {t({ ko: '검색', en: 'Search' })}
              </Button>
              <Button type="button" variant="outline" className="flex-1" onClick={handleClearSearch}>
                {t({ ko: '초기화', en: 'Reset' })}
              </Button>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t({ ko: '최근 검색', en: 'Recent searches' })}</div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => void clearHistoryEntries()} className="text-xs text-muted-foreground transition hover:text-foreground">
                  {t({ ko: '히스토리 비우기', en: 'Clear history' })}
                </button>
              </div>
            </div>

            {historyLoading ? <BottomDrawerNotice>{t({ ko: '불러오는 중…', en: 'Loading…' })}</BottomDrawerNotice> : null}
            {!historyLoading && historyEntries.length === 0 ? <BottomDrawerNotice>{t({ ko: '히스토리 없음', en: 'No history' })}</BottomDrawerNotice> : null}
            {!historyLoading && historyEntries.length > 0 ? (
              <div className="space-y-2">
                {historyEntries.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3 rounded-sm border border-border/70 bg-background/45 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        selectHistoryEntry(entry)
                        setIsSuggestionPanelOpen(false)
                        closeDrawer()
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex flex-wrap gap-2">
                        {entry.chips.map((chip) => (
                          <span key={chip.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1.5 text-xs text-foreground">
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em]" style={getSearchScopeStyle(chip.scope)}>
                              {t(SEARCH_SCOPE_LABEL_KEYS[chip.scope])}
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
                    <button type="button" onClick={() => void deleteHistoryEntry(entry.id)} className="mt-1 text-muted-foreground transition hover:text-foreground" aria-label={t('homeSearchDrawerContent.deleteSearchHistory')}>
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
