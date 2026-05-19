import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchPromptCollection } from '@/lib/api-prompts'
import { getRatingTiers, getSearchLoraSuggestions, getSearchModelSuggestions } from '@/lib/api-search'
import { isPromptSuggestionScope, shouldEnableSearchSuggestionQuery } from './search-suggestion-query-policy'
import type { SearchScope } from './search-types'

/** Load shared prompt, rating, model, and LoRA suggestions for the reusable search UI. */
export function useSearchSuggestionData(searchScope: SearchScope, searchInput: string) {
  const normalizedInput = searchInput.trim()

  const ratingTiersQuery = useQuery({
    queryKey: ['rating-tiers'],
    queryFn: getRatingTiers,
    enabled: shouldEnableSearchSuggestionQuery('rating', searchScope, normalizedInput),
  })

  const promptSuggestionsQuery = useQuery({
    queryKey: ['search-suggestions', searchScope, normalizedInput],
    queryFn: () => {
      const promptType = isPromptSuggestionScope(searchScope) ? searchScope : 'positive'

      return searchPromptCollection({
        query: normalizedInput,
        type: promptType,
        page: 1,
        limit: 16,
        sortBy: 'usage_count',
        sortOrder: 'DESC',
      })
    },
    enabled: shouldEnableSearchSuggestionQuery('prompt', searchScope, normalizedInput),
  })

  const modelSuggestionsQuery = useQuery({
    queryKey: ['search-model-suggestions', normalizedInput],
    queryFn: () => getSearchModelSuggestions({ query: normalizedInput, limit: 16 }),
    enabled: shouldEnableSearchSuggestionQuery('model', searchScope, normalizedInput),
  })

  const loraSuggestionsQuery = useQuery({
    queryKey: ['search-lora-suggestions', normalizedInput],
    queryFn: () => getSearchLoraSuggestions({ query: normalizedInput, limit: 16 }),
    enabled: shouldEnableSearchSuggestionQuery('lora', searchScope, normalizedInput),
  })

  const ratingTiers = useMemo(() => ratingTiersQuery.data ?? [], [ratingTiersQuery.data])
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
