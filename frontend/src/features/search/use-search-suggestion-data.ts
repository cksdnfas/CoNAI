import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchPromptCollection } from '@/lib/api-prompts'
import { getRatingTiers, getSearchLoraSuggestions, getSearchModelSuggestions } from '@/lib/api-search'
import { isPromptSuggestionScope, shouldEnableSearchSuggestionQuery } from './search-suggestion-query-policy'
import type { SearchScope } from './search-types'

const SEARCH_SUGGESTION_INPUT_DEBOUNCE_MS = 180

function useDebouncedSearchInput(value: string) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setDebouncedValue(value)
    }, SEARCH_SUGGESTION_INPUT_DEBOUNCE_MS)

    return () => window.clearTimeout(timerId)
  }, [value])

  return debouncedValue
}

function matchesRatingTierSearch(tierName: string, minScore: number, maxScore: number | null, normalizedInput: string) {
  if (normalizedInput.length === 0) {
    return true
  }

  const normalizedTierName = tierName.toLowerCase()
  return normalizedTierName.includes(normalizedInput)
    || String(minScore).includes(normalizedInput)
    || (maxScore === null ? 'infinity'.includes(normalizedInput) : String(maxScore).includes(normalizedInput))
}

/** Load shared prompt, rating, model, and LoRA suggestions for the reusable search UI. */
export function useSearchSuggestionData(searchScope: SearchScope, searchInput: string) {
  const normalizedInput = searchInput.trim()
  const debouncedInput = useDebouncedSearchInput(normalizedInput)
  const isInputSettling = normalizedInput !== debouncedInput

  const ratingTiersQuery = useQuery({
    queryKey: ['rating-tiers'],
    queryFn: getRatingTiers,
    enabled: shouldEnableSearchSuggestionQuery('rating', searchScope, normalizedInput),
  })

  const promptSuggestionsQuery = useQuery({
    queryKey: ['search-suggestions', searchScope, debouncedInput],
    queryFn: () => {
      const promptType = isPromptSuggestionScope(searchScope) ? searchScope : 'positive'

      return searchPromptCollection({
        query: debouncedInput,
        type: promptType,
        page: 1,
        limit: 16,
        sortBy: 'usage_count',
        sortOrder: 'DESC',
      })
    },
    enabled: shouldEnableSearchSuggestionQuery('prompt', searchScope, debouncedInput),
  })

  const modelSuggestionsQuery = useQuery({
    queryKey: ['search-model-suggestions', debouncedInput],
    queryFn: () => getSearchModelSuggestions({ query: debouncedInput, limit: 16 }),
    enabled: shouldEnableSearchSuggestionQuery('model', searchScope, debouncedInput),
  })

  const loraSuggestionsQuery = useQuery({
    queryKey: ['search-lora-suggestions', debouncedInput],
    queryFn: () => getSearchLoraSuggestions({ query: debouncedInput, limit: 16 }),
    enabled: shouldEnableSearchSuggestionQuery('lora', searchScope, debouncedInput),
  })

  const ratingTiers = useMemo(() => ratingTiersQuery.data ?? [], [ratingTiersQuery.data])
  const promptSuggestions = isInputSettling && isPromptSuggestionScope(searchScope) ? [] : (promptSuggestionsQuery.data?.items ?? [])
  const filteredRatingTiers = useMemo(
    () => ratingTiers.filter((tier) => matchesRatingTierSearch(tier.tier_name, tier.min_score, tier.max_score, normalizedInput.toLowerCase())),
    [normalizedInput, ratingTiers],
  )
  const modelSuggestions = isInputSettling && searchScope === 'model' ? [] : (modelSuggestionsQuery.data ?? [])
  const loraSuggestions = isInputSettling && searchScope === 'lora' ? [] : (loraSuggestionsQuery.data ?? [])

  return {
    ratingTiers,
    promptSuggestions,
    filteredRatingTiers,
    modelSuggestions,
    loraSuggestions,
    suggestionsLoading: shouldEnableSearchSuggestionQuery('prompt', searchScope, normalizedInput) && (isInputSettling || promptSuggestionsQuery.isLoading),
    ratingTiersLoading: ratingTiersQuery.isLoading,
    modelSuggestionsLoading: shouldEnableSearchSuggestionQuery('model', searchScope, normalizedInput) && (isInputSettling || modelSuggestionsQuery.isLoading),
    loraSuggestionsLoading: shouldEnableSearchSuggestionQuery('lora', searchScope, normalizedInput) && (isInputSettling || loraSuggestionsQuery.isLoading),
  }
}
