import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { clearSearchHistory, deleteSearchHistory, getRatingTiers, getSearchHistory, saveSearchHistory, searchPromptCollection } from '@/lib/api'
import type { PromptCollectionItem } from '@/types/prompt'
import type { RatingTierRecord, SearchChip, SearchHistoryEntry, SearchScope } from './search-types'
import { buildSearchChipKey, buildSearchChipLabel, buildSearchHistoryLabel, createSearchChipId, cycleSearchOperator } from './search-utils'

interface HomeSearchContextValue {
  isDrawerOpen: boolean
  searchScope: SearchScope
  searchInput: string
  draftChips: SearchChip[]
  appliedChips: SearchChip[]
  promptSuggestions: PromptCollectionItem[]
  filteredRatingTiers: RatingTierRecord[]
  historyEntries: SearchHistoryEntry[]
  suggestionsLoading: boolean
  historyLoading: boolean
  ratingTiersLoading: boolean
  openDrawer: () => void
  closeDrawer: () => void
  setSearchScope: (scope: SearchScope) => void
  setSearchInput: (value: string) => void
  addTextChip: () => boolean
  submitSearchFromInput: () => void
  addSuggestionChip: (item: PromptCollectionItem) => void
  addRatingChip: (tier: RatingTierRecord) => void
  cycleChipOperator: (chipId: string) => void
  removeChip: (chipId: string) => void
  applySearch: () => void
  clearSearch: () => void
  selectHistoryEntry: (entry: SearchHistoryEntry) => void
  deleteHistoryEntry: (entryId: string) => Promise<void>
  clearHistoryEntries: () => Promise<void>
}

const HomeSearchContext = createContext<HomeSearchContextValue | null>(null)

/** Provide shared home-search state for the header search box, drawer, and image feed. */
export function HomeSearchProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [searchScope, setSearchScopeState] = useState<SearchScope>('positive')
  const [searchInput, setSearchInputState] = useState('')
  const [draftChips, setDraftChips] = useState<SearchChip[]>([])
  const [appliedChips, setAppliedChips] = useState<SearchChip[]>([])

  const historyQuery = useQuery({
    queryKey: ['search-history'],
    queryFn: getSearchHistory,
  })

  const ratingTiersQuery = useQuery({
    queryKey: ['rating-tiers'],
    queryFn: getRatingTiers,
  })

  const promptSuggestionsQuery = useQuery({
    queryKey: ['home-search-suggestions', searchScope, searchInput],
    queryFn: () =>
      searchPromptCollection({
        query: searchInput,
        type: searchScope === 'rating' ? 'positive' : searchScope,
        page: 1,
        limit: 16,
        sortBy: 'usage_count',
        sortOrder: 'DESC',
      }),
    enabled: searchScope !== 'rating' && searchInput.trim().length > 0,
  })

  const saveHistoryMutation = useMutation({
    mutationFn: saveSearchHistory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['search-history'] })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '검색 히스토리를 저장하지 못했어.', tone: 'error' })
    },
  })

  const deleteHistoryMutation = useMutation({
    mutationFn: deleteSearchHistory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['search-history'] })
      showSnackbar({ message: '검색 히스토리를 삭제했어.', tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '검색 히스토리 삭제에 실패했어.', tone: 'error' })
    },
  })

  const clearHistoryMutation = useMutation({
    mutationFn: clearSearchHistory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['search-history'] })
      showSnackbar({ message: '검색 히스토리를 비웠어.', tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '검색 히스토리를 비우지 못했어.', tone: 'error' })
    },
  })

  const ratingTiers = ratingTiersQuery.data ?? []
  const historyEntries = historyQuery.data ?? []
  const promptSuggestions = promptSuggestionsQuery.data?.items ?? []

  const filteredRatingTiers = useMemo(() => ratingTiers, [ratingTiers])

  const openDrawer = () => setIsDrawerOpen(true)
  const closeDrawer = () => setIsDrawerOpen(false)

  const setSearchScope = (scope: SearchScope) => {
    setSearchScopeState(scope)
    openDrawer()
  }

  const setSearchInput = (value: string) => {
    setSearchInputState(value)
    if (!isDrawerOpen) {
      openDrawer()
    }
  }

  const appendDraftChip = (chip: SearchChip) => {
    setDraftChips((current) => {
      const nextKey = buildSearchChipKey(chip)
      if (current.some((item) => buildSearchChipKey(item) === nextKey)) {
        return current
      }
      return [...current, chip]
    })
  }

  const createTextChip = (scope: Exclude<SearchScope, 'rating'>, value: string): SearchChip | null => {
    const trimmedValue = value.trim()
    if (!trimmedValue) {
      return null
    }

    return {
      id: createSearchChipId(scope),
      scope,
      operator: 'OR',
      label: buildSearchChipLabel(scope, trimmedValue),
      value: trimmedValue,
    }
  }

  const createRatingChip = (tier: RatingTierRecord): SearchChip => ({
    id: createSearchChipId('rating'),
    scope: 'rating',
    operator: 'OR',
    label: tier.tier_name,
    value: tier.tier_name,
    minScore: tier.min_score,
    maxScore: tier.max_score,
    color: tier.color ?? null,
  })

  const addTextChip = () => {
    if (searchScope === 'rating') {
      return false
    }

    const chip = createTextChip(searchScope, searchInput)
    if (!chip) {
      return false
    }

    appendDraftChip(chip)
    setSearchInputState('')
    return true
  }

  const addSuggestionChip = (item: PromptCollectionItem) => {
    if (searchScope === 'rating') {
      return
    }

    const chip = createTextChip(searchScope, item.prompt)
    if (!chip) {
      return
    }

    appendDraftChip(chip)
    setSearchInputState('')
  }

  const addRatingChip = (tier: RatingTierRecord) => {
    appendDraftChip(createRatingChip(tier))
    setSearchInputState('')
  }

  const withPendingInputChip = (chips: SearchChip[]) => {
    if (searchScope === 'rating') {
      return chips
    }

    const nextChip = createTextChip(searchScope, searchInput)
    if (!nextChip) {
      return chips
    }

    const nextKey = buildSearchChipKey(nextChip)
    if (chips.some((item) => buildSearchChipKey(item) === nextKey)) {
      return chips
    }

    return [...chips, nextChip]
  }

  const applySearch = () => {
    const nextChips = withPendingInputChip(draftChips)
    setDraftChips(nextChips)
    setAppliedChips(nextChips)
    setSearchInputState('')

    if (nextChips.length === 0) {
      showSnackbar({ message: '검색 칩이 없어서 기본 갤러리 상태야.', tone: 'info' })
      return
    }

    void saveHistoryMutation.mutateAsync({
      label: buildSearchHistoryLabel(nextChips),
      chips: nextChips,
    })
  }

  const submitSearchFromInput = () => {
    if (searchScope === 'rating') {
      if (filteredRatingTiers.length === 1) {
        addRatingChip(filteredRatingTiers[0])
        setTimeout(() => applySearch(), 0)
      }
      return
    }

    applySearch()
  }

  const clearSearch = () => {
    setDraftChips([])
    setAppliedChips([])
    setSearchInputState('')
  }

  const selectHistoryEntry = (entry: SearchHistoryEntry) => {
    setDraftChips(entry.chips)
    setAppliedChips(entry.chips)
    setSearchInputState('')
    openDrawer()
    showSnackbar({ message: '저장된 검색을 다시 적용했어.', tone: 'info' })
  }

  const value = useMemo<HomeSearchContextValue>(() => ({
    isDrawerOpen,
    searchScope,
    searchInput,
    draftChips,
    appliedChips,
    promptSuggestions,
    filteredRatingTiers,
    historyEntries,
    suggestionsLoading: promptSuggestionsQuery.isLoading,
    historyLoading: historyQuery.isLoading,
    ratingTiersLoading: ratingTiersQuery.isLoading,
    openDrawer,
    closeDrawer,
    setSearchScope,
    setSearchInput,
    addTextChip,
    submitSearchFromInput,
    addSuggestionChip,
    addRatingChip,
    cycleChipOperator: (chipId: string) => {
      setDraftChips((current) => current.map((chip) => (chip.id === chipId ? { ...chip, operator: cycleSearchOperator(chip.operator) } : chip)))
    },
    removeChip: (chipId: string) => {
      setDraftChips((current) => current.filter((chip) => chip.id !== chipId))
    },
    applySearch,
    clearSearch,
    selectHistoryEntry,
    deleteHistoryEntry: async (entryId: string) => {
      await deleteHistoryMutation.mutateAsync(entryId)
    },
    clearHistoryEntries: async () => {
      await clearHistoryMutation.mutateAsync()
    },
  }), [
    appliedChips,
    draftChips,
    filteredRatingTiers,
    historyEntries,
    historyQuery.isLoading,
    isDrawerOpen,
    promptSuggestions,
    promptSuggestionsQuery.isLoading,
    ratingTiersQuery.isLoading,
    searchInput,
    searchScope,
  ])

  return <HomeSearchContext.Provider value={value}>{children}</HomeSearchContext.Provider>
}

/** Read the shared home-search context used by the gallery header and drawer. */
export function useHomeSearch() {
  const context = useContext(HomeSearchContext)
  if (!context) {
    throw new Error('useHomeSearch must be used within HomeSearchProvider')
  }
  return context
}
