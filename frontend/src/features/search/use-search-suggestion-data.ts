import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRatingTiers, getSearchLoraSuggestions, getSearchModelSuggestions, searchPromptCollection } from '@/lib/api'
import type { SearchScope } from './search-types'

/** Load shared prompt, rating, model, and LoRA suggestions for the reusable search UI. */
export function useSearchSuggestionData(searchScope: SearchScope, searchInput: string) {
  const normalizedInput = searchInput.trim()

  const ratingTiersQuery = useQuery({
    queryKey: ['rating-tiers'],
    queryFn: getRatingTiers,
  })

  const promptSuggestionsQuery = useQuery({
    queryKey: ['search-suggestions', searchScope, normalizedInput],
    queryFn: () => {
      const promptType = searchScope === 'positive' || searchScope === 'negative' || searchScope === 'auto'
        ? searchScope
        : 'positive'

      return searchPromptCollection({
        query: normalizedInput,
        type: promptType,
        page: 1,
        limit: 16,
        sortBy: 'usage_count',
        sortOrder: 'DESC',
      })
    },
    enabled: (searchScope === 'positive' || searchScope === 'negative' || searchScope === 'auto') && normalizedInput.length > 0,
  })

  const modelSuggestionsQuery = useQuery({
    queryKey: ['search-model-suggestions', normalizedInput],
    queryFn: () => getSearchModelSuggestions({ query: normalizedInput, limit: 16 }),
    enabled: searchScope === 'model',
  })

  const loraSuggestionsQuery = useQuery({
    queryKey: ['search-lora-suggestions', normalizedInput],
    queryFn: () => getSearchLoraSuggestions({ query: normalizedInput, limit: 16 }),
    enabled: searchScope === 'lora',
  })

  const ratingTiers = ratingTiersQuery.data ?? []
  const promptSuggestions = promptSuggestionsQuery.data?.items ?? []
  const filteredRatingTiers = useMemo(() => ratingTiers, [ratingTiers])
  const modelSuggestions = modelSuggestionsQuery.data ?? []
  const loraSuggestions = loraSuggestionsQuery.data ?? []

  return {
    ratingTiers,
    promptSuggestions,
    filteredRatingTiers,
    modelSuggestions,
    loraSuggestions,
    suggestionsLoading: promptSuggestionsQuery.isLoading,
    ratingTiersLoading: ratingTiersQuery.isLoading,
    modelSuggestionsLoading: modelSuggestionsQuery.isLoading,
    loraSuggestionsLoading: loraSuggestionsQuery.isLoading,
  }
}
