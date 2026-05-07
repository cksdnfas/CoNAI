import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { clearSearchHistory, deleteSearchHistory, getSearchHistory, saveSearchHistory } from '@/lib/api-search'
import { SEARCH_SCOPE_LABEL_KEYS } from '@/features/search/search-constants'
import type { SearchAiToolGroup, SearchChip, SearchHistoryEntry, SearchScope } from '@/features/search/search-types'
import { buildSearchChipKey, buildSearchHistoryLabel, createAIToolSearchChip, createTextSearchChip, cycleSearchOperator } from '@/features/search/search-utils'

interface HomeSearchContextValue {
  isDrawerOpen: boolean
  searchScope: SearchScope
  searchInput: string
  draftChips: SearchChip[]
  appliedChips: SearchChip[]
  historyEntries: SearchHistoryEntry[]
  historyLoading: boolean
  openDrawer: () => void
  closeDrawer: () => void
  setSearchScope: (scope: SearchScope) => void
  setSearchInput: (value: string) => void
  addTextChip: () => boolean
  submitSearchFromInput: () => void
  addSuggestionChip: (value: string) => void
  addAIToolChip: (tool: SearchAiToolGroup) => void
  addRatingChip: (chip: SearchChip) => void
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
  const navigate = useNavigate()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [searchScope, setSearchScopeState] = useState<SearchScope>('positive')
  const [searchInput, setSearchInputState] = useState('')
  const [draftChips, setDraftChips] = useState<SearchChip[]>([])
  const [appliedChips, setAppliedChips] = useState<SearchChip[]>([])

  const historyQuery = useQuery({
    queryKey: ['search-history'],
    queryFn: getSearchHistory,
  })

  const saveHistoryMutation = useMutation({
    mutationFn: saveSearchHistory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['search-history'] })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t('homeSearchContext.failedToSaveSearchHistory'), tone: 'error' })
    },
  })

  const deleteHistoryMutation = useMutation({
    mutationFn: deleteSearchHistory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['search-history'] })
      showSnackbar({ message: t('homeSearchContext.searchHistoryEntryDeleted'), tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t('homeSearchContext.failedToDeleteSearchHistory'), tone: 'error' })
    },
  })

  const clearHistoryMutation = useMutation({
    mutationFn: clearSearchHistory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['search-history'] })
      showSnackbar({ message: t('homeSearchContext.searchHistoryCleared'), tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t('homeSearchContext.failedToClearSearchHistory'), tone: 'error' })
    },
  })

  const historyEntries = useMemo(() => historyQuery.data ?? [], [historyQuery.data])

  const openDrawer = useCallback(() => setIsDrawerOpen(true), [])
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), [])

  const setSearchScope = useCallback((scope: SearchScope) => {
    setSearchScopeState(scope)
    openDrawer()
  }, [openDrawer])

  const setSearchInput = useCallback((value: string) => {
    setSearchInputState(value)
    if (!isDrawerOpen) {
      openDrawer()
    }
  }, [isDrawerOpen, openDrawer])

  const appendDraftChip = useCallback((chip: SearchChip) => {
    setDraftChips((current) => {
      const nextKey = buildSearchChipKey(chip)
      if (current.some((item) => buildSearchChipKey(item) === nextKey)) {
        return current
      }
      return [...current, chip]
    })
  }, [])

  const addTextChip = useCallback(() => {
    if (searchScope === 'rating' || searchScope === 'tool') {
      return false
    }

    const chip = createTextSearchChip(searchScope, searchInput)
    if (!chip) {
      return false
    }

    appendDraftChip(chip)
    setSearchInputState('')
    return true
  }, [appendDraftChip, searchInput, searchScope])

  const addSuggestionChip = useCallback((value: string) => {
    if (searchScope === 'rating' || searchScope === 'tool') {
      return
    }

    const chip = createTextSearchChip(searchScope, value)
    if (!chip) {
      return
    }

    appendDraftChip(chip)
    setSearchInputState('')
  }, [appendDraftChip, searchScope])

  const addAIToolChip = useCallback((tool: SearchAiToolGroup) => {
    const chip = createAIToolSearchChip(tool)
    if (!chip) {
      return
    }

    appendDraftChip(chip)
    setSearchInputState('')
  }, [appendDraftChip])

  const addRatingChip = useCallback((chip: SearchChip) => {
    appendDraftChip(chip)
    setSearchInputState('')
  }, [appendDraftChip])

  const withPendingInputChip = useCallback((chips: SearchChip[]) => {
    if (searchScope === 'rating' || searchScope === 'tool') {
      return chips
    }

    const nextChip = createTextSearchChip(searchScope, searchInput)
    if (!nextChip) {
      return chips
    }

    const nextKey = buildSearchChipKey(nextChip)
    if (chips.some((item) => buildSearchChipKey(item) === nextKey)) {
      return chips
    }

    return [...chips, nextChip]
  }, [searchInput, searchScope])

  const applySearch = useCallback(() => {
    const nextChips = withPendingInputChip(draftChips)
    setDraftChips(nextChips)
    setAppliedChips(nextChips)
    setSearchInputState('')

    if (nextChips.length === 0) {
      showSnackbar({ message: t('homeSearchContext.noSearchChipsAreActive'), tone: 'info' })
      return
    }

    navigate('/')

    void saveHistoryMutation.mutateAsync({
      label: buildSearchHistoryLabel(nextChips, {
        resolveScopeLabel: (scope) => t(SEARCH_SCOPE_LABEL_KEYS[scope]),
      }),
      chips: nextChips,
    })
  }, [draftChips, navigate, saveHistoryMutation, showSnackbar, t, withPendingInputChip])

  const submitSearchFromInput = useCallback(() => {
    applySearch()
  }, [applySearch])

  const clearSearch = useCallback(() => {
    setDraftChips([])
    setAppliedChips([])
    setSearchInputState('')
  }, [])

  const selectHistoryEntry = useCallback((entry: SearchHistoryEntry) => {
    setDraftChips(entry.chips)
    setAppliedChips(entry.chips)
    setSearchInputState('')
    openDrawer()
    navigate('/')
    showSnackbar({ message: t('homeSearchContext.savedSearchReapplied'), tone: 'info' })
  }, [navigate, openDrawer, showSnackbar, t])

  const value = useMemo<HomeSearchContextValue>(
    () => ({
      isDrawerOpen,
      searchScope,
      searchInput,
      draftChips,
      appliedChips,
      historyEntries,
      historyLoading: historyQuery.isLoading,
      openDrawer,
      closeDrawer,
      setSearchScope,
      setSearchInput,
      addTextChip,
      submitSearchFromInput,
      addSuggestionChip,
      addAIToolChip,
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
    }),
    [
      addAIToolChip,
      addRatingChip,
      addSuggestionChip,
      addTextChip,
      appliedChips,
      applySearch,
      clearHistoryMutation,
      clearSearch,
      closeDrawer,
      deleteHistoryMutation,
      draftChips,
      historyEntries,
      historyQuery.isLoading,
      isDrawerOpen,
      openDrawer,
      searchInput,
      searchScope,
      selectHistoryEntry,
      setSearchInput,
      setSearchScope,
      submitSearchFromInput,
    ],
  )

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
