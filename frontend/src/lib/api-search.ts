import { createApiFallbackError } from '@/i18n/api-error-fallbacks'
import { fetchJson } from '@/lib/api-client'
import type { RatingTierRecord, SearchChip, SearchHistoryEntry, SearchMetadataSuggestion } from '@/features/search/search-types'

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

type SearchFallbackKey = Parameters<typeof createApiFallbackError>[1]

async function requestSearchData<T>(path: string, fallbackKey: SearchFallbackKey, init?: RequestInit) {
  const response = await fetchJson<ApiResponse<T>>(path, init)
  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, fallbackKey)
  }

  return response.data
}

async function requestSearchAction<T>(path: string, fallbackKey: SearchFallbackKey, init?: RequestInit) {
  const response = await fetchJson<ApiResponse<T>>(path, init)
  if (!response.success) {
    throw createApiFallbackError(response.error, fallbackKey)
  }
}

/** Load saved search history entries from the backend JSON store. */
export async function getSearchHistory() {
  return requestSearchData<SearchHistoryEntry[]>('/api/search-history', 'search.history.load')
}

/** Persist a saved search entry to the backend JSON store. */
export async function saveSearchHistory(input: { label: string; chips: SearchChip[] }) {
  return requestSearchData<SearchHistoryEntry>('/api/search-history', 'search.history.save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

/** Delete a single saved search history entry. */
export async function deleteSearchHistory(entryId: string) {
  await requestSearchAction<{ deleted: boolean }>(`/api/search-history/${encodeURIComponent(entryId)}`, 'search.history.delete', {
    method: 'DELETE',
  })
}

/** Remove all saved search history entries. */
export async function clearSearchHistory() {
  await requestSearchAction<{ cleared: boolean }>('/api/search-history', 'search.history.clear', {
    method: 'DELETE',
  })
}

/** Load user-configured rating tiers for tier-based search chips. */
export async function getRatingTiers() {
  return requestSearchData<RatingTierRecord[]>('/api/runtime-media-settings/rating-tiers', 'search.ratingTiers.load')
}

/** Load distinct model suggestions from indexed image metadata. */
export async function getSearchModelSuggestions(params?: { query?: string; limit?: number }) {
  const searchParams = new URLSearchParams()
  searchParams.set('q', params?.query ?? '')
  searchParams.set('limit', String(params?.limit ?? 16))

  return requestSearchData<SearchMetadataSuggestion[]>(`/api/search-options/models?${searchParams.toString()}`, 'search.modelSuggestions.load')
}

/** Load distinct LoRA suggestions from indexed image metadata. */
export async function getSearchLoraSuggestions(params?: { query?: string; limit?: number }) {
  const searchParams = new URLSearchParams()
  searchParams.set('q', params?.query ?? '')
  searchParams.set('limit', String(params?.limit ?? 16))

  return requestSearchData<SearchMetadataSuggestion[]>(`/api/search-options/loras?${searchParams.toString()}`, 'search.loraSuggestions.load')
}
