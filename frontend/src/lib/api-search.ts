import { createApiFallbackError } from '@/i18n/api-error-fallbacks'
import { fetchJson } from '@/lib/api-client'
import type { RatingTierRecord, SearchChip, SearchHistoryEntry, SearchMetadataSuggestion } from '@/features/search/search-types'

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

/** Load saved search history entries from the backend JSON store. */
export async function getSearchHistory() {
  const response = await fetchJson<ApiResponse<SearchHistoryEntry[]>>('/api/search-history')
  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'search.history.load')
  }
  return response.data
}

/** Persist a saved search entry to the backend JSON store. */
export async function saveSearchHistory(input: { label: string; chips: SearchChip[] }) {
  const response = await fetchJson<ApiResponse<SearchHistoryEntry>>('/api/search-history', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'search.history.save')
  }

  return response.data
}

/** Delete a single saved search history entry. */
export async function deleteSearchHistory(entryId: string) {
  const response = await fetchJson<ApiResponse<{ deleted: boolean }>>(`/api/search-history/${encodeURIComponent(entryId)}`, {
    method: 'DELETE',
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'search.history.delete')
  }
}

/** Remove all saved search history entries. */
export async function clearSearchHistory() {
  const response = await fetchJson<ApiResponse<{ cleared: boolean }>>('/api/search-history', {
    method: 'DELETE',
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'search.history.clear')
  }
}

/** Load user-configured rating tiers for tier-based search chips. */
export async function getRatingTiers() {
  const response = await fetchJson<ApiResponse<RatingTierRecord[]>>('/api/runtime-media-settings/rating-tiers')
  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'search.ratingTiers.load')
  }
  return response.data
}

/** Load distinct model suggestions from indexed image metadata. */
export async function getSearchModelSuggestions(params?: { query?: string; limit?: number }) {
  const searchParams = new URLSearchParams()
  searchParams.set('q', params?.query ?? '')
  searchParams.set('limit', String(params?.limit ?? 16))

  const response = await fetchJson<ApiResponse<SearchMetadataSuggestion[]>>(`/api/search-options/models?${searchParams.toString()}`)
  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'search.modelSuggestions.load')
  }
  return response.data
}

/** Load distinct LoRA suggestions from indexed image metadata. */
export async function getSearchLoraSuggestions(params?: { query?: string; limit?: number }) {
  const searchParams = new URLSearchParams()
  searchParams.set('q', params?.query ?? '')
  searchParams.set('limit', String(params?.limit ?? 16))

  const response = await fetchJson<ApiResponse<SearchMetadataSuggestion[]>>(`/api/search-options/loras?${searchParams.toString()}`)
  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'search.loraSuggestions.load')
  }
  return response.data
}
