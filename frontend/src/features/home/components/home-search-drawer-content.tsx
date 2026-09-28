import { useConfirm } from '@/components/ui/confirm-dialog'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { RotateCcw, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Heading } from '@/components/ui/heading'
import { IconButton } from '@/components/ui/icon-button'
import { Panel } from '@/components/ui/panel'
import { Text } from '@/components/ui/text'
import { BottomDrawerNotice } from '@/components/ui/bottom-drawer-sheet'
import { SearchChipList } from '@/features/search/components/search-chip-list'
import { SearchScopeTabs } from '@/features/search/components/search-scope-tabs'
import { SearchSuggestionList } from '@/features/search/components/search-suggestion-list'
import { SEARCH_OPERATOR_DESCRIPTIONS, SEARCH_OPERATOR_LABELS, SEARCH_SCOPE_LABEL_KEYS } from '@/features/search/search-constants'
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
    <div className={cn('theme-floating-panel overflow-hidden rounded-sm bg-background/95', className)} style={style}>
      <div className="flex items-center gap-2 px-[var(--theme-panel-padding-x)] py-[calc(var(--theme-panel-padding-y)_-_0.125rem)]">
        <div className="min-w-0 flex-1">
          <SearchScopeTabs searchScope={searchScope} onChange={setSearchScope} />
        </div>

        {onClose ? (
          <IconButton size="icon-sm" variant="ghost" onClick={onClose} label={t('homeSearchDrawerContent.closeInputFilter')}>
            <X className="h-4 w-4" />
          </IconButton>
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
  const confirm = useConfirm()

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
    : t({ ko: '라이브러리 검색…', en: 'Search library…' })

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
          'fixed inset-x-0 bottom-0 top-[var(--theme-shell-header-height)] z-40 bg-backdrop/50 transition-opacity',
          isDrawerOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={closeDrawer}
      />

      <aside
        className={cn(
          'theme-floating-panel fixed bottom-0 right-0 top-[var(--theme-shell-header-height)] z-40 flex h-[calc(100vh-var(--theme-shell-header-height))] max-w-full flex-col bg-background/94 transition-transform duration-300',
          isDrawerOpen ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ width: 'min(calc(100vw - 0.75rem), 420px)' }}
      >
        <div className="theme-drawer-header flex items-center justify-between">
          <Heading level={2}>{t({ ko: '라이브러리 검색', en: 'Search library' })}</Heading>
          <IconButton variant="ghost" onClick={closeDrawer} label={t('homeSearchDrawerContent.closeSearchDrawer')} tooltipSide="left">
            <X className="h-5 w-5" />
          </IconButton>
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
            <SearchChipList chips={draftChips} title={null} emptyMessage={t({ ko: '필터 없음', en: 'No filters' })} onCycleOperator={cycleChipOperator} onRemove={removeChip} />

            <div className="flex gap-2">
              <Button type="button" className="flex-1" onClick={handleApplySearch}>
                {t({ ko: '검색', en: 'Search' })}
              </Button>
              <IconButton variant="secondary" onClick={handleClearSearch} label={t({ ko: '초기화', en: 'Reset' })}>
                <RotateCcw className="size-4" />
              </IconButton>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Text as="div" variant="overline" className="min-w-0 flex-1 font-semibold">{t({ ko: '최근 검색', en: 'Recent searches' })}</Text>
              <div className="flex shrink-0 items-center gap-2">
                <IconButton
                  variant="ghost"
                  size="icon-sm"
                  label={t({ ko: '히스토리 비우기', en: 'Clear history' })}
                  onClick={async () => {
                    const confirmed = await confirm({
                      title: t({ ko: '최근 검색 비우기', en: 'Clear recent searches' }),
                      description: t({ ko: '최근 검색 기록을 모두 지울까?', en: 'Clear all recent searches?' }),
                      confirmLabel: t({ ko: '비우기', en: 'Clear' }),
                      tone: 'destructive',
                    })
                    if (confirmed) {
                      void clearHistoryEntries()
                    }
                  }}
                  disabled={historyEntries.length === 0}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            </div>

            {historyLoading ? <BottomDrawerNotice>{t({ ko: '불러오는 중…', en: 'Loading…' })}</BottomDrawerNotice> : null}
            {!historyLoading && historyEntries.length === 0 ? <BottomDrawerNotice>{t({ ko: '히스토리 없음', en: 'No history' })}</BottomDrawerNotice> : null}
            {!historyLoading && historyEntries.length > 0 ? (
              <div className="space-y-2">
                {historyEntries.map((entry) => (
                  // The whole entry is the hit target (Panel interactive); the delete key floats in its top-right corner.
                  <div key={entry.id} className="relative">
                    <Panel asChild padding="none" interactive className="block w-full py-3 pr-12 pl-4 text-left">
                      <button
                        type="button"
                        onClick={() => {
                          selectHistoryEntry(entry)
                          setIsSuggestionPanelOpen(false)
                          closeDrawer()
                        }}
                      >
                        <div className="flex flex-wrap gap-2">
                          {entry.chips.map((chip) => (
                            <Chip key={chip.id}>
                              <span className="rounded-sm px-1.5 py-0.5 text-2xs font-semibold" style={getSearchScopeStyle(chip.scope)}>
                                {t(SEARCH_SCOPE_LABEL_KEYS[chip.scope])}
                              </span>
                              <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-2xs font-bold text-primary" title={t(SEARCH_OPERATOR_DESCRIPTIONS[chip.operator])}>
                                {t(SEARCH_OPERATOR_LABELS[chip.operator])}
                              </span>
                              <span className="truncate" style={chip.color ? { color: chip.color } : undefined}>
                                {chip.label}
                              </span>
                            </Chip>
                          ))}
                        </div>
                      </button>
                    </Panel>
                    <IconButton size="icon-xs" variant="ghost" className="absolute top-3 right-3" onClick={() => void deleteHistoryEntry(entry.id)} label={t('homeSearchDrawerContent.deleteSearchHistory')}>
                      <X className="h-4 w-4" />
                    </IconButton>
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
