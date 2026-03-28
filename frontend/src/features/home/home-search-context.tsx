import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { clearSearchHistory, deleteSearchHistory, getSearchHistory, saveSearchHistory } from '@/lib/api'
import type { SearchChip, SearchHistoryEntry, SearchScope } from '@/features/search/search-types'
import { buildSearchChipKey, buildSearchHistoryLabel, createTextSearchChip, cycleSearchOperator } from '@/features/search/search-utils'

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

  const historyEntries = historyQuery.data ?? []

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

  const addTextChip = () => {
    if (searchScope === 'rating') {
      return false
    }

    const chip = createTextSearchChip(searchScope, searchInput)
    if (!chip) {
      return false
    }

    appendDraftChip(chip)
    setSearchInputState('')
    return true
  }

  const addSuggestionChip = (value: string) => {
    if (searchScope === 'rating') {
      return
    }

    const chip = createTextSearchChip(searchScope, value)
    if (!chip) {
      return
    }

    appendDraftChip(chip)
    setSearchInputState('')
  }

  const addRatingChip = (chip: SearchChip) => {
    appendDraftChip(chip)
    setSearchInputState('')
  }

  const withPendingInputChip = (chips: SearchChip[]) => {
    if (searchScope === 'rating') {
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

    navigate('/')

    void saveHistoryMutation.mutateAsync({
      label: buildSearchHistoryLabel(nextChips),
      chips: nextChips,
    })
  }

  const submitSearchFromInput = () => {
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
    navigate('/')
    showSnackbar({ message: '저장된 검색을 다시 적용했어.', tone: 'info' })
  }

  const value = useMemo<HomeSearchContextValue>(() => ({
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
    historyEntries,
    historyQuery.isLoading,
    isDrawerOpen,
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
