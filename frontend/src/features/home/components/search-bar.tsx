import { useCallback, useEffect, useState } from 'react'
import { FolderPlus, History, Search, Shuffle, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ComplexFilter, ComplexSearchRequest, FilterCondition } from '@comfyui-image-manager/shared'
import SimpleSearchTab, { type SearchToken } from '@/features/image-groups/components/simple-search-tab'
import type { PromptSearchResult } from '@/features/image-groups/components/search-auto-complete'
import GroupCreateEditModal from '@/features/image-groups/components/group-create-edit-modal'
import { useSearchHistory, type SearchHistoryItem } from '@/hooks/use-search-history'
import { apiClient } from '@/lib/api/client'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface SearchBarProps {
  onSearch: (request: ComplexSearchRequest, options?: { shuffle?: boolean }) => void
  loading?: boolean
}

interface PromptSearchApiResponse {
  success: boolean
  data?: Array<{ prompt: string; usage_count: number }>
}

const SearchBar: React.FC<SearchBarProps> = ({ onSearch, loading = false }) => {
  const { t } = useTranslation(['search'])
  const { history, addHistoryItem, removeHistoryItem, clearHistory } = useSearchHistory()

  const [simpleSearchText, setSimpleSearchText] = useState(() => {
    try {
      return sessionStorage.getItem('search_simpleSearchText') || ''
    } catch {
      return ''
    }
  })

  const [searchTokens, setSearchTokens] = useState<SearchToken[]>(() => {
    try {
      const saved = sessionStorage.getItem('search_searchTokens')
      return saved ? (JSON.parse(saved) as SearchToken[]) : []
    } catch {
      return []
    }
  })

  const [validationError, setValidationError] = useState<string | null>(null)
  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [groupInitialConditions, setGroupInitialConditions] = useState<ComplexFilter | undefined>(undefined)
  const [isShuffle, setIsShuffle] = useState(false)

  useEffect(() => {
    try {
      sessionStorage.setItem('search_simpleSearchText', simpleSearchText)
      sessionStorage.setItem('search_searchTokens', JSON.stringify(searchTokens))
    } catch (error) {
      console.error('Failed to save search state into sessionStorage', error)
    }
  }, [simpleSearchText, searchTokens])

  const handleAddToken = useCallback((tag: PromptSearchResult) => {
    setSearchTokens((previous) => {
      if (previous.some((token) => token.value === tag.prompt && token.type === tag.type)) {
        return previous
      }

      const newToken: SearchToken = {
        id: `${Date.now()}-${Math.random()}`,
        type: tag.type,
        label: tag.prompt,
        value: tag.prompt,
        logic: 'AND',
        count: tag.usage_count,
        minScore: tag.min_score,
        maxScore: tag.max_score,
        color: tag.color,
      }

      return [...previous, newToken]
    })
    setSimpleSearchText('')
  }, [])

  useEffect(() => {
    const handleAddTagEvent = (event: Event) => {
      const customEvent = event as CustomEvent<PromptSearchResult>
      const tag = customEvent.detail
      if (tag) {
        handleAddToken(tag)
      }
    }

    window.addEventListener('add-search-tag', handleAddTagEvent)
    return () => window.removeEventListener('add-search-tag', handleAddTagEvent)
  }, [handleAddToken])

  const handleRemoveToken = (id: string) => {
    setSearchTokens((previous) => previous.filter((token) => token.id !== id))
  }

  const handleCycleLogic = (id: string) => {
    setSearchTokens((previous) =>
      previous.map((token) => {
        if (token.id !== id) return token

        const mapping: Record<SearchToken['logic'], SearchToken['logic']> = {
          AND: 'OR',
          OR: 'NOT',
          NOT: 'AND',
        }

        return { ...token, logic: mapping[token.logic] }
      }),
    )
  }

  const handleUpdateToken = (id: string, updates: Partial<SearchToken>) => {
    setSearchTokens((previous) => previous.map((token) => (token.id === id ? { ...token, ...updates } : token)))

    if (updates.type && updates.type !== 'rating') {
      const token = searchTokens.find((entry) => entry.id === id)
      if (!token) return

      const nextType = updates.type
      const query = token.value

      const updateCount = async () => {
        try {
          const response = await apiClient.get<PromptSearchApiResponse>('/api/prompt-collection/search', {
            params: {
              q: query,
              type: nextType,
              page: 1,
              limit: 10,
            },
          })

          if (!response.data.success || !Array.isArray(response.data.data)) return

          const match = response.data.data.find((item) => item.prompt === query)
          if (!match) return

          setSearchTokens((previous) => previous.map((entry) => (entry.id === id ? { ...entry, count: match.usage_count } : entry)))
        } catch (error) {
          console.error('Failed to fetch stats for updated token:', error)
        }
      }

      void updateCount()
    }
  }

  const buildComplexFilter = (text: string, tokens: SearchToken[]): ComplexFilter | null => {
    const excludeGroup: FilterCondition[] = []
    const orGroup: FilterCondition[] = []
    const andGroup: FilterCondition[] = []

    const tokensToProcess = [...tokens]
    if (text.trim()) {
      tokensToProcess.push({
        id: 'temp',
        type: 'positive',
        label: text.trim(),
        value: text.trim(),
        logic: 'OR',
      })
    }

    if (tokensToProcess.length === 0) {
      return null
    }

    tokensToProcess.forEach((token) => {
      let category: FilterCondition['category'] = 'positive_prompt'
      let type: FilterCondition['type'] = 'prompt_contains'

      if (token.type === 'auto') {
        type = 'auto_tag_any'
        category = 'auto_tag'
      } else if (token.type === 'negative') {
        type = 'negative_prompt_contains'
        category = 'negative_prompt'
      } else if (token.type === 'rating') {
        type = 'auto_tag_rating_score'
        category = 'auto_tag'
      }

      const condition: FilterCondition = {
        category,
        type,
        value: token.value,
        ...((token.type === 'auto' || token.type === 'rating') && {
          min_score: token.minScore ?? 0,
          max_score: token.maxScore ?? (token.type === 'rating' ? undefined : 1),
        }),
      }

      if (token.logic === 'OR') orGroup.push(condition)
      else if (token.logic === 'AND') andGroup.push(condition)
      else if (token.logic === 'NOT') excludeGroup.push(condition)
    })

    return {
      exclude_group: excludeGroup.length > 0 ? excludeGroup : undefined,
      or_group: orGroup.length > 0 ? orGroup : undefined,
      and_group: andGroup.length > 0 ? andGroup : undefined,
    }
  }

  const performSearch = (text: string, tokens: SearchToken[]) => {
    setValidationError(null)
    addHistoryItem(text, tokens)

    const complexFilter = buildComplexFilter(text, tokens)
    if (!complexFilter) {
      onSearch({ page: 1, limit: 25 }, { shuffle: isShuffle })
      return
    }

    onSearch(
      {
        complex_filter: complexFilter,
        page: 1,
        limit: 25,
      },
      { shuffle: isShuffle },
    )
  }

  const handleCreateGroupWithFilter = () => {
    const complexFilter = buildComplexFilter(simpleSearchText, searchTokens)
    if (!complexFilter) return

    setGroupInitialConditions(complexFilter)
    setGroupModalOpen(true)
  }

  const handleSearch = () => {
    performSearch(simpleSearchText, searchTokens)
  }

  const handleClearSearch = () => {
    setSimpleSearchText('')
    setSearchTokens([])
    sessionStorage.removeItem('search_simpleSearchText')
    sessionStorage.removeItem('search_searchTokens')
    setIsShuffle(false)
  }

  const handleRestoreHistory = (item: SearchHistoryItem) => {
    try {
      sessionStorage.setItem('search_simpleSearchText', item.text)
      sessionStorage.setItem('search_searchTokens', JSON.stringify(item.tokens))
    } catch (error) {
      console.error('Failed to save search state to sessionStorage during restore', error)
    }

    setSimpleSearchText(item.text)
    setSearchTokens(item.tokens)
    performSearch(item.text, item.tokens)
  }

  const hasConditions = simpleSearchText.trim().length > 0 || searchTokens.length > 0

  return (
    <div className="w-full">
      {validationError ? <Alert>{validationError}</Alert> : null}

      <SimpleSearchTab
        searchText={simpleSearchText}
        onSearchTextChange={setSimpleSearchText}
        onSearch={handleSearch}
        tokens={searchTokens}
        onAddToken={handleAddToken}
        onRemoveToken={handleRemoveToken}
        onCycleLogic={handleCycleLogic}
        onUpdateToken={handleUpdateToken}
      />

      <div className="mt-3 space-y-2">
        <div className="flex w-full gap-2">
          <Button type="button" className="flex-1" onClick={handleSearch} disabled={loading}>
            <Search className="h-4 w-4" />
            {loading ? t('search:searchBar.buttons.searching') : t('search:searchBar.buttons.search')}
          </Button>

          <Button
            type="button"
            variant={isShuffle ? 'default' : 'outline'}
            size="icon"
            onClick={() => setIsShuffle((previous) => !previous)}
            disabled={loading}
            title={t('search:searchBar.tooltips.shuffle', 'Shuffle Results')}
          >
            <Shuffle className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleClearSearch}
            disabled={loading || !hasConditions}
            title={t('search:searchBar.buttons.reset')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleCreateGroupWithFilter}
          disabled={loading || !hasConditions}
        >
          <FolderPlus className="h-4 w-4" />
          {t('search:searchBar.buttons.createGroupWithFilter')}
        </Button>
      </div>

      {history.length > 0 ? (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <History className="h-4 w-4" />
              {t('search:history.title', 'Recent Searches')}
            </p>
            <Button variant="ghost" size="xs" onClick={clearHistory}>
              {t('search:history.clear', 'Clear History')}
            </Button>
          </div>

          <div className="space-y-1">
            {history.map((item) => (
              <button
                key={item.id}
                type="button"
                className="hover:bg-muted/50 w-full rounded-md border p-2 text-left"
                onClick={() => handleRestoreHistory(item)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-1 flex-wrap items-center gap-1 overflow-hidden">
                    {item.text ? <p className="text-sm font-medium">{item.text}</p> : null}
                    {item.tokens.map((token) => (
                      <Badge key={token.id} variant="outline" className="text-[10px]">{token.label}</Badge>
                    ))}
                    {item.tokens.length === 0 && !item.text ? (
                      <span className="text-xs text-muted-foreground">{t('search:history.empty', 'Empty Search')}</span>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={(event) => {
                      event.stopPropagation()
                      removeHistoryItem(item.id)
                    }}
                    title={t('search:history.remove', 'Remove')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </button>
            ))}
          </div>

          <GroupCreateEditModal
            open={groupModalOpen}
            onClose={() => setGroupModalOpen(false)}
            onSuccess={() => setGroupModalOpen(false)}
            initialAutoCollectConditions={groupInitialConditions}
          />
        </div>
      ) : null}
    </div>
  )
}

export default SearchBar
