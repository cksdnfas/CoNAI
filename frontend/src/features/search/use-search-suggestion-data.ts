import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRatingTiers, searchPromptCollection } from '@/lib/api'
import type { SearchScope } from './search-types'

/** Load shared prompt suggestions and rating tiers for the chip-based search UI. */
export function useSearchSuggestionData(searchScope: SearchScope, searchInput: string) {
  const ratingTiersQuery = useQuery({
    queryKey: ['rating-tiers'],
    queryFn: getRatingTiers,
  })

  const promptSuggestionsQuery = useQuery({
    queryKey: ['search-suggestions', searchScope, searchInput],
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

  const ratingTiers = ratingTiersQuery.data ?? []
  const promptSuggestions = promptSuggestionsQuery.data?.items ?? []
  const filteredRatingTiers = useMemo(() => ratingTiers, [ratingTiers])

  return {
    ratingTiers,
    promptSuggestions,
    filteredRatingTiers,
    suggestionsLoading: promptSuggestionsQuery.isLoading,
    ratingTiersLoading: ratingTiersQuery.isLoading,
  }
}
