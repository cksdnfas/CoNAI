import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, Chip, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material'
import { FolderPlus, History, Search, Shuffle, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ComplexFilter, ComplexSearchRequest, FilterCondition } from '@comfyui-image-manager/shared'
import SimpleSearchTab, { type SearchToken } from '@/features/image-groups/components/simple-search-tab'
import type { PromptSearchResult } from '@/features/image-groups/components/search-auto-complete'
import GroupCreateEditModal from '@/features/image-groups/components/group-create-edit-modal'
import { useSearchHistory, type SearchHistoryItem } from '@/hooks/use-search-history'
import { apiClient } from '@/lib/api/client'

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
    <Box sx={{ width: '100%' }}>
      {validationError ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setValidationError(null)}>
          {validationError}
        </Alert>
      ) : null}

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

      <Stack direction="column" spacing={1} sx={{ mt: 3 }}>
        <Stack direction="row" spacing={1} sx={{ width: '100%' }}>
          <Button
            variant="contained"
            size="medium"
            startIcon={<Search className="h-4 w-4" />}
            onClick={handleSearch}
            disabled={loading}
            sx={{ py: 1, flex: 1 }}
          >
            {loading ? t('search:searchBar.buttons.searching') : t('search:searchBar.buttons.search')}
          </Button>

          <Tooltip title={t('search:searchBar.tooltips.shuffle', 'Shuffle Results')} arrow>
            <IconButton
              onClick={() => setIsShuffle((previous) => !previous)}
              disabled={loading}
              color={isShuffle ? 'primary' : 'default'}
              sx={{
                border: '1px solid',
                borderColor: isShuffle ? 'primary.main' : 'divider',
                bgcolor: isShuffle ? 'rgba(var(--mui-palette-primary-mainChannel) / 0.1)' : 'transparent',
                '&:hover': {
                  backgroundColor: isShuffle ? 'rgba(var(--mui-palette-primary-mainChannel) / 0.2)' : 'action.hover',
                  borderColor: isShuffle ? 'primary.dark' : 'text.secondary',
                },
                height: 'auto',
                borderRadius: 2,
                aspectRatio: '1/1',
                p: 1.25,
              }}
            >
              <Shuffle className="h-4 w-4" />
            </IconButton>
          </Tooltip>

          <Tooltip title={t('search:searchBar.buttons.reset')} arrow>
            <span>
              <IconButton
                onClick={handleClearSearch}
                disabled={loading || !hasConditions}
                color="default"
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  '&:hover': {
                    backgroundColor: 'action.hover',
                  },
                  height: '100%',
                  aspectRatio: '1/1',
                  borderRadius: 1,
                }}
              >
                <X className="h-4 w-4" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        <Button
          variant="outlined"
          size="medium"
          startIcon={<FolderPlus className="h-4 w-4" />}
          onClick={handleCreateGroupWithFilter}
          disabled={loading || !hasConditions}
          fullWidth
          sx={{ py: 1 }}
        >
          {t('search:searchBar.buttons.createGroupWithFilter')}
        </Button>
      </Stack>

      {history.length > 0 ? (
        <Box sx={{ mt: 4 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <History className="h-4 w-4" />
              {t('search:history.title', 'Recent Searches')}
            </Typography>
            <Button size="small" onClick={clearHistory} color="inherit" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
              {t('search:history.clear', 'Clear History')}
            </Button>
          </Stack>

          <Stack spacing={1}>
            {history.map((item) => (
              <Paper
                key={item.id}
                variant="outlined"
                sx={{
                  p: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  cursor: 'pointer',
                  transition: '0.2s',
                  '&:hover': {
                    bgcolor: 'action.hover',
                    borderColor: 'primary.main',
                  },
                }}
                onClick={() => handleRestoreHistory(item)}
              >
                <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', overflow: 'hidden' }}>
                  {item.text ? <Typography variant="body2" fontWeight={500}>{item.text}</Typography> : null}
                  {item.tokens.map((token) => (
                    <Chip
                      key={token.id}
                      label={token.label}
                      size="small"
                      color={token.type === 'positive' ? 'success' : token.type === 'negative' ? 'error' : 'warning'}
                      variant="outlined"
                      sx={{ height: 20, fontSize: '0.7rem' }}
                    />
                  ))}
                  {item.tokens.length === 0 && !item.text ? (
                    <Typography variant="caption" color="text.disabled">{t('search:history.empty', 'Empty Search')}</Typography>
                  ) : null}
                </Box>

                <Tooltip title={t('search:history.remove', 'Remove')}>
                  <IconButton
                    size="small"
                    onClick={(event) => {
                      event.stopPropagation()
                      removeHistoryItem(item.id)
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </IconButton>
                </Tooltip>
              </Paper>
            ))}
          </Stack>

          <GroupCreateEditModal
            open={groupModalOpen}
            onClose={() => setGroupModalOpen(false)}
            onSuccess={() => setGroupModalOpen(false)}
            initialAutoCollectConditions={groupInitialConditions}
          />
        </Box>
      ) : null}
    </Box>
  )
}

export default SearchBar
