import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { clearSearchHistory, deleteSearchHistory, getSearchHistory, saveSearchHistory } from '@/lib/api-search'
import { SEARCH_SCOPE_LABEL_KEYS } from '@/features/search/search-constants'
import type { SearchAiToolGroup, SearchChip, SearchHistoryEntry, SearchOperator, SearchScope } from '@/features/search/search-types'
import { buildSearchChipKey, buildSearchHistoryLabel, createAIToolSearchChip, createTextSearchChip, cycleSearchOperator } from '@/features/search/search-utils'
import { buildHomeSearchString, decodeSearchChipsParam, encodeSearchChipsParam, readSearchChipsParam } from './home-search-url'

export type TextSearchScope = Exclude<SearchScope, 'rating' | 'tool'>
type AddScopedTextChipOptions = { operator?: SearchOperator; apply?: boolean }

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
  addScopedTextChip: (scope: TextSearchScope, value: string, options?: AddScopedTextChipOptions) => boolean
  addSuggestionChip: (value: string) => void
  addAIToolChip: (tool: SearchAiToolGroup) => void
  addRatingChip: (chip: SearchChip) => void
  cycleChipOperator: (chipId: string) => void
  removeChip: (chipId: string) => void
  removeAppliedChip: (chipId: string) => void
  cycleAppliedChipOperator: (chipId: string) => void
  clearAppliedChips: () => void
  applySearch: () => void
  clearSearch: () => void
  selectHistoryEntry: (entry: SearchHistoryEntry) => void
  deleteHistoryEntry: (entryId: string) => Promise<void>
  clearHistoryEntries: () => Promise<void>
}

const HomeSearchContext = createContext<HomeSearchContextValue | null>(null)

function appendUniqueSearchChip(chips: SearchChip[], chip: SearchChip) {
  const nextKey = buildSearchChipKey(chip)
  if (chips.some((item) => buildSearchChipKey(item) === nextKey)) {
    return chips
  }

  return [...chips, chip]
}

/** Provide shared home-search state for the header search box, drawer, and image feed. */
export function HomeSearchProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [searchScope, setSearchScopeState] = useState<SearchScope>('positive')
  const [searchInput, setSearchInputState] = useState('')
  const isHomeRoute = location.pathname === '/'
  const urlSearchQuery = isHomeRoute ? readSearchChipsParam(location.search) : null
  // The Home URL owns the applied search; other pages keep the last one Home showed.
  const [homeSearchQuery, setHomeSearchQuery] = useState(() => urlSearchQuery ?? '')
  const [draftChips, setDraftChips] = useState<SearchChip[]>(() => decodeSearchChipsParam(urlSearchQuery ?? ''))
  if (urlSearchQuery !== null && urlSearchQuery !== homeSearchQuery) {
    setHomeSearchQuery(urlSearchQuery)
    setDraftChips(decodeSearchChipsParam(urlSearchQuery))
  }
  const appliedChips = useMemo(() => decodeSearchChipsParam(homeSearchQuery), [homeSearchQuery])

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
  const saveHistoryEntryMutation = saveHistoryMutation.mutateAsync
  const deleteHistoryEntryMutation = deleteHistoryMutation.mutateAsync
  const clearHistoryEntriesMutation = clearHistoryMutation.mutateAsync

  const openDrawer = useCallback(() => setIsDrawerOpen(true), [])
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), [])

  const setSearchScope = useCallback((scope: SearchScope) => {
    setSearchScopeState(scope)
    setIsDrawerOpen(true)
  }, [])

  const setSearchInput = useCallback((value: string) => {
    setSearchInputState(value)
    setIsDrawerOpen(true)
  }, [])

  const appendDraftChip = useCallback((chip: SearchChip) => {
    setDraftChips((current) => appendUniqueSearchChip(current, chip))
  }, [])

  /** Push the applied search into the Home URL so reload, bookmarks, and Back all see it. */
  const navigateToAppliedChips = useCallback((nextChips: SearchChip[]) => {
    if (nextChips.length === 0 && !isHomeRoute) {
      setHomeSearchQuery('')
      return
    }

    const search = buildHomeSearchString(encodeSearchChipsParam(nextChips))
    navigate({ pathname: '/', search }, { replace: isHomeRoute && location.search === search })
  }, [isHomeRoute, location.search, navigate])

  const commitSearchChips = useCallback((nextChips: SearchChip[]) => {
    setDraftChips(nextChips)
    setSearchInputState('')
    // 동일 칩을 다시 적용하면 쿼리 키가 안 바뀐다.
    // staleTime(30s) 안에서는 네트워크 요청이 아예 안 나가므로 명시적으로 무효화한다.
    void queryClient.invalidateQueries({ queryKey: ['home-images'] })
    navigateToAppliedChips(nextChips)

    if (nextChips.length === 0) {
      showSnackbar({ message: t('homeSearchContext.noSearchChipsAreActive'), tone: 'info' })
      return
    }

    void saveHistoryEntryMutation({
      label: buildSearchHistoryLabel(nextChips, {
        resolveScopeLabel: (scope) => t(SEARCH_SCOPE_LABEL_KEYS[scope]),
      }),
      chips: nextChips,
    })
  }, [navigateToAppliedChips, queryClient, saveHistoryEntryMutation, showSnackbar, t])

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

  const addScopedTextChip = useCallback((scope: TextSearchScope, value: string, options?: AddScopedTextChipOptions) => {
    const chip = createTextSearchChip(scope, value, options?.operator ? { operator: options.operator } : undefined)
    if (!chip) {
      return false
    }

    const nextDraftChips = appendUniqueSearchChip(draftChips, chip)
    setSearchScopeState(scope)

    if (options?.apply) {
      commitSearchChips(nextDraftChips)
      setIsDrawerOpen(false)
      return true
    }

    setDraftChips(nextDraftChips)
    setSearchInputState('')
    setIsDrawerOpen(true)
    return true
  }, [commitSearchChips, draftChips])

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
    commitSearchChips(nextChips)
  }, [commitSearchChips, draftChips, withPendingInputChip])

  const submitSearchFromInput = useCallback(() => {
    applySearch()
  }, [applySearch])

  const clearSearch = useCallback(() => {
    setDraftChips([])
    setSearchInputState('')
    navigateToAppliedChips([])
  }, [navigateToAppliedChips])

  const cycleChipOperator = useCallback((chipId: string) => {
    setDraftChips((current) => current.map((chip) => (chip.id === chipId ? { ...chip, operator: cycleSearchOperator(chip.operator) } : chip)))
  }, [])

  const removeChip = useCallback((chipId: string) => {
    setDraftChips((current) => current.filter((chip) => chip.id !== chipId))
  }, [])

  const removeAppliedChip = useCallback((chipId: string) => {
    navigateToAppliedChips(appliedChips.filter((chip) => chip.id !== chipId))
  }, [appliedChips, navigateToAppliedChips])

  const cycleAppliedChipOperator = useCallback((chipId: string) => {
    navigateToAppliedChips(appliedChips.map((chip) => (chip.id === chipId ? { ...chip, operator: cycleSearchOperator(chip.operator) } : chip)))
  }, [appliedChips, navigateToAppliedChips])

  const clearAppliedChips = useCallback(() => {
    navigateToAppliedChips([])
  }, [navigateToAppliedChips])

  const selectHistoryEntry = useCallback((entry: SearchHistoryEntry) => {
    setDraftChips(entry.chips)
    setSearchInputState('')
    // commitSearchChips 와 같은 이유로, 같은 저장 검색을 다시 고르면 키가 안 바뀐다.
    void queryClient.invalidateQueries({ queryKey: ['home-images'] })
    openDrawer()
    navigateToAppliedChips(entry.chips)
    showSnackbar({ message: t('homeSearchContext.savedSearchReapplied'), tone: 'info' })
  }, [navigateToAppliedChips, openDrawer, queryClient, showSnackbar, t])

  const deleteHistoryEntry = useCallback(async (entryId: string) => {
    await deleteHistoryEntryMutation(entryId)
  }, [deleteHistoryEntryMutation])

  const clearHistoryEntries = useCallback(async () => {
    await clearHistoryEntriesMutation()
  }, [clearHistoryEntriesMutation])

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
      addScopedTextChip,
      addSuggestionChip,
      addAIToolChip,
      addRatingChip,
      cycleChipOperator,
      removeChip,
      removeAppliedChip,
      cycleAppliedChipOperator,
      clearAppliedChips,
      applySearch,
      clearSearch,
      selectHistoryEntry,
      deleteHistoryEntry,
      clearHistoryEntries,
    }),
    [
      addAIToolChip,
      addRatingChip,
      addScopedTextChip,
      addSuggestionChip,
      addTextChip,
      appliedChips,
      applySearch,
      clearAppliedChips,
      clearHistoryEntries,
      clearSearch,
      closeDrawer,
      cycleAppliedChipOperator,
      cycleChipOperator,
      deleteHistoryEntry,
      draftChips,
      historyEntries,
      historyQuery.isLoading,
      isDrawerOpen,
      openDrawer,
      removeAppliedChip,
      removeChip,
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
