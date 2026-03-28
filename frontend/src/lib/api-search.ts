import { fetchJson } from '@/lib/api-client'
import type { SearchChip, SearchHistoryEntry, RatingTierRecord } from '@/features/search/search-types'

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

/** Load saved search history entries from the backend JSON store. */
export async function getSearchHistory() {
  const response = await fetchJson<ApiResponse<SearchHistoryEntry[]>>('/api/search-history')
  if (!response.success || !response.data) {
    throw new Error(response.error || '검색 히스토리를 불러오지 못했어.')
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
    throw new Error(response.error || '검색 히스토리를 저장하지 못했어.')
  }

  return response.data
}

/** Delete a single saved search history entry. */
export async function deleteSearchHistory(entryId: string) {
  const response = await fetchJson<ApiResponse<{ deleted: boolean }>>(`/api/search-history/${encodeURIComponent(entryId)}`, {
    method: 'DELETE',
  })

  if (!response.success) {
    throw new Error(response.error || '검색 히스토리 삭제에 실패했어.')
  }
}

/** Remove all saved search history entries. */
export async function clearSearchHistory() {
  const response = await fetchJson<ApiResponse<{ cleared: boolean }>>('/api/search-history', {
    method: 'DELETE',
  })

  if (!response.success) {
    throw new Error(response.error || '검색 히스토리를 비우지 못했어.')
  }
}

/** Load user-configured rating tiers for tier-based search chips. */
export async function getRatingTiers() {
  const response = await fetchJson<ApiResponse<RatingTierRecord[]>>('/api/settings/rating/tiers')
  if (!response.success || !response.data) {
    throw new Error(response.error || '평가 티어를 불러오지 못했어.')
  }
  return response.data
}
